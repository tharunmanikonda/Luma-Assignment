import { describe, expect, it } from "vitest";
import type {
  ReviewActor,
  ReviewDecisionInput,
  ReviewHistoryCursor,
  ReviewHistoryItem,
  ReviewRecord
} from "./domain";
import { reviewDecisionSchema } from "./domain";
import { ReviewError } from "./errors";
import { ReviewService } from "./service";
import type { CreateReviewCommand, ReviewStore } from "./store";

const maya: ReviewActor = {
  id: "user_maya",
  workspaceId: "ws_demo",
  role: "operator"
};
const ellie: ReviewActor = {
  id: "user_ellie",
  workspaceId: "ws_demo",
  role: "approver"
};
const anotherApprover: ReviewActor = {
  id: "user_other",
  workspaceId: "ws_demo",
  role: "approver"
};

function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "review_1",
    generationAttemptId: "attempt_2",
    workspaceId: "ws_demo",
    productId: "product_mug",
    approverUserId: ellie.id,
    createdBy: maya.id,
    state: "pending",
    feedback: null,
    decisionActorId: null,
    createIdempotencyKey: "create-review-key",
    decisionIdempotencyKey: null,
    revokeIdempotencyKey: null,
    productName: "Stoneware Mug",
    sku: "HG-002",
    category: "Drinkware",
    colorFinish: "Speckled white",
    material: "Stoneware",
    attemptNumber: 2,
    sceneVersion: 2,
    sceneDirection: "Morning counter with soft window light.",
    sourceAssetId: "asset_source",
    candidateAssetId: "asset_candidate_2",
    createdAt: new Date("2026-09-28T12:00:00Z"),
    decidedAt: null,
    revokedAt: null,
    ...overrides
  };
}

class MemoryReviewStore implements ReviewStore {
  review = makeReview();
  createCalls = 0;
  decisionCalls = 0;
  history: ReviewHistoryItem[] = [
    {
      reviewId: "review_0",
      attemptId: "attempt_1",
      attemptNumber: 1,
      candidateAssetId: "asset_candidate_1",
      sceneDirection: "Morning counter with warm light.",
      sceneVersion: 1,
      state: "changes_requested",
      feedback: "Keep the glaze cooler and reduce the orange light.",
      decidedAt: new Date("2026-09-27T12:00:00Z"),
      createdAt: new Date("2026-09-27T10:00:00Z")
    },
    {
      reviewId: "review_1",
      attemptId: "attempt_2",
      attemptNumber: 2,
      candidateAssetId: "asset_candidate_2",
      sceneDirection: "Morning counter with soft window light.",
      sceneVersion: 2,
      state: "pending",
      feedback: null,
      decidedAt: null,
      createdAt: new Date("2026-09-28T12:00:00Z")
    }
  ];

  async create(command: CreateReviewCommand) {
    this.createCalls += 1;
    if (command.generationAttemptId !== this.review.generationAttemptId) {
      throw new ReviewError(
        "IDEMPOTENCY_CONFLICT",
        "That request key was already used for another candidate.",
        409
      );
    }
    return this.review;
  }

  async revoke(input: {
    reviewId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
  }) {
    if (
      input.reviewId !== this.review.id ||
      input.workspaceId !== this.review.workspaceId
    ) {
      throw new ReviewError("NOT_FOUND", "Review not found.", 404);
    }
    if (this.review.state === "revoked") return this.review;
    if (this.review.state !== "pending") {
      throw new ReviewError(
        "REVIEW_ALREADY_DECIDED",
        "This review already has a final decision.",
        409
      );
    }
    this.review = {
      ...this.review,
      state: "revoked",
      revokeIdempotencyKey: input.idempotencyKey,
      revokedAt: new Date("2026-09-28T13:00:00Z")
    };
    return this.review;
  }

  async decide(input: {
    reviewId: string;
    approverUserId: string;
    idempotencyKey: string;
    decision: ReviewDecisionInput;
  }) {
    this.decisionCalls += 1;
    if (
      input.reviewId !== this.review.id ||
      input.approverUserId !== this.review.approverUserId
    ) {
      throw new ReviewError("NOT_FOUND", "Review unavailable.", 404);
    }
    const feedback =
      input.decision.decision === "changes_requested"
        ? input.decision.feedback.trim()
        : null;
    if (this.review.state !== "pending") {
      if (
        this.review.state === input.decision.decision &&
        (this.review.state !== "changes_requested" ||
          this.review.feedback === feedback)
      ) {
        return this.review;
      }
      throw new ReviewError(
        "REVIEW_ALREADY_DECIDED",
        "This review already has a final decision.",
        409
      );
    }
    this.review = {
      ...this.review,
      state: input.decision.decision,
      feedback,
      decisionActorId: input.approverUserId,
      decisionIdempotencyKey: input.idempotencyKey,
      decidedAt: new Date("2026-09-28T13:00:00Z")
    };
    return this.review;
  }

