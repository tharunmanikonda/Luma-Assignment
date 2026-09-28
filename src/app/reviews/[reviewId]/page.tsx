import { signOutAction } from "@/infrastructure/auth/sign-in";
import { requireRolePage } from "@/infrastructure/auth/session";

export default async function ReviewPlaceholderPage({
  params
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const actor = await requireRolePage("approver");
  const { reviewId } = await params;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">Review</div>
          <div className="muted">Signed in as {actor.displayName}</div>
        </div>
        <form action={signOutAction}>
          <button className="button secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <section className="card">
        <h1>Review unavailable</h1>
        <p className="muted">
          Review {reviewId} will be loaded by Task 04 once immutable review
          requests exist.
        </p>
      </section>
    </main>
  );
}
