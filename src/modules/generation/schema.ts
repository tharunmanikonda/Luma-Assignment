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
import { assets, users, workspaces } from "@/db/schema";
import type { GenerationFailure } from "./domain";

export const generationAttemptStatusEnum = pgEnum("generation_attempt_status", [
  "pending",
  "submitting",
  "queued",
  "processing",
  "storing",
  "succeeded",
  "failed",
  "reconciliation_required"
]);

export const generationAttempts = pgTable(
  "generation_attempts",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 32 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    productId: varchar("product_id", { length: 40 }).notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    sourceAssetId: varchar("source_asset_id", { length: 40 })
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    sceneBriefId: varchar("scene_brief_id", { length: 40 }).notNull(),
    sceneBriefVersion: integer("scene_brief_version").notNull(),
    promptText: text("prompt_text").notNull(),
    promptTemplateVersion: text("prompt_template_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    requestType: text("request_type").notNull(),
    status: generationAttemptStatusEnum("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    quoteFingerprint: text("quote_fingerprint").notNull(),
    pricingVersion: text("pricing_version").notNull(),
    estimatedPriceMicros: integer("estimated_price_micros").notNull(),
    providerGenerationId: text("provider_generation_id"),
    providerRequestId: text("provider_request_id"),
    providerApiVersion: text("provider_api_version"),
    providerOutputUrl: text("provider_output_url"),
    outputAssetId: varchar("output_asset_id", { length: 40 }).references(
      () => assets.id,
      { onDelete: "restrict" }
    ),
    failureDetails: jsonb("failure_details_json").$type<GenerationFailure>(),
    createdBy: varchar("created_by", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    workspaceIdempotencyUnique: unique(
      "generation_attempt_workspace_idempotency_unique"
    ).on(table.workspaceId, table.idempotencyKey),
    productAttemptUnique: unique("generation_attempt_product_number_unique").on(
      table.productId,
      table.attemptNumber
    ),
    providerGenerationUnique: unique(
      "generation_attempt_provider_generation_unique"
    ).on(table.providerGenerationId),
    productHistoryIdx: index("generation_attempt_product_history_idx").on(
      table.productId,
      table.createdAt
    ),
    workspaceStatusIdx: index("generation_attempt_workspace_status_idx").on(
      table.workspaceId,
      table.status
    )
  })
);