  async findAssigned(reviewId: string, approverUserId: string) {
    return reviewId === this.review.id &&
      approverUserId === this.review.approverUserId &&
      this.review.state !== "revoked"
      ? this.review
      : null;
  }

  async listAssigned(approverUserId: string) {
    return approverUserId === this.review.approverUserId &&
      this.review.state !== "revoked"
      ? [this.review]
      : [];
  }

  async findForOperator(reviewId: string, workspaceId: string) {
    return reviewId === this.review.id &&
      workspaceId === this.review.workspaceId
      ? this.review
      : null;
  }

  async listForOperatorProduct(productId: string, workspaceId: string) {
    return this.review.productId === productId &&
      this.review.workspaceId === workspaceId
      ? [this.review]
      : [];
  }

  async listHistory(
    _productId: string,
    throughAttemptNumber: number,
    after: ReviewHistoryCursor | null,
    limit: number
  ) {
    return this.history
      .filter(
        (item) =>
          item.attemptNumber < throughAttemptNumber &&
          (!after ||
            item.attemptNumber > after.attemptNumber ||
            (item.attemptNumber === after.attemptNumber &&
              item.attemptId > after.attemptId))
      )
      .sort(
        (left, right) =>
          left.attemptNumber - right.attemptNumber ||
          left.attemptId.localeCompare(right.attemptId)
      )
      .slice(0, limit);
  }
}

function setup() {
  const store = new MemoryReviewStore();
  return {
    store,
    service: new ReviewService(store, "http://localhost:3000")
  };
}

