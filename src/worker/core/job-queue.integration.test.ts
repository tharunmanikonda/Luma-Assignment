import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { runDatabaseTests } from "@/test/postgres";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  JobOwnershipError
} from "./job-queue";

describe.runIf(runDatabaseTests)("PostgreSQL job leasing", () => {
  beforeEach(async () => {
    await getDb().delete(jobs);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("hands one ready job to only one concurrent claimer", async () => {
    await enqueueJob({
      type: "platform_smoke_test",
      deduplicationKey: "concurrent-claim",
      payloadJson: { smoke: true }
    });

    const claims = await Promise.all([
      claimNextJob("worker-a"),
      claimNextJob("worker-b")
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("reclaims an expired lease and rejects the stale worker", async () => {
    const enqueued = await enqueueJob({
      type: "platform_smoke_test",
      deduplicationKey: "lease-reclaim",
      payloadJson: { smoke: true }
    });
    await claimNextJob("worker-first", 30_000);
    await getDb()
      .update(jobs)
      .set({ lockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(jobs.id, enqueued.id));

    const reclaimed = await claimNextJob("worker-second", 30_000);
    expect(reclaimed?.id).toBe(enqueued.id);
    await expect(
      completeJob(enqueued.id, "worker-first")
    ).rejects.toBeInstanceOf(JobOwnershipError);
    await completeJob(enqueued.id, "worker-second");

    const [completed] = await getDb()
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, enqueued.id));
    expect(completed.status).toBe("completed");
  });

  it("dead-letters an expired lease after the final attempt", async () => {
    const enqueued = await enqueueJob({
      type: "platform_smoke_test",
      deduplicationKey: "exhausted-lease",
      payloadJson: { smoke: true },
      maxAttempts: 1
    });
    await claimNextJob("worker-final", 30_000);
    await getDb()
      .update(jobs)
      .set({ lockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(jobs.id, enqueued.id));

    expect(await claimNextJob("worker-next", 30_000)).toBeNull();
    const [dead] = await getDb()
      .select({ status: jobs.status, lastError: jobs.lastError })
      .from(jobs)
      .where(eq(jobs.id, enqueued.id));
    expect(dead.status).toBe("dead");
    expect(dead.lastError).toMatch(/final allowed attempt/);
  });

  it("rejects conflicting reuse of a deduplication key", async () => {
    await enqueueJob({
      type: "platform_smoke_test",
      deduplicationKey: "dedupe-conflict",
      payloadJson: { version: 1 }
    });

    await expect(
      enqueueJob({
        type: "platform_smoke_test",
        deduplicationKey: "dedupe-conflict",
        payloadJson: { version: 2 }
      })
    ).rejects.toThrow(/different job/);
  });
});
