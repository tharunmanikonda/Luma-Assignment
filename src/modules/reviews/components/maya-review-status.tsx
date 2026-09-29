import styles from "./review.module.css";

export function MayaReviewStatus({
  state,
  feedback,
  reviewUrl,
  createdAt
}: {
  state: "pending" | "approved" | "changes_requested" | "revoked";
  feedback: string | null;
  reviewUrl: string;
  createdAt: string;
}) {
  const labels = {
    pending: "Waiting for Ellie",
    approved: "Approved",
    changes_requested: "Changes requested",
    revoked: "Request revoked"
  } as const;

  return (
    <section
      className={styles.mayaStatus}
      aria-labelledby="review-status-title"
    >
      <div>
        <p className={styles.eyebrow}>Ellie review</p>
        <h2 id="review-status-title">{labels[state]}</h2>
        <p className={styles.subtle}>Created {formatDate(createdAt)}</p>
      </div>
      {state === "changes_requested" && feedback ? (
        <blockquote>“{feedback}”</blockquote>
      ) : null}
      <a href={reviewUrl}>Open review link</a>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value)
  );
}
