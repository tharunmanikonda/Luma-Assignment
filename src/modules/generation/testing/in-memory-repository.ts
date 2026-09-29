import { AppError } from "@/shared/errors";
import type {
  GenerationAttemptRecord,
  ProductGenerationInput
} from "../domain";
import type {
  AuthorizeAttemptInput,
  GenerationRepository
} from "../repository";

export class InMemoryGenerationRepository implements GenerationRepository {
  readonly attempts: GenerationAttemptRecord[] = [];
  readonly jobs: Array<{
    type: string;
    deduplicationKey: string;
    payload: unknown;
  }> = [];
  readonly assets: Array<{ id: string; objectKey: string }> = [];
  private lock: Promise<void> = Promise.resolve();

  constructor(readonly product: ProductGenerationInput) {}

  async getProductInput(
    workspaceId: string,
    productId: string,
    sourceAssetId: string,
    sceneBriefId: string
  ) {
    if (
      workspaceId !== this.product.workspaceId ||
      productId !== this.product.productId
    )
      return null;
    return {
      ...this.product,
      sourceAsset:
        this.product.sourceAsset?.id === sourceAssetId
          ? this.product.sourceAsset
          : null,
      sceneBrief:
        this.product.sceneBrief?.id === sceneBriefId
          ? this.product.sceneBrief
          : null,
      hasReconciliationRequiredAttempt: this.attempts.some(
        (attempt) =>
          attempt.productId === productId &&
          attempt.status === "reconciliation_required"
      )
    };
  }

  async authorizeAttempt(input: AuthorizeAttemptInput) {
    return this.serial(async () => {
      const existing = this.attempts.find(
        (attempt) =>
          attempt.workspaceId === input.workspaceId &&
          attempt.idempotencyKey === input.idempotencyKey
      );
      if (existing) {
        if (existing.requestFingerprint !== input.requestFingerprint)
          throw new AppError(
            "CONFLICT",
            "That confirmation key was already used for different generation inputs.",
            409
          );
        return { attempt: existing, created: false };
      }
      const usage = this.attempts
        .filter((attempt) => attempt.workspaceId === input.workspaceId)
        .reduce((sum, attempt) => sum + attempt.estimatedPriceMicros, 0);
      if (usage + input.estimatedPriceMicros > input.budgetMicros)
        throw new AppError(
          "CONFLICT",
          "The demo generation budget is fully allocated.",
          409
        );
      const now = new Date("2026-09-28T12:00:00.000Z");
      const attempt: GenerationAttemptRecord = {
        id: `attempt_${this.attempts.length + 1}`,
        workspaceId: input.workspaceId,
        productId: input.product.productId,
        attemptNumber:
          this.attempts.filter(
            (item) => item.productId === input.product.productId
          ).length + 1,
        sourceAssetId: input.product.sourceAsset!.id,
        sceneBriefId: input.product.sceneBrief!.id,
        sceneBriefVersion: input.product.sceneBrief!.version,
        promptText: input.promptText,
        promptTemplateVersion: input.promptTemplateVersion,
        provider: "luma",
        model: "uni-1",
        requestType: "image_edit",
        status: "pending",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        quoteFingerprint: input.quoteFingerprint,
        pricingVersion: input.pricingVersion,
        estimatedPriceMicros: input.estimatedPriceMicros,
        providerGenerationId: null,
        providerRequestId: null,
        providerApiVersion: null,
        providerOutputUrl: null,
        outputAssetId: null,
        failureDetails: null,
        createdBy: input.actorId,
        createdAt: now,
        submittedAt: null,
        completedAt: null
      };
      this.attempts.push(attempt);
      this.jobs.push({
        type: "submit_generation",
        deduplicationKey: `submit-generation:${attempt.id}`,
        payload: { attemptId: attempt.id }
      });
      return { attempt, created: true };
    });
  }

  async getAttempt(attemptId: string) {
    return this.attempts.find((attempt) => attempt.id === attemptId) ?? null;
  }

  async listAttempts(workspaceId: string, productId: string) {
    return this.attempts.filter(
      (attempt) =>
        attempt.workspaceId === workspaceId && attempt.productId === productId
    );
  }

  async estimatedUsageMicros(workspaceId: string) {
    return this.attempts
      .filter((attempt) => attempt.workspaceId === workspaceId)
      .reduce((sum, attempt) => sum + attempt.estimatedPriceMicros, 0);
  }

  async transition(
    attemptId: string,
    from: GenerationAttemptRecord["status"][],
    patch: Partial<GenerationAttemptRecord>,
    nextJob?: {
      type: "poll_generation" | "persist_generation_output";
      deduplicationKey: string;
      payload: unknown;
    }
  ) {
    const attempt = await this.getAttempt(attemptId);
    if (!attempt || !from.includes(attempt.status)) return null;
    Object.assign(attempt, patch);
    if (
      nextJob &&
      !this.jobs.some(
        (job) => job.deduplicationKey === nextJob.deduplicationKey
      )
    )
      this.jobs.push(nextJob);
    return attempt;
  }

  async completePersistence(input: {
    attemptId: string;
    workspaceId: string;
    productId: string;
    objectKey: string;
  }) {
    const attempt = await this.getAttempt(input.attemptId);
    if (!attempt || attempt.status !== "storing")
      throw new AppError("CONFLICT", "Output cannot be finalized.", 409);
    const existing = this.assets.find(
      (asset) => asset.objectKey === input.objectKey
    );
    const asset = existing ?? {
      id: `asset_${this.assets.length + 1}`,
      objectKey: input.objectKey
    };
    if (!existing) this.assets.push(asset);
    Object.assign(attempt, {
      status: "succeeded",
      outputAssetId: asset.id,
      providerOutputUrl: null,
      completedAt: new Date("2026-09-28T12:01:00.000Z")
    });
    return attempt;
  }

  private async serial<T>(work: () => Promise<T> | T): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

export function readyProduct(
  overrides: Partial<ProductGenerationInput> = {}
): ProductGenerationInput {
  return {
    productId: "product_1",
    workspaceId: "ws_demo",
    name: "Stoneware Vase",
    category: "Decor",
    material: "Stoneware",
    colorFinish: "Matte white",
    sourceAsset: {
      id: "asset_source",
      productId: "product_1",
      workspaceId: "ws_demo",
      objectKey: "sources/vase.png",
      status: "ready",
      mimeType: "image/png"
    },
    sceneBrief: {
      id: "scene_1",
      productId: "product_1",
      version: 1,
      text: "Morning kitchen counter with warm natural light"
    },
    hasReconciliationRequiredAttempt: false,
    ...overrides
  };
}
