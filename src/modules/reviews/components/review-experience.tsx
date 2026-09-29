"use client";

import Image from "next/image";
import React from "react";
import { useEffect, useRef, useState } from "react";
import type { ReviewReadModel, ReviewState } from "../domain";
import styles from "./review.module.css";

const statusLabels: Record<ReviewState | "not_sent", string> = {
  pending: "Waiting for your decision",
  approved: "Approved",
  changes_requested: "Changes requested",
  revoked: "Request revoked",
  not_sent: "Not sent for review"
};

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function makeDecisionKey(reviewId: string) {
  return `review:${reviewId}:${crypto.randomUUID()}`;
}

export function ReviewExperience({ review }: { review: ReviewReadModel }) {
  const [state, setState] = useState(review.state);
  const [feedback, setFeedback] = useState(review.feedback ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [history, setHistory] = useState(review.history);
  const [historyCursor, setHistoryCursor] = useState(review.historyNextCursor);
  const [error, setError] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const decisionKey = useRef(makeDecisionKey(review.id));

  useEffect(() => {
    if (sheetOpen) feedbackRef.current?.focus();
  }, [sheetOpen]);

  const canDecide = review.canDecide && state === "pending";

  async function submitDecision(
    decision:
      | { decision: "approved" }
      | { decision: "changes_requested"; feedback: string }
  ) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/reviews/${review.id}/decision`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": decisionKey.current
        },
        body: JSON.stringify(decision)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Your decision could not be saved."
        );
      }
      setState(payload.state);
      setFeedback(payload.feedback ?? "");
      setSheetOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your decision could not be saved."
      );
    } finally {
      setPending(false);
    }
  }

  function approve() {
    if (!window.confirm("Approve this image for Maya to use?")) return;
    void submitDecision({ decision: "approved" });
  }

  function requestChanges() {
    const trimmed = feedback.trim();
    if (trimmed.length < 3) {
      setError("Add a short note so Maya knows what to change.");
      feedbackRef.current?.focus();
      return;
    }
    void submitDecision({
      decision: "changes_requested",
      feedback: trimmed
    });
  }

  async function loadMoreHistory() {
    if (!historyCursor) return;
    setHistoryPending(true);
    setHistoryError(null);
    try {
      const response = await fetch(
        `/api/reviews/${review.id}?historyCursor=${encodeURIComponent(historyCursor)}`
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Earlier versions could not be loaded."
        );
      }
      setHistory((current) => [
        ...current,
        ...payload.history.filter(
          (item: ReviewReadModel["history"][number]) =>
            !current.some((existing) => existing.attemptId === item.attemptId)
        )
      ]);
      setHistoryCursor(payload.historyNextCursor);
    } catch (caught) {
      setHistoryError(
        caught instanceof Error
          ? caught.message
          : "Earlier versions could not be loaded."
      );
    } finally {
      setHistoryPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.brand}>Maya Home Goods</div>
          <div className={styles.version}>
            Version {review.candidate.attemptNumber}
          </div>
        </div>
        <span className={`${styles.status} ${styles[`status_${state}`]}`}>
          {statusLabels[state]}
        </span>
      </header>

      <section className={styles.hero} aria-labelledby="review-title">
        <button
          className={styles.imageButton}
          type="button"
          onClick={() => setZoomOpen(true)}
          aria-label={`Enlarge ${review.candidate.imageAlt}`}
        >
          <Image
            className={styles.heroImage}
            src={review.candidate.imageUrl}
            alt={review.candidate.imageAlt}
            width={1200}
            height={1200}
            priority
            unoptimized
          />
          <span className={styles.zoomHint}>Tap to inspect</span>
        </button>
        <div className={styles.identity}>
          <p className={styles.eyebrow}>{review.product.sku}</p>
          <h1 id="review-title">{review.product.name}</h1>
          <a className={styles.originalLink} href="#original">
            View original
          </a>
        </div>
      </section>

      <section className={styles.details} aria-label="Review details">
        <dl className={styles.facts}>
          {review.product.category ? (
            <div>
              <dt>Category</dt>
              <dd>{review.product.category}</dd>
            </div>
          ) : null}
          {review.product.material ? (
            <div>
              <dt>Material</dt>
              <dd>{review.product.material}</dd>
            </div>
          ) : null}
          {review.product.colorFinish ? (
            <div>
              <dt>Color / finish</dt>
              <dd>{review.product.colorFinish}</dd>
            </div>
          ) : null}
        </dl>

        <div className={styles.sceneBlock}>
          <p className={styles.eyebrow}>
            Scene direction · Version {review.candidate.sceneVersion}
          </p>
          <p>{review.candidate.sceneDirection}</p>
        </div>

        <figure id="original" className={styles.original}>
          <Image
            src={review.source.imageUrl}
            alt={review.source.imageAlt}
            width={900}
            height={900}
            unoptimized
          />
          <figcaption>Original product photo</figcaption>
        </figure>

        {!canDecide ? (
          <section className={styles.completed} aria-live="polite">
            <h2>{statusLabels[state]}</h2>
            {state === "changes_requested" && feedback ? (
              <p>“{feedback}”</p>
            ) : null}
            {state === "revoked" ? (
              <p>Maya closed this request. Its history remains available.</p>
            ) : null}
            {review.decidedAt ? (
              <p className={styles.subtle}>
                Recorded {formatDate(review.decidedAt)}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className={styles.history} aria-labelledby="history-title">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Earlier work</p>
            <h2 id="history-title">Candidate history</h2>
          </div>
          <ol>
            {history.map((item) => (
              <li key={item.attemptId}>
                <Image
                  src={item.imageUrl}
                  alt={`Styled candidate version ${item.attemptNumber} for ${review.product.name}`}
                  width={640}
                  height={640}
                  unoptimized
                />
                <div>
                  <div className={styles.historyTitle}>
                    <strong>Version {item.attemptNumber}</strong>
                    <span>{statusLabels[item.state]}</span>
                  </div>
                  <p>{item.sceneDirection}</p>
                  {item.feedback ? (
                    <blockquote>“{item.feedback}”</blockquote>
                  ) : null}
                  <p className={styles.subtle}>
                    {formatDate(item.decidedAt ?? item.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {historyError ? (
            <p className={styles.error} role="alert">
              {historyError}
            </p>
          ) : null}
          {historyCursor ? (
            <button
              className={styles.historyMore}
              type="button"
              disabled={historyPending}
              onClick={() => void loadMoreHistory()}
            >
              {historyPending ? "Loading…" : "Load more history"}
            </button>
          ) : null}
        </section>
      </section>

      {canDecide ? (
        <div className={styles.decisionBar} aria-label="Review decision">
          {error && !sheetOpen ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => {
                setError(null);
                setSheetOpen(true);
              }}
              disabled={pending}
            >
              Request changes
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={approve}
              disabled={pending}
            >
              {pending ? "Saving…" : "Approve"}
            </button>
          </div>
        </div>
      ) : null}

      {sheetOpen ? (
        <div className={styles.scrim} onMouseDown={() => setSheetOpen(false)}>
          <section
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="changes-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.sheetHandle} aria-hidden="true" />
            <h2 id="changes-title">What should Maya change?</h2>
            <div className={styles.reasons} aria-label="Common reasons">
              {[
                "Product looks inaccurate",
                "Color or material is wrong",
                "Scene needs adjustment",
                "Image quality issue"
              ].map((reason) => (
                <button
                  type="button"
                  key={reason}
                  onClick={() => setFeedback(reason)}
                >
                  {reason}
                </button>
              ))}
            </div>
            <label className={styles.feedbackField}>
              Feedback for Maya
              <textarea
                ref={feedbackRef}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                maxLength={1000}
                placeholder="For example: Keep the mug color exact and make the morning light less orange."
              />
            </label>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.sheetActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSheetOpen(false)}
                disabled={pending}
              >
                Back to review
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={requestChanges}
                disabled={pending}
              >
                {pending ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {zoomOpen ? (
        <div className={styles.zoom} role="dialog" aria-modal="true">
          <button type="button" onClick={() => setZoomOpen(false)}>
            Close
          </button>
          <Image
            src={review.candidate.imageUrl}
            alt={review.candidate.imageAlt}
            width={1600}
            height={1600}
            unoptimized
          />
        </div>
      ) : null}
    </main>
  );
}
