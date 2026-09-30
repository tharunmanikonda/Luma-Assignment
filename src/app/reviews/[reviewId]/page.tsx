import { redirect } from "next/navigation";
import { roleHomePath } from "@/infrastructure/auth/role-home";
import { getSessionActor } from "@/infrastructure/auth/session";
import { ReviewExperience } from "@/modules/reviews/components/review-experience";
import { ReviewUnavailable } from "@/modules/reviews/components/review-unavailable";
import { ReviewError } from "@/modules/reviews/errors";
import { getReviewService } from "@/modules/reviews/service";

export default async function ReviewPage({
  params
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  const actor = await getSessionActor();
  if (!actor) {
    redirect(`/sign-in?next=/reviews/${encodeURIComponent(reviewId)}`);
  }
  if (actor.role !== "approver") redirect(roleHomePath(actor.role));

  try {
    const review = await getReviewService().readAssignedReview({
      actor,
      reviewId
    });
    return <ReviewExperience review={review} />;
  } catch (error) {
    if (error instanceof ReviewError && error.code === "NOT_FOUND") {
      return <ReviewUnavailable />;
    }
    throw error;
  }
}
