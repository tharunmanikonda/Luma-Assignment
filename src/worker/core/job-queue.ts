import { and, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
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
  maxAttempts: number;
}

export class DeduplicationConflictError extends Error {
  constructor(key: string) {
    super(`Deduplication key ${key} was already used for a different job.`);
    this.name = "DeduplicationConflictError";
  }
}

export class JobOwnershipError extends Error {
  constructor(jobId: string, workerId: string) {
    super(`Worker ${workerId} no longer owns running job ${jobId}.`);
    this.name = "JobOwnershipError";
  }
}

export async function enqueueJob(input: {
  type: JobType;
  deduplicationKey: string;
  payloadJson: unknown;
  runAfter?: Date;
  maxAttempts?: number;
}) {
  const [inserted] = await getDb()
    .insert(jobs)
    .values({
      id: newId("job"),
      type: input.type,
      deduplicationKey: input.deduplicationKey,
      payloadJson: input.payloadJson,
      runAfter: input.runAfter ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5
    })
    .onConflictDoNothing({ target: jobs.deduplicationKey })
    .returning();

  if (inserted) return inserted;

  const [existing] = await getDb()
    .select()
    .from(jobs)
    .where(eq(jobs.deduplicationKey, input.deduplicationKey))
    .limit(1);

  if (
    !existing ||
    existing.type !== input.type ||
    !isDeepStrictEqual(existing.payloadJson, input.payloadJson)
  ) {
    throw new DeduplicationConflictError(input.deduplicationKey);
  }

  return existing;
}

export async function claimNextJob(
  workerId: string,
  leaseMs = 30_000
): Promise<ClaimedJob | null> {
  await getDb()
    .update(jobs)
    .set({
      status: "dead",
      lastError: "Job lease expired after the final allowed attempt.",
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(jobs.status, "running"),
        sql`${jobs.lockedUntil} < now()`,
        sql`${jobs.attemptCount} >= ${jobs.maxAttempts}`
      )
    );

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
        ((status = 'queued' and run_after <= now())
        or (status = 'running' and locked_until < now()))
        and attempt_count < max_attempts
      order by run_after asc, created_at asc
      for update skip locked
      limit 1
    )
    returning id, type, payload_json as "payloadJson", attempt_count as "attemptCount", max_attempts as "maxAttempts"
  `);

  return (result.rows[0] as unknown as ClaimedJob | undefined) ?? null;
}

export async function completeJob(jobId: string, workerId: string) {
  const [job] = await getDb()
    .update(jobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.lockedBy, workerId),
        sql`${jobs.lockedUntil} > now()`
      )
    )
    .returning({ id: jobs.id });
  if (!job) throw new JobOwnershipError(jobId, workerId);
}

export async function renewLease(
  jobId: string,
  workerId: string,
  leaseMs = 30_000
) {
  const [job] = await getDb()
    .update(jobs)
    .set({
      lockedUntil: sql`now() + (${leaseMs} || ' milliseconds')::interval`,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.lockedBy, workerId),
        sql`${jobs.lockedUntil} > now()`
      )
    )
    .returning({ id: jobs.id });
  if (!job) throw new JobOwnershipError(jobId, workerId);
}

export async function rescheduleJob(
  job: ClaimedJob,
  workerId: string,
  message: string,
  delayMs: number
) {
  const terminal = job.attemptCount >= job.maxAttempts;
  const [updated] = await getDb()
    .update(jobs)
    .set({
      status: terminal ? "dead" : "queued",
      runAfter: terminal
        ? new Date()
        : sql`now() + (${delayMs} || ' milliseconds')::interval`,
      lastError: message,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.status, "running"),
        eq(jobs.lockedBy, workerId),
        sql`${jobs.lockedUntil} > now()`
      )
    )
    .returning({ id: jobs.id });
  if (!updated) throw new JobOwnershipError(job.id, workerId);
  return terminal ? "dead" : "queued";
}

export async function deadLetterJob(
  jobId: string,
  workerId: string,
  message: string
) {
  const [job] = await getDb()
    .update(jobs)
    .set({
      status: "dead",
      lastError: message,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        eq(jobs.lockedBy, workerId),
        sql`${jobs.lockedUntil} > now()`
      )
    )
    .returning({ id: jobs.id });
  if (!job) throw new JobOwnershipError(jobId, workerId);
}
