import {
  bigint,
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
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["operator", "approver"]);
export const assetKindEnum = pgEnum("asset_kind", [
  "catalog_upload",
  "source_image",
  "generated_image",
  "approved_bundle"
]);
export const assetStatusEnum = pgEnum("asset_status", [
  "pending",
  "ready",
  "failed"
]);

export const workspaces = pgTable("workspaces", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const assets = pgTable(
  "assets",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 32 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    productId: varchar("product_id", { length: 40 }),
    kind: assetKindEnum("kind").notNull(),
    objectKey: text("object_key").notNull(),
    originalUrl: text("original_url"),
    filename: text("filename"),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum"),
    status: assetStatusEnum("status").notNull().default("pending"),
    failureDetailsJson: jsonb("failure_details_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    workspaceKindIdx: index("assets_workspace_kind_idx").on(
      table.workspaceId,
      table.kind
    ),
    objectKeyUnique: unique("assets_object_key_unique").on(table.objectKey)
  })
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    workspaceId: varchar("workspace_id", { length: 32 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    productId: varchar("product_id", { length: 40 }),
    actorType: text("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 40 }),
    eventType: text("event_type").notNull(),
    eventDataJson: jsonb("event_data_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    workspaceEventIdx: index("activity_events_workspace_event_idx").on(
      table.workspaceId,
      table.createdAt
    ),
    actorTypeCheck: check(
      "activity_events_actor_type_check",
      sql`${table.actorType} in ('user', 'worker', 'system')`
    )
  })
);
