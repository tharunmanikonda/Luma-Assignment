import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar
} from "drizzle-orm/pg-core";
import { assets, users, workspaces } from "@/db/schema";

export const reviewStateEnum = pgEnum("review_state", [
  "pending",
  "approved",
  "changes_requested",
  "revoked"
]);

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    generationAttemptId: varchar("generation_attempt_id", {
      length: 40
    }).notNull(),
    workspaceId: varchar("workspace_id", { length: 32 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    productId: varchar("product_id", { length: 40 }).notNull(),
    approverUserId: varchar("approver_user_id", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdBy: varchar("created_by", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    state: reviewStateEnum("state").notNull().default("pending"),
    feedback: text("feedback"),
    decisionActorId: varchar("decision_actor_id", { length: 40 }).references(
      () => users.id,
      { onDelete: "restrict" }
    ),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    decisionIdempotencyKey: text("decision_idempotency_key"),
    revokeIdempotencyKey: text("revoke_idempotency_key"),
    productName: text("product_name").notNull(),
    sku: text("sku").notNull(),
    category: text("category"),
    colorFinish: text("color_finish"),
    material: text("material"),
    attemptNumber: integer("attempt_number").notNull(),
    sceneVersion: integer("scene_version").notNull(),
    sceneDirection: text("scene_direction").notNull(),
    sourceAssetId: varchar("source_asset_id", { length: 40 })
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    candidateAssetId: varchar("candidate_asset_id", { length: 40 })
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (table) => ({
    attemptUnique: unique("review_requests_attempt_unique").on(
      table.generationAttemptId
    ),
    createKeyUnique: unique("review_requests_create_key_unique").on(
      table.createIdempotencyKey
    ),
    productHistoryIdx: index("review_requests_product_history_idx").on(
      table.productId,
      table.createdAt
    ),
    approverStateIdx: index("review_requests_approver_state_idx").on(
      table.approverUserId,
      table.state
    ),
    feedbackRequired: check(
      "review_requests_feedback_required_check",
      sql`${table.state} <> 'changes_requested' or length(trim(${table.feedback})) >= 3`
    ),
    terminalFields: check(
      "review_requests_terminal_fields_check",
      sql`(
        ${table.state} = 'pending'
        and ${table.decidedAt} is null
        and ${table.revokedAt} is null
      ) or (
        ${table.state} in ('approved', 'changes_requested')
        and ${table.decidedAt} is not null
        and ${table.decisionActorId} is not null
        and ${table.revokedAt} is null
      ) or (
        ${table.state} = 'revoked'
        and ${table.revokedAt} is not null
        and ${table.decidedAt} is null
      )`
    )
  })
);
