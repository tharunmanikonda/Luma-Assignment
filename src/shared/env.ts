import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  LOCAL_OBJECT_STORE_ROOT: z.string().min(1).default("./.local/object-store"),
  WORKER_ID: z.string().min(1).default("worker-local"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  DEMO_WORKSPACE_NAME: z.string().min(1).default("Maya Home Goods"),
  DEMO_MAYA_EMAIL: z.string().email(),
  DEMO_MAYA_PASSWORD: z.string().min(8),
  DEMO_ELLIE_EMAIL: z.string().email(),
  DEMO_ELLIE_PASSWORD: z.string().min(8),
  LUMA_API_KEY: z.string().optional(),
  DEMO_GENERATION_BUDGET_CENTS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(2500)
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }

  return cachedEnv;
}

export function resetEnvForTests() {
  cachedEnv = undefined;
}
