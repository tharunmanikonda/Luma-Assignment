import { getEnv } from "@/shared/env";
import { logger } from "@/shared/logger";
import { claimNextJob, completeJob, failJob } from "./core/job-queue";

async function handleJob(job: { id: string; type: string }) {
  if (job.type === "platform_smoke_test") {
    await completeJob(job.id);
    return;
  }

  await failJob(job.id, `No handler registered for ${job.type}`);
}

async function main() {
  const env = getEnv();
  logger.info({ workerId: env.WORKER_ID }, "worker started");

  const job = await claimNextJob(env.WORKER_ID);
  if (!job) {
    logger.info("no ready jobs");
    return;
  }

  await handleJob(job);
  logger.info({ jobId: job.id, type: job.type }, "job handled");
}

main().catch((error) => {
  logger.error({ error }, "worker failed");
  process.exitCode = 1;
});
