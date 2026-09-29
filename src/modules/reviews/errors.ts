export type ReviewErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "REVIEW_ALREADY_DECIDED"
  | "REVIEW_NOT_ELIGIBLE"
  | "IDEMPOTENCY_CONFLICT"
  | "VALIDATION_FAILED"
  | "INFRASTRUCTURE_UNAVAILABLE";

export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string>
  ) {
    super(message);
    this.name = "ReviewError";
  }
}
