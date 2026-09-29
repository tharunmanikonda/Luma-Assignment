import { z } from "zod";

export const reviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approved") }).strict(),
  z
    .object({
      decision: z.literal("changes_requested"),
      feedback: z.string().trim().min(3).max(1_000)
    })
    .strict()
]);

export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
export type ReviewState =
  "pending" | "approved" | "changes_requested" | "revoked";

export interface ReviewActor {
  id: string;
  workspaceId: string;
  role: "operator" | "approver";
}

export interface ReviewRecord {
  id: string;
  generationAttemptId: string;
  workspaceId: string;
  productId: string;
  approverUserId: string;
  createdBy: string;
  state: ReviewState;
  feedback: string | null;
  decisionActorId: string | null;
  createIdempotencyKey: string;
  decisionIdempotencyKey: string | null;
  revokeIdempotencyKey: string | null;
  productName: string;
  sku: string;
  category: string | null;
  colorFinish: string | null;
  material: string | null;
  attemptNumber: number;
  sceneVersion: number;
  sceneDirection: string;
  sourceAssetId: string;
  candidateAssetId: string;
  createdAt: Date;
  decidedAt: Date | null;
  revokedAt: Date | null;
}

export interface ReviewHistoryItem {
  reviewId: string | null;
  attemptId: string;
  attemptNumber: number;
  candidateAssetId: string;
  sceneDirection: string;
  sceneVersion: number;
  state: ReviewState | "not_sent";
  feedback: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface ReviewHistoryCursor {
  attemptNumber: number;
  attemptId: string;
}

export interface ReviewReadModel {
  id: string;
  state: ReviewState;
  product: {
    name: string;
    sku: string;
    category: string | null;
    colorFinish: string | null;
    material: string | null;
  };
  candidate: {
    attemptNumber: number;
    sceneVersion: number;
    sceneDirection: string;
    imageUrl: string;
    imageAlt: string;
  };
  source: {
    imageUrl: string;
    imageAlt: string;
  };
  feedback: string | null;
  createdAt: string;
  decidedAt: string | null;
  revokedAt: string | null;
  canDecide: boolean;
  historyNextCursor: string | null;
  history: Array<{
    reviewId: string | null;
    attemptId: string;
    attemptNumber: number;
    imageUrl: string;
    sceneDirection: string;
    sceneVersion: number;
    state: ReviewState | "not_sent";
    feedback: string | null;
    decidedAt: string | null;
    createdAt: string;
  }>;
}
