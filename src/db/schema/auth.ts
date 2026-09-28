import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  varchar
} from "drizzle-orm/pg-core";
import { userRoleEnum, workspaces } from "./core";

export const users = pgTable(
  "user",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    displayName: text("display_name").notNull(),
    role: userRoleEnum("role").notNull(),
    workspaceId: varchar("workspace_id", { length: 32 })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    emailUnique: unique("user_email_unique").on(table.email),
    workspaceRoleIdx: index("user_workspace_role_idx").on(
      table.workspaceId,
      table.role
    )
  })
);

export const accounts = pgTable(
  "account",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: varchar("user_id", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true
    }),
    scope: text("scope"),
    password: text("password"),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    providerAccountUnique: unique("account_provider_account_unique").on(
      table.providerId,
      table.accountId
    ),
    userIdx: index("account_user_idx").on(table.userId)
  })
);

export const sessions = pgTable(
  "session",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    token: text("token").notNull(),
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: varchar("user_id", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    tokenUnique: unique("session_token_unique").on(table.token),
    tokenHashUnique: unique("session_token_hash_unique").on(table.tokenHash),
    userIdx: index("session_user_idx").on(table.userId),
    expiryIdx: index("session_expires_at_idx").on(table.expiresAt)
  })
);

export const verifications = pgTable("verification", {
  id: varchar("id", { length: 40 }).primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    key: text("key").notNull(),
    count: text("count").notNull(),
    lastRequest: timestamp("last_request", { withTimezone: true }).notNull()
  },
  (table) => ({
    keyUnique: unique("auth_rate_limits_key_unique").on(table.key)
  })
);
