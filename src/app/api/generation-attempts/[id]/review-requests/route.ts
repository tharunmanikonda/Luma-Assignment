import { NextResponse } from "next/server";
import {
  requireReviewActor,
  requireSameOrigin,
  withReviewApiErrors
} from "@/modules/reviews/api";
import { getReviewService } from "@/modules/reviews/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withReviewApiErrors(async () => {
    requireSameOrigin(request);
    const actor = await requireReviewActor();
    const { id } = await context.params;
    const review = await getReviewService().createReview({
      actor,
      generationAttemptId: id,
      idempotencyKey: request.headers.get("idempotency-key")
    });
    return NextResponse.json(review, { status: 201 });
  })();
}
