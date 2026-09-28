import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getEnv } from "@/shared/env";
import * as schema from "./schema";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Database | undefined;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 10
    });
  }

  return pool;
}

export function getDb(): Database {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }

  return db;
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
