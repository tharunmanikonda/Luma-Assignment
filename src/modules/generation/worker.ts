import { createHash } from "node:crypto";
import type { ObjectStore } from "@/infrastructure/storage/object-store";
import {
  LumaRequestError,
  type LumaGateway
} from "@/infrastructure/luma/luma-gateway";
import type { GenerationAttemptRecord } from "./domain";
import type { GenerationRepository } from "./repository";
import { failure } from "./repository";

export type GenerationJobResult =
  | { action: "complete" }
  | { action: "reschedule"; delayMs: number; reason: string };

export class GenerationWorker {
  constructor(
    private readonly repository: GenerationRepository,
    private readonly gateway: LumaGateway,
    private readonly objectStore: ObjectStore
  ) {}

  async submit(attemptId: string): Promise<GenerationJobResult> {
    const current = await this.requireAttempt(attemptId);
    if (
      [
        "queued",
        "processing",
        "storing",
        "succeeded",
        "failed",
        "reconciliation_required"
      ].includes(current.status)
    )
      return { action: "complete" };
    if (current.status === "submitting") {
      await this.repository.transition(attemptId, ["submitting"], {
        status: "reconciliation_required",
        failureDetails: failure(
          "reconciliation",
          "submission_unknown",
          "The provider may have accepted this request. It will not be submitted again automatically.",
          false
        )
      });
      return { action: "complete" };
    }

    const claimed = await this.repository.transition(attemptId, ["pending"], {
      status: "submitting",
      failureDetails: null
    });
    if (!claimed) return { action: "complete" };
    const product = await this.repository.getProductInput(
      claimed.workspaceId,
      claimed.productId,
      claimed.sourceAssetId,
      claimed.sceneBriefId
    );
    if (!product?.sourceAsset)
      throw new Error("Generation source disappeared after authorization.");

    try {
      const sourceObject = await this.objectStore.get(
        product.sourceAsset.objectKey
      );
      if (!sourceObject)
        throw new Error(
          "Generation source bytes disappeared after authorization."
        );
      const submitted = await this.gateway.submitImageEdit({
        source: {
          data: Buffer.from(sourceObject.bytes).toString("base64"),
          mediaType: sourceObject.contentType
        },
        prompt: claimed.promptText,
        userId: claimed.workspaceId,
        idempotencyKey: claimed.id
      });
      await this.repository.transition(
        attemptId,
        ["submitting"],
        {
          status: submitted.state === "processing" ? "processing" : "queued",
          providerGenerationId: submitted.providerGenerationId,
          providerRequestId: submitted.requestId ?? null,
          providerApiVersion: submitted.apiVersion ?? null,
          submittedAt: new Date()
        },
        this.pollJob(attemptId, 0)
      );
      return { action: "complete" };
    } catch (error) {
      if (error instanceof LumaRequestError && error.acceptance === "unknown") {
        await this.repository.transition(attemptId, ["submitting"], {
          status: "reconciliation_required",
          failureDetails: failure(
            "reconciliation",
            error.code,
            "The provider response was interrupted. This request will not be submitted again automatically.",
            false,
            { requestId: error.requestId }
          )
        });
        return { action: "complete" };
      }
      if (error instanceof LumaRequestError && error.retryable) {
        await this.repository.transition(attemptId, ["submitting"], {
          status: "pending",
          failureDetails: failure(
            "submission",
            error.code,
            "Generation is waiting for provider capacity.",
            true,
            { httpStatus: error.httpStatus, requestId: error.requestId }
          )
        });
        return {
          action: "reschedule",
          delayMs: error.retryAfterMs ?? 2_000,
          reason: error.code
        };
      }
      const providerError = error instanceof LumaRequestError ? error : null;
      await this.repository.transition(attemptId, ["submitting"], {
        status: "failed",
        completedAt: new Date(),
        failureDetails: failure(
          "submission",
          providerError?.code ?? "submission_failed",
          "The image request could not be accepted. Review the source and scene before trying again.",
          false,
          {
            httpStatus: providerError?.httpStatus,
            requestId: providerError?.requestId
          }
        )
      });
      return { action: "complete" };
    }
  }

