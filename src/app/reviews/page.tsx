import { signOutAction } from "@/infrastructure/auth/sign-in";
import { requireRolePage } from "@/infrastructure/auth/session";
import { ReviewInbox } from "@/modules/reviews/components/review-inbox";
import { getReviewService } from "@/modules/reviews/service";

export default async function ReviewsPage() {
  const actor = await requireRolePage("approver");
  const reviews = await getReviewService().listAssignedReviews({ actor });

  return (
    <ReviewInbox
      actorName={actor.displayName}
      reviews={reviews}
      accountControl={
        <form action={signOutAction}>
          <button type="submit">Sign out</button>
        </form>
      }
    />
  );
}
