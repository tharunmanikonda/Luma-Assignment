import { getEnv } from "@/shared/env";
import { logger } from "@/shared/logger";
import { closeDb } from "@/db/client";
import {
  claimNextJob,
  completeJob,
  rescheduleJob,
  type ClaimedJob
} from "./core/job-queue";
import { handleGenerationJob } from "./generation-handlers";

const idlePollMs = 1_000;
const maxBackoffMs = 30_000;

async function handleJob(job: ClaimedJob, workerId: string) {
  if (job.type === "platform_smoke_test") {
    await completeJob(job.id, workerId);
    return;
  }

  if (await handleGenerationJob(job, workerId)) return;

  throw new Error(`No handler registered for ${job.type}`);
}

function waitForNextPoll(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, idlePollMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export async function runWorker(signal: AbortSignal) {
  const env = getEnv();
  logger.info({ workerId: env.WORKER_ID }, "worker started");

  while (!signal.aborted) {
    const job = await claimNextJob(env.WORKER_ID);
    if (!job) {
      await waitForNextPoll(signal);
      continue;
    }

    try {
      await handleJob(job, env.WORKER_ID);
      logger.info({ jobId: job.id, type: job.type }, "job completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const delayMs = Math.min(
        1_000 * 2 ** (job.attemptCount - 1),
        maxBackoffMs
      );
      const status = await rescheduleJob(job, env.WORKER_ID, message, delayMs);
      logger.warn(
        { jobId: job.id, type: job.type, status, message },
        "job failed"
      );
    }
  }
}

async function main() {
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await runWorker(controller.signal);
    logger.info("worker stopped");
  } finally {
    await closeDb();
  }
}

void main().catch((error) => {
  logger.error({ error }, "worker failed");
  process.exitCode = 1;
});
