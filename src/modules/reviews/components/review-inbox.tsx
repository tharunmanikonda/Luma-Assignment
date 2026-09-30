import Link from "next/link";
import React from "react";
import styles from "./review-inbox.module.css";

export type ReviewInboxItem = {
  id: string;
  state: "pending" | "approved" | "changes_requested" | "revoked";
  productName: string;
  sku: string;
  attemptNumber: number;
  sceneVersion: number;
  sceneDirection: string;
  imageUrl: string;
  createdAt: string;
};

export function ReviewInbox({
  actorName,
  reviews,
  accountControl
}: {
  actorName: string;
  reviews: ReviewInboxItem[];
  accountControl: React.ReactNode;
}) {
  const pendingCount = reviews.filter(
    (review) => review.state === "pending"
  ).length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <strong>Maya Home Goods</strong>
          <span>Signed in as {actorName}</span>
        </div>
        {accountControl}
      </header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>Review workspace</p>
            <h1>Assigned to you</h1>
          </div>
          <span>{pendingCount} waiting for a decision</span>
        </div>
        {reviews.length ? (
          <div className={styles.grid}>
            {reviews.map((review) => (
              <article className={styles.card} key={review.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={review.imageUrl}
                  alt={`${review.productName} candidate ${review.attemptNumber}`}
                />
                <div className={styles.body}>
                  <div className={styles.titleRow}>
                    <h2>{review.productName}</h2>
                    <span
                      className={`${styles.status} ${review.state === "pending" ? styles.pending : ""}`}
                    >
                      {review.state.replace("_", " ")}
                    </span>
                  </div>
                  <p className={styles.meta}>
                    {review.sku} · Candidate {review.attemptNumber} · Scene{" "}
                    {review.sceneVersion}
                  </p>
                  <p className={styles.scene}>{review.sceneDirection}</p>
                  <Link
                    className={styles.openLink}
                    href={`/reviews/${review.id}`}
                  >
                    {review.state === "pending"
                      ? "Review candidate"
                      : "View decision"}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <section className={styles.empty}>
            <h2>No reviews assigned yet</h2>
            <p>When Maya sends a generated candidate, it will appear here.</p>
          </section>
        )}
      </main>
    </div>
  );
}
