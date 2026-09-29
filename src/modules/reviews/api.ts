import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionActor } from "@/infrastructure/auth/session";
import { getEnv } from "@/shared/env";
import { newRequestId } from "@/shared/ids";
import type { ReviewActor } from "./domain";
import { ReviewError } from "./errors";

export async function requireReviewActor(): Promise<ReviewActor> {
  const actor = await getSessionActor();
  if (!actor) {
    throw new ReviewError("UNAUTHENTICATED", "Sign in to continue.", 401);
  }
  return actor;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(getEnv().APP_ORIGIN).origin) {
    throw new ReviewError(
      "BAD_REQUEST",
      "Request origin was not accepted.",
      400
    );
  }
}

export function requireJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new ReviewError(
      "BAD_REQUEST",
      "Use application/json for this request.",
      400
    );
  }
}

export function withReviewApiErrors(
  handler: (requestId: string) => Promise<Response>
) {
  return async function reviewApiRoute() {
    const requestId = newRequestId();
    try {
      const response = await handler(requestId);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      const normalized =
        error instanceof ReviewError
          ? error
          : error instanceof ZodError
            ? new ReviewError(
                "VALIDATION_FAILED",
                "Check the highlighted information and try again.",
                422,
                Object.fromEntries(
                  error.issues.map((issue) => [
                    issue.path.join(".") || "decision",
                    issue.message
                  ])
                )
              )
            : new ReviewError(
                "INFRASTRUCTURE_UNAVAILABLE",
                "Something went wrong. Try again in a moment.",
                500
              );
      return NextResponse.json(
        {
          error: {
            code: normalized.code,
            message: normalized.message,
            retryable: normalized.status >= 500,
            requestId,
            ...(normalized.fieldErrors
              ? { fieldErrors: normalized.fieldErrors }
              : {})
          }
        },
        { status: normalized.status, headers: { "x-request-id": requestId } }
      );
    }
  };
}
