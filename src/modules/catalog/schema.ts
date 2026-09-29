import { sql } from "drizzle-orm";
import {
  check,
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
import { assets, workspaces } from "@/db/schema/core";
import { users } from "@/db/schema/auth";

export const ingestionBatchStatusEnum = pgEnum("ingestion_batch_status", [
  "uploaded",
  "validating",
  "ready",
  "committing",
  "committed",
  "failed"
]);

export const sceneBriefSourceEnum = pgEnum("scene_brief_source", [
  "imported",
  "maya_edited",
  "revision_feedback"
]);

export const products = pgTable(
  "products",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 32 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    colorFinish: text("color_finish"),
    material: text("material"),
    priceMinor: integer("price_minor"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    notes: text("notes"),
    currentSourceAssetId: varchar("current_source_asset_id", {
      length: 40
    }).references(() => assets.id, { onDelete: "restrict" }),
    currentSceneBriefId: varchar("current_scene_brief_id", { length: 40 }),
    targetApprovedImages: integer("target_approved_images")
      .notNull()
      .default(2),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    workspaceSkuUnique: unique("products_workspace_sku_unique").on(
      table.workspaceId,
      table.sku
    ),
    workspaceUpdatedIdx: index("products_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
      table.id
    ),
    targetCheck: check(
      "products_target_approved_images_check",
      sql`${table.targetApprovedImages} > 0`
    )
  })
);

export const sceneBriefs = pgTable(
  "scene_briefs",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    productId: varchar("product_id", { length: 40 })
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    text: text("text").notNull(),
    source: sceneBriefSourceEnum("source").notNull(),
    basedOnReviewId: varchar("based_on_review_id", { length: 40 }),
    createdBy: varchar("created_by", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    productVersionUnique: unique("scene_briefs_product_version_unique").on(
      table.productId,
      table.version
    ),
    productCreatedIdx: index("scene_briefs_product_created_idx").on(
      table.productId,
      table.createdAt,
      table.id
    )
  })
);

export const ingestionBatches = pgTable(
  "ingestion_batches",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 32 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    sourceType: text("source_type").notNull().default("csv"),
    sourceAssetId: varchar("source_asset_id", { length: 40 })
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: ingestionBatchStatusEnum("status").notNull().default("uploaded"),
    failureMessage: text("failure_message"),
    createdBy: varchar("created_by", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true })
  },
  (table) => ({
    workspaceIdempotencyUnique: unique(
      "ingestion_batches_workspace_idempotency_unique"
    ).on(table.workspaceId, table.idempotencyKey),
    workspaceCreatedIdx: index("ingestion_batches_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt
    )
  })
);

export type IngestionRowError = {
  field: string;
  code: string;
  message: string;
};

export const ingestionItems = pgTable(
  "ingestion_items",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    batchId: varchar("batch_id", { length: 40 })
      .notNull()
      .references(() => ingestionBatches.id, { onDelete: "cascade" }),
    sourceRowNumber: integer("source_row_number"),
    rawDataJson: jsonb("raw_data_json")
      .$type<Record<string, string>>()
      .notNull(),
    validationErrorsJson: jsonb("validation_errors_json")
      .$type<IngestionRowError[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    productId: varchar("product_id", { length: 40 }).references(
      () => products.id,
      { onDelete: "restrict" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    batchRowUnique: unique("ingestion_items_batch_row_unique").on(
      table.batchId,
      table.sourceRowNumber
    ),
    batchIdx: index("ingestion_items_batch_idx").on(table.batchId)
  })
);
