"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
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
  const pendingReviews = reviews.filter((review) => review.state === "pending");
  const completedReviews = reviews.filter(
    (review) => review.state !== "pending"
  );

  function renderReview(review: ReviewInboxItem) {
    return (
      <article className={styles.card} key={review.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageVariant(review.imageUrl, "thumbnail")}
          alt={`${review.productName} generated image ${review.attemptNumber}`}
          loading="lazy"
          decoding="async"
        />
        <div className={styles.body}>
          <div className={styles.titleRow}>
            <h2>{review.productName}</h2>
            <span
              className={`${styles.status} ${review.state === "pending" ? styles.pending : ""}`}
            >
              {review.state === "changes_requested"
                ? "Changes requested"
                : review.state}
            </span>
          </div>
          <p className={styles.meta}>
            {review.sku} · Image {review.attemptNumber} · Direction{" "}
            {review.sceneVersion}
          </p>
          <p className={styles.meta}>
            Sent{" "}
            {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
              new Date(review.createdAt)
            )}
          </p>
          <p className={styles.scene}>{review.sceneDirection}</p>
          <Link className={styles.openLink} href={`/reviews/${review.id}`}>
            {review.state === "pending" ? "Review image" : "View decision"}
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </article>
    );
  }

  return (
    <div className={styles.page}>
      <header
        className={styles.header}
        aria-label={`Review workspace for ${actorName}`}
      >
        <div>
          <strong>Home Goods Studio</strong>
          <span>Image review</span>
        </div>
        {accountControl}
      </header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>Review workspace</p>
            <h1>Assigned to you</h1>
          </div>
          <span>{pendingReviews.length} waiting for a decision</span>
        </div>
        {reviews.length ? (
          <div className={styles.reviewSections}>
            <section aria-labelledby="pending-heading">
              <div className={styles.sectionTitle}>
                <Clock3 aria-hidden="true" />
                <h2 id="pending-heading">Pending</h2>
                <span>{pendingReviews.length}</span>
              </div>
              {pendingReviews.length ? (
                <div className={styles.grid}>
                  {pendingReviews.map(renderReview)}
                </div>
              ) : (
                <div className={styles.compactEmpty}>No decisions waiting.</div>
              )}
            </section>
            <section aria-labelledby="completed-heading">
              <div className={styles.sectionTitle}>
                <CheckCircle2 aria-hidden="true" />
                <h2 id="completed-heading">Completed</h2>
                <span>{completedReviews.length}</span>
              </div>
              {completedReviews.length ? (
                <div className={styles.grid}>
                  {completedReviews.map(renderReview)}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  Completed reviews will appear here.
                </div>
              )}
            </section>
          </div>
        ) : (
          <section className={styles.empty}>
            <h2>No images to review yet</h2>
            <p>When Maya sends a generated image, it will appear here.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function imageVariant(url: string, variant: "thumbnail") {
  return `${url}${url.includes("?") ? "&" : "?"}variant=${variant}`;
}