describe("ReviewService", () => {
  it("returns the same immutable review and stable URL for a repeated create", async () => {
    const { service, store } = setup();
    const input = {
      actor: maya,
      generationAttemptId: "attempt_2",
      idempotencyKey: "create-review-key"
    };

    const [first, repeated] = await Promise.all([
      service.createReview(input),
      service.createReview(input)
    ]);
    expect(first).toEqual(repeated);
    expect(first.reviewUrl).toBe("http://localhost:3000/reviews/review_1");
    expect(store.review.generationAttemptId).toBe("attempt_2");
  });

  it("hides a review from the wrong account", async () => {
    const { service } = setup();
    await expect(
      service.readAssignedReview({
        actor: anotherApprover,
        reviewId: "review_1"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      service.decideReview({
        actor: maya,
        reviewId: "review_1",
        idempotencyKey: "decision-key-1",
        decision: { decision: "approved" }
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("returns only approver-safe current and historical fields", async () => {
    const { service } = setup();
    const result = await service.readAssignedReview({
      actor: ellie,
      reviewId: "review_1"
    });
    const serialized = JSON.stringify(result);

    expect(result.canDecide).toBe(true);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].feedback).toMatch(/glaze cooler/);
    expect(serialized).not.toMatch(/provider|cost|objectKey|internal/i);
  });

  it("lists the operator review status needed to restore a product panel", async () => {
    const { service } = setup();
    await expect(
      service.listOperatorStatuses({ actor: maya, productId: "product_mug" })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "review_1",
        generationAttemptId: "attempt_2",
        state: "pending",
        reviewUrl: "http://localhost:3000/reviews/review_1"
      })
    ]);
  });

  it("paginates history in stable order without exposing future candidates", async () => {
    const { service, store } = setup();
    store.review = makeReview({ attemptNumber: 15 });
    store.history = Array.from({ length: 16 }, (_, index) => {
      const attemptNumber = index + 1;
      return {
        reviewId: `review_${attemptNumber}`,
        attemptId: `attempt_${String(attemptNumber).padStart(2, "0")}`,
        attemptNumber,
        candidateAssetId: `asset_${attemptNumber}`,
        sceneDirection: `Scene ${attemptNumber}`,
        sceneVersion: attemptNumber,
        state: "changes_requested" as const,
        feedback: `Feedback ${attemptNumber}`,
        decidedAt: new Date("2026-09-27T12:00:00Z"),
        createdAt: new Date("2026-09-27T10:00:00Z")
      };
    });

    const first = await service.readAssignedReview({
      actor: ellie,
      reviewId: "review_1"
    });
    expect(first.history.map((item) => item.attemptNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    ]);
    expect(first.historyNextCursor).toBeTruthy();

    const second = await service.readAssignedReview({
      actor: ellie,
      reviewId: "review_1",
      historyCursor: first.historyNextCursor
    });
    expect(second.history.map((item) => item.attemptNumber)).toEqual([
      11, 12, 13, 14
    ]);
    expect(second.historyNextCursor).toBeNull();
    expect(
      [...first.history, ...second.history].some(
        (item) => item.attemptNumber >= 15
      )
    ).toBe(false);
  });

  it("rejects malformed history cursors", async () => {
    const { service } = setup();
    await expect(
      service.readAssignedReview({
        actor: ellie,
        reviewId: "review_1",
        historyCursor: "not-a-valid-cursor"
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("requires meaningful feedback for requested changes", () => {
    expect(() =>
      reviewDecisionSchema.parse({
        decision: "changes_requested",
        feedback: "  "
      })
    ).toThrow();
  });

  it("allows one terminal decision and makes identical repeats idempotent", async () => {
    const { service } = setup();
    const input = {
      actor: ellie,
      reviewId: "review_1",
      idempotencyKey: "decision-key-1",
      decision: {
        decision: "changes_requested" as const,
        feedback: "Keep the product shape exact."
      }
    };

    const first = await service.decideReview(input);
    const repeated = await service.decideReview(input);
    expect(first).toEqual(repeated);
    expect(first.state).toBe("changes_requested");
    expect(first.feedback).toBe("Keep the product shape exact.");
  });

  it("makes the first concurrent decision win and rejects the conflict", async () => {
    const { service } = setup();
    const outcomes = await Promise.allSettled([
      service.decideReview({
        actor: ellie,
        reviewId: "review_1",
        idempotencyKey: "decision-key-1",
        decision: { decision: "approved" }
      }),
      service.decideReview({
        actor: ellie,
        reviewId: "review_1",
        idempotencyKey: "decision-key-2",
        decision: {
          decision: "changes_requested",
          feedback: "Use cooler light."
        }
      })
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      reason: { code: "REVIEW_ALREADY_DECIDED", status: 409 }
    });
  });

  it("revokes pending reviews and removes Ellie access while preserving Maya audit access", async () => {
    const { service } = setup();
    const input = {
      actor: maya,
      reviewId: "review_1",
      idempotencyKey: "revoke-key-1"
    };
    const revoked = await service.revokeReview(input);
    const repeated = await service.revokeReview(input);

    expect(revoked).toEqual(repeated);
    await expect(
      service.readAssignedReview({
        actor: ellie,
        reviewId: "review_1"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      service.listAssignedReviews({ actor: ellie })
    ).resolves.toEqual([]);
    await expect(
      service.readOperatorStatus({ actor: maya, reviewId: "review_1" })
    ).resolves.toEqual(
      expect.objectContaining({ id: "review_1", state: "revoked" })
    );
  });

  it("exposes feedback as a causal revision context without generating", async () => {
    const { service } = setup();
    await service.decideReview({
      actor: ellie,
      reviewId: "review_1",
      idempotencyKey: "decision-key-1",
      decision: {
        decision: "changes_requested",
        feedback: "Reduce the orange cast."
      }
    });

    await expect(
      service.getRevisionContext({ actor: maya, reviewId: "review_1" })
    ).resolves.toEqual({
      basedOnReviewRequestId: "review_1",
      productId: "product_mug",
      previousSceneDirection: "Morning counter with soft window light.",
      feedback: "Reduce the orange cast."
    });
  });
});
it("lists Ellie's assigned candidates for her review inbox", async () => {
  const { service } = setup();
  await expect(service.listAssignedReviews({ actor: ellie })).resolves.toEqual([
    expect.objectContaining({
      id: "review_1",
      state: "pending",
      productName: "Stoneware Mug",
      sku: "HG-002",
      imageUrl: "/api/assets/asset_candidate_2/content"
    })
  ]);
  await expect(
    service.listAssignedReviews({ actor: maya })
  ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
});
