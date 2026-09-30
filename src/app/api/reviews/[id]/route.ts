import { NextResponse } from "next/server";
import { requireReviewActor, withReviewApiErrors } from "@/modules/reviews/api";
import { getReviewService } from "@/modules/reviews/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withReviewApiErrors(async () => {
    const actor = await requireReviewActor();
    const { id } = await context.params;
    const review =
      actor.role === "operator"
        ? await getReviewService().readOperatorStatus({ actor, reviewId: id })
        : await getReviewService().readAssignedReview({
            actor,
            reviewId: id,
            historyCursor: new URL(request.url).searchParams.get(
              "historyCursor"
            )
          });
    return NextResponse.json(review);
  })();
}
