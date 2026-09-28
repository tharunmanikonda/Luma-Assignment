import pino from "pino";
import { getEnv } from "./env";

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "*.password",
      "*.token",
      "*.secret"
    ],
    censor: "[redacted]"
  },
  transport:
    getEnv().NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true }
        }
      : undefined
});
