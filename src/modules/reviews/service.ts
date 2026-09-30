import { getEnv } from "@/shared/env";
import type {
  ReviewActor,
  ReviewDecisionInput,
  ReviewHistoryCursor,
  ReviewHistoryItem,
  ReviewReadModel,
  ReviewRecord
} from "./domain";
import { ReviewError } from "./errors";
import { PostgresReviewStore, type ReviewStore } from "./store";

const HISTORY_PAGE_SIZE = 10;

function encodeHistoryCursor(item: ReviewHistoryItem) {
  return Buffer.from(
    JSON.stringify({
      attemptNumber: item.attemptNumber,
      attemptId: item.attemptId
    })
  ).toString("base64url");
}

function decodeHistoryCursor(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<ReviewHistoryCursor>;
    if (
      !Number.isSafeInteger(parsed.attemptNumber) ||
      (parsed.attemptNumber ?? 0) < 1 ||
      typeof parsed.attemptId !== "string" ||
      parsed.attemptId.length < 1 ||
      parsed.attemptId.length > 40
    ) {
      throw new Error("Invalid cursor");
    }
    return parsed as ReviewHistoryCursor;
  } catch {
    throw new ReviewError("BAD_REQUEST", "History cursor is invalid.", 400);
  }
}

function requireIdempotencyKey(value: string | null | undefined) {
  const key = value?.trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new ReviewError(
      "BAD_REQUEST",
      "A valid Idempotency-Key header is required.",
      400
    );
  }
  return key;
}

function assetUrl(assetId: string) {
  return `/api/assets/${encodeURIComponent(assetId)}/content`;
}

function toMutationResult(review: ReviewRecord, appOrigin: string) {
  return {
    id: review.id,
    generationAttemptId: review.generationAttemptId,
    state: review.state,
    feedback: review.feedback,
    createdAt: review.createdAt.toISOString(),
    decidedAt: review.decidedAt?.toISOString() ?? null,
    revokedAt: review.revokedAt?.toISOString() ?? null,
    reviewUrl: new URL(`/reviews/${review.id}`, appOrigin).toString()
  };
}

export class ReviewService {
  constructor(
    private readonly store: ReviewStore,
    private readonly appOrigin: string
  ) {}

