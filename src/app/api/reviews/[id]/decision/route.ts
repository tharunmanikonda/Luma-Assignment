import { NextResponse } from "next/server";
import {
  requireJson,
  requireReviewActor,
  requireSameOrigin,
  withReviewApiErrors
} from "@/modules/reviews/api";
import { reviewDecisionSchema } from "@/modules/reviews/domain";
import { getReviewService } from "@/modules/reviews/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withReviewApiErrors(async () => {
    requireSameOrigin(request);
    requireJson(request);
    const actor = await requireReviewActor();
    const decision = reviewDecisionSchema.parse(await request.json());
    const { id } = await context.params;
    const review = await getReviewService().decideReview({
      actor,
      reviewId: id,
      idempotencyKey: request.headers.get("idempotency-key"),
      decision
    });
    return NextResponse.json(review);
  })();
}
