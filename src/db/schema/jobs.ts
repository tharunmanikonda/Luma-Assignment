import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar
} from "drizzle-orm/pg-core";

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "completed",
  "dead"
]);
export const jobTypeEnum = pgEnum("job_type", [
  "parse_ingestion_batch",
  "ingest_source_asset",
  "submit_generation",
  "poll_generation",
  "persist_generation_output",
  "build_approved_bundle",
  "platform_smoke_test"
]);

export const jobs = pgTable(
  "jobs",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    type: jobTypeEnum("type").notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    dedupeUnique: unique("jobs_deduplication_key_unique").on(
      table.deduplicationKey
    ),
    readyIdx: index("jobs_ready_idx").on(table.status, table.runAfter),
    leaseIdx: index("jobs_lease_idx").on(table.status, table.lockedUntil)
  })
);