  async createReview(input: {
    actor: ReviewActor;
    generationAttemptId: string;
    idempotencyKey?: string | null;
  }) {
    if (input.actor.role !== "operator") {
      throw new ReviewError("NOT_FOUND", "Candidate not found.", 404);
    }
    const review = await this.store.create({
      generationAttemptId: input.generationAttemptId,
      workspaceId: input.actor.workspaceId,
      createdBy: input.actor.id,
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey)
    });
    return toMutationResult(review, this.appOrigin);
  }

  async revokeReview(input: {
    actor: ReviewActor;
    reviewId: string;
    idempotencyKey?: string | null;
  }) {
    if (input.actor.role !== "operator") {
      throw new ReviewError("NOT_FOUND", "Review not found.", 404);
    }
    const review = await this.store.revoke({
      reviewId: input.reviewId,
      workspaceId: input.actor.workspaceId,
      actorId: input.actor.id,
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey)
    });
    return toMutationResult(review, this.appOrigin);
  }

  async readAssignedReview(input: {
    actor: ReviewActor;
    reviewId: string;
    historyCursor?: string | null;
  }): Promise<ReviewReadModel> {
    if (input.actor.role !== "approver") {
      throw new ReviewError("NOT_FOUND", "Review unavailable.", 404);
    }
    const review = await this.store.findAssigned(
      input.reviewId,
      input.actor.id
    );
    if (!review) throw new ReviewError("NOT_FOUND", "Review unavailable.", 404);
    const historyPage = await this.store.listHistory(
      review.productId,
      review.attemptNumber,
      decodeHistoryCursor(input.historyCursor),
      HISTORY_PAGE_SIZE + 1
    );
    const hasMore = historyPage.length > HISTORY_PAGE_SIZE;
    const history = historyPage.slice(0, HISTORY_PAGE_SIZE);

    return {
      id: review.id,
      state: review.state,
      product: {
        name: review.productName,
        sku: review.sku,
        category: review.category,
        colorFinish: review.colorFinish,
        material: review.material
      },
      candidate: {
        attemptNumber: review.attemptNumber,
        sceneVersion: review.sceneVersion,
        sceneDirection: review.sceneDirection,
        imageUrl: assetUrl(review.candidateAssetId),
        imageAlt: `Generated image for ${review.productName}`
      },
      source: {
        imageUrl: assetUrl(review.sourceAssetId),
        imageAlt: `Original product photo of ${review.productName}`
      },
      feedback: review.feedback,
      createdAt: review.createdAt.toISOString(),
      decidedAt: review.decidedAt?.toISOString() ?? null,
      revokedAt: review.revokedAt?.toISOString() ?? null,
      canDecide: review.state === "pending",
      historyNextCursor: hasMore
        ? encodeHistoryCursor(history[history.length - 1]!)
        : null,
      history: history.map((item) => ({
        reviewId: item.reviewId,
        attemptId: item.attemptId,
        attemptNumber: item.attemptNumber,
        imageUrl: assetUrl(item.candidateAssetId),
        sceneDirection: item.sceneDirection,
        sceneVersion: item.sceneVersion,
        state: item.state,
        feedback: item.feedback,
        decidedAt: item.decidedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString()
      }))
    };
  }

  async decideReview(input: {
    actor: ReviewActor;
    reviewId: string;
    idempotencyKey?: string | null;
    decision: ReviewDecisionInput;
  }) {
    if (input.actor.role !== "approver") {
      throw new ReviewError("NOT_FOUND", "Review unavailable.", 404);
    }
    const review = await this.store.decide({
      reviewId: input.reviewId,
      approverUserId: input.actor.id,
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey),
      decision: input.decision
    });
    return toMutationResult(review, this.appOrigin);
  }

  async listAssignedReviews(input: { actor: ReviewActor }) {
    if (input.actor.role !== "approver") {
      throw new ReviewError("NOT_FOUND", "Reviews unavailable.", 404);
    }
    const reviews = await this.store.listAssigned(input.actor.id);
    return reviews.map((review) => ({
      id: review.id,
      state: review.state,
      productName: review.productName,
      sku: review.sku,
      attemptNumber: review.attemptNumber,
      sceneVersion: review.sceneVersion,
      sceneDirection: review.sceneDirection,
      imageUrl: assetUrl(review.candidateAssetId),
      createdAt: review.createdAt.toISOString(),
      decidedAt: review.decidedAt?.toISOString() ?? null
    }));
  }

  async readOperatorStatus(input: { actor: ReviewActor; reviewId: string }) {
    if (input.actor.role !== "operator") {
      throw new ReviewError("NOT_FOUND", "Review not found.", 404);
    }
    const review = await this.store.findForOperator(
      input.reviewId,
      input.actor.workspaceId
    );
    if (!review) throw new ReviewError("NOT_FOUND", "Review not found.", 404);
    return toMutationResult(review, this.appOrigin);
  }

  async listOperatorStatuses(input: { actor: ReviewActor; productId: string }) {
    if (input.actor.role !== "operator") {
      throw new ReviewError("NOT_FOUND", "Reviews not found.", 404);
    }
    const reviews = await this.store.listForOperatorProduct(
      input.productId,
      input.actor.workspaceId
    );
    return reviews.map((review) => toMutationResult(review, this.appOrigin));
  }

  async getRevisionContext(input: { actor: ReviewActor; reviewId: string }) {
    if (input.actor.role !== "operator") {
      throw new ReviewError("NOT_FOUND", "Review not found.", 404);
    }
    const review = await this.store.findForOperator(
      input.reviewId,
      input.actor.workspaceId
    );
    if (!review) throw new ReviewError("NOT_FOUND", "Review not found.", 404);
    if (review.state !== "changes_requested" || !review.feedback) {
      throw new ReviewError(
        "REVIEW_NOT_ELIGIBLE",
        "Only requested changes can start a revision.",
        409
      );
    }
    return {
      basedOnReviewRequestId: review.id,
      productId: review.productId,
      previousSceneDirection: review.sceneDirection,
      feedback: review.feedback
    };
  }
}

let service: ReviewService | undefined;

export function getReviewService() {
  service ??= new ReviewService(new PostgresReviewStore(), getEnv().APP_ORIGIN);
  return service;
}
