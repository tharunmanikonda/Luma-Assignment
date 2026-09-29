import type { ClaimedJob } from "@/worker/core/job-queue";
import { parseIngestionBatch } from "./ingestion-service";
import { ingestSourceAsset } from "./source-image-service";

function payloadId(payload: unknown, field: "batchId" | "assetId") {
  if (
    !payload ||
    typeof payload !== "object" ||
    !(field in payload) ||
    typeof (payload as Record<string, unknown>)[field] !== "string"
  ) {
    throw new Error(`Job payload is missing ${field}.`);
  }
  return (payload as Record<string, string>)[field];
}

export function isIngestionJob(job: ClaimedJob) {
  return (
    job.type === "parse_ingestion_batch" || job.type === "ingest_source_asset"
  );
}

export async function handleIngestionJob(job: ClaimedJob) {
  if (job.type === "parse_ingestion_batch") {
    await parseIngestionBatch(payloadId(job.payloadJson, "batchId"));
    return;
  }
  if (job.type === "ingest_source_asset") {
    await ingestSourceAsset(payloadId(job.payloadJson, "assetId"));
    return;
  }
  throw new Error(`Unsupported ingestion job type: ${job.type}`);
}
