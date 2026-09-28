import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "true";

export async function resetFoundationDatabase() {
  await getDb().execute(sql`
    truncate table
      "session",
      "account",
      "verification",
      "auth_rate_limits",
      "user",
      "jobs",
      "activity_events",
      "assets",
      "workspaces"
    restart identity cascade
  `);
}
