import { HttpLumaGateway } from "@/infrastructure/luma/http-luma-gateway";
import { getObjectStore } from "@/infrastructure/storage/local-object-store";
import { PostgresGenerationRepository } from "@/modules/generation/postgres-repository";
import {
  GenerationWorker,
  type GenerationJobResult
} from "@/modules/generation/worker";
import { getEnv } from "@/shared/env";
import { completeJob, rescheduleJob, type ClaimedJob } from "./core/job-queue";

let generationWorker: GenerationWorker | undefined;

function getGenerationWorker() {
  if (!generationWorker) {
    const env = getEnv();
    if (!env.LUMA_API_KEY) {
      throw new Error(
        "LUMA_API_KEY is required before generation jobs can be processed."
      );
    }
    const gateway = new HttpLumaGateway(env.LUMA_API_KEY);
    generationWorker = new GenerationWorker(
      new PostgresGenerationRepository(),
      gateway,
      getObjectStore()
    );
  }
  return generationWorker;
}

export async function handleGenerationJob(job: ClaimedJob, workerId: string) {
  if (
    job.type !== "submit_generation" &&
    job.type !== "poll_generation" &&
    job.type !== "persist_generation_output"
  ) {
    return false;
  }

  const payload = parsePayload(job.payloadJson);
  let result: GenerationJobResult;
  if (job.type === "submit_generation") {
    result = await getGenerationWorker().submit(payload.attemptId);
  } else if (job.type === "poll_generation") {
    result = await getGenerationWorker().poll(
      payload.attemptId,
      payload.pollNumber ?? 0
    );
  } else {
    result = await getGenerationWorker().persist(payload.attemptId);
  }

  if (result.action === "complete") {
    await completeJob(job.id, workerId);
  } else {
    await rescheduleJob(job, workerId, result.reason, result.delayMs);
  }
  return true;
}

function parsePayload(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("attemptId" in value) ||
    typeof value.attemptId !== "string"
  ) {
    throw new Error("Generation job payload is missing attemptId.");
  }
  const pollNumber =
    "pollNumber" in value && typeof value.pollNumber === "number"
      ? value.pollNumber
      : undefined;
  return { attemptId: value.attemptId, pollNumber };
}
