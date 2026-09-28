import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { newId } from "@/shared/ids";

export type JobType =
  | "parse_ingestion_batch"
  | "ingest_source_asset"
  | "submit_generation"
  | "poll_generation"
  | "persist_generation_output"
  | "build_approved_bundle"
  | "platform_smoke_test";

export interface ClaimedJob {
  id: string;
  type: JobType;
  payloadJson: unknown;
  attemptCount: number;
}

export async function enqueueJob(input: {
  type: JobType;
  deduplicationKey: string;
  payloadJson: unknown;
  runAfter?: Date;
}) {
  const [job] = await getDb()
    .insert(jobs)
    .values({
      id: newId("job"),
      type: input.type,
      deduplicationKey: input.deduplicationKey,
      payloadJson: input.payloadJson,
      runAfter: input.runAfter ?? new Date()
    })
    .onConflictDoUpdate({
      target: jobs.deduplicationKey,
      set: {
        updatedAt: new Date()
      }
    })
    .returning();

  return job;
}

export async function claimNextJob(
  workerId: string,
  leaseMs = 30_000
): Promise<ClaimedJob | null> {
  const result = await getDb().execute(sql`
    update ${jobs}
    set
      status = 'running',
      locked_at = now(),
      locked_until = now() + (${leaseMs} || ' milliseconds')::interval,
      locked_by = ${workerId},
      attempt_count = attempt_count + 1,
      updated_at = now()
    where id = (
      select id from ${jobs}
      where
        (status = 'queued' and run_after <= now())
        or (status = 'running' and locked_until < now())
      order by run_after asc, created_at asc
      for update skip locked
      limit 1
    )
    returning id, type, payload_json as "payloadJson", attempt_count as "attemptCount"
  `);

  return (result.rows[0] as unknown as ClaimedJob | undefined) ?? null;
}

export async function completeJob(jobId: string) {
  await getDb()
    .update(jobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date()
    })
    .where(sql`${jobs.id} = ${jobId}`);
}

export async function failJob(jobId: string, message: string) {
  await getDb()
    .update(jobs)
    .set({
      status: "failed",
      lastError: message,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date()
    })
    .where(sql`${jobs.id} = ${jobId}`);
}
