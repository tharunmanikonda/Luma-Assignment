import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db/client";
import {
  accounts,
  authRateLimits,
  sessions,
  users,
  verifications
} from "@/db/schema";
import { getEnv } from "@/shared/env";

const betterAuthSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  auth_rate_limits: authRateLimits
};

export const auth = betterAuth({
  appName: "Maya Home Goods",
  baseURL: getEnv().BETTER_AUTH_URL,
  secret: getEnv().BETTER_AUTH_SECRET,
  trustedOrigins: [getEnv().APP_ORIGIN],
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: betterAuthSchema
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "auth_rate_limits",
    customRules: {
      "/sign-in/email": {
        window: 60,
        max: 5
      }
    }
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"]
    }
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24
  },
  user: {
    additionalFields: {
      workspaceId: {
        type: "string",
        required: true,
        input: false
      },
      role: {
        type: "string",
        required: true,
        input: false
      },
      displayName: {
        type: "string",
        required: true,
        input: false
      }
    }
  },
  plugins: [nextCookies()]
});
