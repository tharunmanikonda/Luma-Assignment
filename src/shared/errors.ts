export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "INFRASTRUCTURE_UNAVAILABLE"
  | "PUBLIC_SIGNUP_DISABLED";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
    readonly fieldErrors?: Record<string, string>
  ) {
    super(message);
  }
}

export function toErrorEnvelope(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          requestId,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {})
        }
      }
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INFRASTRUCTURE_UNAVAILABLE",
        message: "Something went wrong. Try again in a moment.",
        retryable: true,
        requestId
      }
    }
  };
}
