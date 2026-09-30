"use client";

import Link from "next/link";
import React, { useState } from "react";
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
  const [view, setView] = useState<"pending" | "decided" | "all">("pending");
  const pendingCount = reviews.filter(
    (review) => review.state === "pending"
  ).length;
  const visibleReviews = reviews.filter((review) => {
    if (view === "pending") return review.state === "pending";
    if (view === "decided") return review.state !== "pending";
    return true;
  });

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
        <div className={styles.tabs} aria-label="Review inbox filters">
          <button
            type="button"
            aria-pressed={view === "pending"}
            onClick={() => setView("pending")}
          >
            Pending <span>{pendingCount}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === "decided"}
            onClick={() => setView("decided")}
          >
            Decided <span>{reviews.length - pendingCount}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === "all"}
            onClick={() => setView("all")}
          >
            All <span>{reviews.length}</span>
          </button>
        </div>
        {visibleReviews.length ? (
          <div className={styles.grid}>
            {visibleReviews.map((review) => (
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
                  <p className={styles.meta}>
                    Sent{" "}
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium"
                    }).format(new Date(review.createdAt))}
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
            <h2>
              {view === "pending"
                ? "You are all caught up"
                : "No reviews in this view"}
            </h2>
            <p>
              {reviews.length
                ? "Choose another filter to see the rest of your review history."
                : "When Maya sends a generated candidate, it will appear here."}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