  async poll(
    attemptId: string,
    pollNumber: number
  ): Promise<GenerationJobResult> {
    const attempt = await this.requireAttempt(attemptId);
    if (
      ["succeeded", "failed", "reconciliation_required", "storing"].includes(
        attempt.status
      )
    )
      return { action: "complete" };
    if (!attempt.providerGenerationId)
      return {
        action: "reschedule",
        delayMs: 2_500,
        reason: "submission_not_recorded"
      };
    try {
      const status = await this.gateway.getGeneration(
        attempt.providerGenerationId
      );
      if (status.state === "queued" || status.state === "processing") {
        await this.repository.transition(
          attemptId,
          ["queued", "processing"],
          {
            status: status.state,
            providerRequestId: status.requestId ?? attempt.providerRequestId,
            providerApiVersion: status.apiVersion ?? attempt.providerApiVersion
          },
          this.pollJob(attemptId, pollNumber + 1)
        );
        return { action: "complete" };
      }
      if (status.state === "failed") {
        await this.repository.transition(attemptId, ["queued", "processing"], {
          status: "failed",
          completedAt: new Date(),
          failureDetails: failure(
            "generation",
            status.failureCode ?? "generation_failed",
            "Luma could not complete this image.",
            false,
            { requestId: status.requestId }
          )
        });
        return { action: "complete" };
      }
      if (!status.outputUrl) {
        await this.repository.transition(attemptId, ["queued", "processing"], {
          status: "failed",
          completedAt: new Date(),
          failureDetails: failure(
            "generation",
            "output_not_found",
            "The completed image was unavailable.",
            false
          )
        });
        return { action: "complete" };
      }
      await this.repository.transition(
        attemptId,
        ["queued", "processing"],
        {
          status: "storing",
          providerOutputUrl: status.outputUrl,
          providerRequestId: status.requestId ?? attempt.providerRequestId,
          providerApiVersion: status.apiVersion ?? attempt.providerApiVersion
        },
        {
          type: "persist_generation_output",
          deduplicationKey: `persist-output:${attemptId}`,
          payload: { attemptId }
        }
      );
      return { action: "complete" };
    } catch (error) {
      const message =
        error instanceof LumaRequestError ? error.code : "poll_failed";
      return { action: "reschedule", delayMs: 2_500, reason: message };
    }
  }

  async persist(attemptId: string): Promise<GenerationJobResult> {
    const attempt = await this.requireAttempt(attemptId);
    if (attempt.status === "succeeded") return { action: "complete" };
    if (attempt.status !== "storing" || !attempt.providerOutputUrl)
      return { action: "complete" };
    try {
      const output = await this.downloadWithOneRefresh(attempt);
      const extension =
        output.contentType === "image/png"
          ? "png"
          : output.contentType === "image/webp"
            ? "webp"
            : "jpg";
      const objectKey = `workspaces/${attempt.workspaceId}/generations/${attempt.id}/output.${extension}`;
      const checksum = createHash("sha256").update(output.bytes).digest("hex");
      await this.objectStore.put({
        key: objectKey,
        bytes: output.bytes,
        contentType: output.contentType
      });
      await this.repository.completePersistence({
        attemptId,
        workspaceId: attempt.workspaceId,
        productId: attempt.productId,
        objectKey,
        contentType: output.contentType,
        byteSize: output.bytes.byteLength,
        checksum
      });
      return { action: "complete" };
    } catch (error) {
      const code =
        error instanceof LumaRequestError
          ? error.code
          : "output_persistence_failed";
      await this.repository.transition(attemptId, ["storing"], {
        failureDetails: failure(
          "persistence",
          code,
          "The image is complete and is still being saved safely.",
          true
        )
      });
      return { action: "reschedule", delayMs: 2_500, reason: code };
    }
  }

  private async downloadWithOneRefresh(attempt: GenerationAttemptRecord) {
    try {
      return await this.gateway.downloadOutput(attempt.providerOutputUrl!);
    } catch (error) {
      if (!attempt.providerGenerationId) throw error;
      const refreshed = await this.gateway.getGeneration(
        attempt.providerGenerationId
      );
      if (
        refreshed.state !== "completed" ||
        !refreshed.outputUrl ||
        refreshed.outputUrl === attempt.providerOutputUrl
      ) {
        throw error;
      }
      await this.repository.transition(attempt.id, ["storing"], {
        providerOutputUrl: refreshed.outputUrl,
        providerRequestId: refreshed.requestId ?? attempt.providerRequestId,
        providerApiVersion: refreshed.apiVersion ?? attempt.providerApiVersion
      });
      return this.gateway.downloadOutput(refreshed.outputUrl);
    }
  }

  private pollJob(attemptId: string, pollNumber: number) {
    return {
      type: "poll_generation" as const,
      deduplicationKey: `poll-generation:${attemptId}:${pollNumber}`,
      payload: { attemptId, pollNumber },
      runAfter: new Date(Date.now() + 2_500)
    };
  }

  private async requireAttempt(attemptId: string) {
    const attempt = await this.repository.getAttempt(attemptId);
    if (!attempt)
      throw new Error(`Generation attempt ${attemptId} was not found.`);
    return attempt;
  }
}
