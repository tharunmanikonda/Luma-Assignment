"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { MayaReviewStatus } from "@/modules/reviews/components/maya-review-status";
import styles from "./catalog-workspace.module.css";

type ProductSummary = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  updatedAt: string;
  sourceStatus: "pending" | "ready" | "failed" | null;
  sourceUrl: string | null;
  sceneSummary: string | null;
  status: "needs_setup" | "ready_to_generate";
  statusLabel: string;
  attempts: number;
  nextAction: string;
};

type ProductList = {
  products: ProductSummary[];
  counts: { all: number; needs_setup: number; ready_to_generate: number };
  nextCursor: string | null;
};

type ProductDetail = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  colorFinish: string | null;
  material: string | null;
  priceMinor: number | null;
  currency: string;
  notes: string | null;
  sourceStatus: "pending" | "ready" | "failed" | null;
  sourceAssetId: string | null;
  sourceUrl: string | null;
  sourceFailure: unknown;
  sceneBriefId: string | null;
  sceneText: string | null;
  sceneVersion: number | null;
  statusLabel: string;
  readyToGenerate: boolean;
  approvedOutputs: Array<{
    assetId: string;
    attemptNumber: number;
    imageUrl: string;
    downloadUrl: string;
    decidedAt: string | null;
  }>;
  history: Array<{ id: string; type: string; createdAt: string }>;
};

type GenerationQuote = {
  productId: string;
  sourceAssetId: string;
  sceneBriefId: string;
  estimatedAmount: string;
  currency: "USD";
  pricingVersion: string;
  quoteFingerprint: string;
};

type GenerationAttempt = {
  id: string;
  attemptNumber: number;
  sceneBriefId: string;
  sceneBriefVersion: number;
  promptText: string;
  outputAssetId: string | null;
  createdAt: string;
  status:
    | "pending"
    | "submitting"
    | "queued"
    | "processing"
    | "storing"
    | "succeeded"
    | "failed"
    | "reconciliation_required";
  customerState: {
    label: string;
    terminal: boolean;
    nextAction: string | null;
  };
  failure: { message: string } | null;
  review: ReviewStatus | null;
};

type ReviewStatus = {
  id: string;
  generationAttemptId: string;
  state: "pending" | "approved" | "changes_requested" | "revoked";
  feedback: string | null;
  createdAt: string;
  decidedAt: string | null;
  revokedAt: string | null;
  reviewUrl: string;
};

type PreviewItem = {
  id: string;
  rowNumber: number;
  raw: Record<string, string>;
  errors: Array<{ field: string; message: string }>;
  action: "create" | "update" | "unchanged" | "blocked";
};

type ImportPreview = {
  batch: {
    id: string;
    status:
      | "uploaded"
      | "validating"
      | "ready"
      | "committing"
      | "committed"
      | "failed";
    failureMessage: string | null;
    filename: string | null;
  };
  counts: {
    total: number;
    valid: number;
    invalid: number;
    create: number;
    update: number;
    unchanged: number;
  };
  items: PreviewItem[];
  nextCursor: number | null;
};

type ApiError = {
  error?: { message?: string; fieldErrors?: Record<string, string> };
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? "Something went wrong. Try again."
    );
  }
  return payload;
}

function money(minor: number | null, currency: string) {
  if (minor === null) return "Not provided";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    minor / 100
  );
}

function StatusBadge({ product }: { product: ProductSummary }) {
  return (
    <span className={`${styles.status} ${styles[product.status]}`}>
      <span>{product.statusLabel}</span>
    </span>
  );
}

function ProductImage({
  product
}: {
  product: Pick<ProductSummary, "name" | "sourceUrl">;
}) {
  if (!product.sourceUrl) {
    return <div className={styles.imageEmpty}>No source photo</div>;
  }
  return (
    // The API only returns the authenticated route for the durable asset copy.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.thumbnail}
      src={product.sourceUrl}
      alt={`${product.name} source product`}
    />
  );
}

function ImportPanel({
  onClose,
  onCommitted
}: {
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const uploadKey = useRef(crypto.randomUUID());
  const commitKey = useRef(crypto.randomUUID());

  const loadPreview = useCallback(async (batchId: string, cursor?: number) => {
    const suffix = cursor ? `?cursor=${cursor}` : "";
    const next = await readJson<ImportPreview>(
      await fetch(`/api/ingestion-batches/${batchId}${suffix}`, {
        cache: "no-store"
      })
    );
    setPreview(next);
    setItems((current) => (cursor ? [...current, ...next.items] : next.items));
    return next;
  }, []);

  useEffect(() => {
    if (!preview || !["uploaded", "validating"].includes(preview.batch.status))
      return;
    const timer = window.setInterval(
      () => void loadPreview(preview.batch.id),
      1500
    );
    return () => window.clearInterval(timer);
  }, [loadPreview, preview]);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const created = await readJson<{ id: string }>(
        await fetch("/api/ingestion-batches", {
          method: "POST",
          headers: { "Idempotency-Key": uploadKey.current },
          body
        })
      );
      await loadPreview(created.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await readJson<{ committed: number; invalid: number }>(
        await fetch(`/api/ingestion-batches/${preview.batch.id}/commit`, {
          method: "POST",
          headers: { "Idempotency-Key": commitKey.current }
        })
      );
      setMessage(
        `${result.committed} products imported. ${result.invalid} blocked rows stayed unchanged.`
      );
      await loadPreview(preview.batch.id);
      onCommitted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const processing =
    preview && ["uploaded", "validating"].includes(preview.batch.status);
  return (
    <Panel title="Import catalog" onClose={onClose}>
      {!preview ? (
        <section className={styles.panelSection}>
          <p className={styles.eyebrow}>Step 1 of 3</p>
          <h3>Select the catalog CSV</h3>
          <p className={styles.help}>
            Use the supplied columns. You will review every change before
            products are imported.
          </p>
          <label className={styles.fileField}>
            <span>CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                uploadKey.current = crypto.randomUUID();
              }}
            />
          </label>
          {file ? <p className={styles.fileName}>{file.name}</p> : null}
          <button
            className={styles.primaryButton}
            onClick={upload}
            disabled={!file || busy}
          >
            {busy ? "Uploading..." : "Review import"}
          </button>
        </section>
      ) : (
        <>
          <section className={styles.panelSection}>
            <p className={styles.eyebrow}>Step 2 of 3</p>
            <h3>{preview.batch.filename}</h3>
            {processing ? (
              <p className={styles.notice}>
                Checking rows in the background...
              </p>
            ) : null}
            {preview.batch.status === "failed" ? (
              <p className={styles.error}>
                {preview.batch.failureMessage ??
                  "The CSV could not be checked."}
              </p>
            ) : null}
            <div className={styles.importCounts} aria-label="Import outcomes">
              <span>
                <strong>{preview.counts.create}</strong> create
              </span>
              <span>
                <strong>{preview.counts.update}</strong> update
              </span>
              <span>
                <strong>{preview.counts.unchanged}</strong> unchanged
              </span>
              <span>
                <strong>{preview.counts.invalid}</strong> blocked
              </span>
            </div>
          </section>
          {items.length ? (
            <section
              className={styles.previewRows}
              aria-label="Import preview rows"
            >
              {items.map((item) => (
                <article className={styles.previewRow} key={item.id}>
                  <div>
                    <strong>
                      {item.raw["Product Name"] || "Unnamed product"}
                    </strong>
                    <span>
                      Row {item.rowNumber} · {item.raw.SKU || "No SKU"}
                    </span>
                  </div>
                  <span className={`${styles.outcome} ${styles[item.action]}`}>
                    {item.action}
                  </span>
                  {item.errors.length ? (
                    <ul>
                      {item.errors.map((error) => (
                        <li key={`${error.field}-${error.message}`}>
                          <strong>{error.field}:</strong> {error.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
              {preview.nextCursor ? (
                <button
                  className={styles.textButton}
                  onClick={() =>
                    void loadPreview(
                      preview.batch.id,
                      preview.nextCursor ?? undefined
                    )
                  }
                >
                  View more rows
                </button>
              ) : null}
            </section>
          ) : null}
          {preview.batch.status === "ready" ? (
            <section className={styles.confirmBand}>
              <p>
                <strong>
                  Importing does not generate images or use generation budget.
                </strong>
              </p>
              <p>
                {preview.counts.valid} valid rows will be imported. Blocked rows
                will remain unchanged.
              </p>
              <div className={styles.actions}>
                <button
                  className={styles.primaryButton}
                  onClick={commit}
                  disabled={busy || preview.counts.valid === 0}
                >
                  {busy ? "Importing..." : "Import products"}
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => {
                    setPreview(null);
                    setItems([]);
                    setFile(null);
                  }}
                  disabled={busy}
                >
                  Choose another file
                </button>
              </div>
            </section>
          ) : null}
        </>
      )}
      {message ? (
        <p
          className={message.includes("failed") ? styles.error : styles.success}
        >
          {message}
        </p>
      ) : null}
    </Panel>
  );
}

function ProductPanel({
  productId,
  onClose,
  onSaved
}: {
  productId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [scene, setScene] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [quote, setQuote] = useState<GenerationQuote | null>(null);
  const [attempts, setAttempts] = useState<GenerationAttempt[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string | null>(
    null
  );
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [revisionReviewId, setRevisionReviewId] = useState<string | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null
  );
  const [compareWithSource, setCompareWithSource] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const generationKey = useRef(crypto.randomUUID());
  const reviewKeys = useRef(new Map<string, string>());
  const revokeKeys = useRef(new Map<string, string>());
  const sceneInput = useRef<HTMLTextAreaElement>(null);

  const loadAttempts = useCallback(async () => {
    const result = await readJson<{ attempts?: GenerationAttempt[] }>(
      await fetch(`/api/products/${productId}/generation-attempts`, {
        cache: "no-store"
      })
    );
    setAttempts(result.attempts ?? []);
    return result.attempts ?? [];
  }, [productId]);

  const load = useCallback(
    async (clearMessage = true) => {
      if (clearMessage) setMessage(null);
      setWorkflowLoading(true);
      try {
        const [next] = await Promise.all([
          readJson<ProductDetail>(
            await fetch(`/api/products/${productId}`, { cache: "no-store" })
          ),
          loadAttempts()
        ]);
        setProduct(next);
        setScene(next.sceneText ?? "");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Product could not be loaded."
        );
      } finally {
        setWorkflowLoading(false);
      }
    },
    [loadAttempts, productId]
  );

  useEffect(() => void load(), [load]);

  useEffect(() => {
    setQuote(null);
    setAttempts([]);
    setGenerationMessage(null);
    setReviewMessage(null);
    setRevisionReviewId(null);
    setSelectedAttemptId(null);
    setCompareWithSource(false);
    setBrokenImages(new Set());
    generationKey.current = crypto.randomUUID();
  }, [productId]);

  const currentSceneAttempts = useMemo(
    () =>
      attempts.filter(
        (candidate) => candidate.sceneBriefId === product?.sceneBriefId
      ),
    [attempts, product?.sceneBriefId]
  );
  const currentCandidate = useMemo(
    () =>
      [...currentSceneAttempts]
        .reverse()
        .find(
          (candidate) =>
            candidate.status === "succeeded" && candidate.outputAssetId
        ) ?? null,
    [currentSceneAttempts]
  );
  const successfulCandidates = useMemo(
    () =>
      attempts.filter(
        (candidate) =>
          candidate.status === "succeeded" && candidate.outputAssetId
      ),
    [attempts]
  );
  const selectedCandidate = useMemo(
    () =>
      successfulCandidates.find(
        (candidate) => candidate.id === selectedAttemptId
      ) ??
      currentCandidate ??
      successfulCandidates[0] ??
      null,
    [currentCandidate, selectedAttemptId, successfulCandidates]
  );
  const selectedCandidateIndex = selectedCandidate
    ? successfulCandidates.findIndex(
        (candidate) => candidate.id === selectedCandidate.id
      )
    : -1;
  const activeAttempt = useMemo(
    () =>
      [...currentSceneAttempts]
        .reverse()
        .find((candidate) => !candidate.customerState.terminal) ?? null,
    [currentSceneAttempts]
  );
  const latestCurrentAttempt = currentSceneAttempts.at(-1) ?? null;
  const actionableReview = useMemo(
    () =>
      [...currentSceneAttempts]
        .reverse()
        .map((candidate) => candidate.review)
        .find((review) => review?.state === "changes_requested") ?? null,
    [currentSceneAttempts]
  );
  const sceneIsDirty = scene !== (product?.sceneText ?? "");

  useEffect(() => {
    const shouldPoll =
      attempts.some((candidate) => !candidate.customerState.terminal) ||
      attempts.some((candidate) => candidate.review?.state === "pending");
    if (!shouldPoll) return;
    const timer = window.setInterval(async () => {
      try {
        const previousActive = attempts.some(
          (candidate) => !candidate.customerState.terminal
        );
        const next = await loadAttempts();
        if (
          previousActive &&
          !next.some((candidate) => !candidate.customerState.terminal)
        ) {
          setGenerationMessage(null);
          onSaved();
        }
      } catch (error) {
        setGenerationMessage(
          error instanceof Error
            ? error.message
            : "Generation status could not be refreshed."
        );
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [attempts, loadAttempts, onSaved]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const basedOnReviewId = revisionReviewId ?? actionableReview?.id ?? null;
      await readJson(
        await fetch(`/api/products/${productId}/scene-briefs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scene, basedOnReviewId })
        })
      );
      setQuote(null);
      setGenerationMessage(null);
      setRevisionReviewId(null);
      generationKey.current = crypto.randomUUID();
      await load(false);
      setMessage(
        basedOnReviewId
          ? "Revision saved from Ellie's feedback. No image was created and no budget was used."
          : "Scene saved. No image was created and no budget was used."
      );
      onSaved();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Scene could not be saved."
      );
    } finally {
      setBusy(false);
    }
  }

  async function reviewQuote() {
    if (!product?.sourceAssetId || !product.sceneBriefId) return;
    setGenerationBusy(true);
    setGenerationMessage(null);
    try {
      const params = new URLSearchParams({
        sourceAssetId: product.sourceAssetId,
        sceneBriefId: product.sceneBriefId
      });
      const result = await readJson<
        | { ready: true; quote: GenerationQuote }
        | { ready: false; blockers: Array<{ message: string }> }
      >(
        await fetch(
          `/api/products/${productId}/generation-quote?${params.toString()}`,
          { cache: "no-store" }
        )
      );
      if (!result.ready) {
        setGenerationMessage(
          result.blockers[0]?.message ?? "This product is not ready."
        );
        return;
      }
      setQuote(result.quote);
    } catch (error) {
      setGenerationMessage(
        error instanceof Error ? error.message : "Quote could not be loaded."
      );
    } finally {
      setGenerationBusy(false);
    }
  }

  async function confirmGeneration() {
    if (!quote) return;
    setGenerationBusy(true);
    setGenerationMessage(null);
    try {
      const result = await readJson<{ attempt: GenerationAttempt }>(
        await fetch(`/api/products/${productId}/generation-attempts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": generationKey.current
          },
          body: JSON.stringify({
            sourceAssetId: quote.sourceAssetId,
            sceneBriefId: quote.sceneBriefId,
            pricingVersion: quote.pricingVersion,
            quoteFingerprint: quote.quoteFingerprint
          })
        })
      );
      setAttempts((current) => [
        ...current.filter((candidate) => candidate.id !== result.attempt.id),
        { ...result.attempt, review: result.attempt.review ?? null }
      ]);
      generationKey.current = crypto.randomUUID();
      setQuote(null);
      setGenerationMessage(
        "Generation confirmed. The worker is preparing your image."
      );
    } catch (error) {
      setGenerationMessage(
        error instanceof Error
          ? error.message
          : "Generation could not be confirmed."
      );
    } finally {
      setGenerationBusy(false);
    }
  }

  async function sendToEllie(candidate: GenerationAttempt) {
    setReviewBusy(true);
    setReviewMessage(null);
    let key = reviewKeys.current.get(candidate.id);
    if (!key) {
      key = crypto.randomUUID();
      reviewKeys.current.set(candidate.id, key);
    }
    try {
      const review = await readJson<ReviewStatus>(
        await fetch(
          `/api/generation-attempts/${candidate.id}/review-requests`,
          {
            method: "POST",
            headers: { "Idempotency-Key": key }
          }
        )
      );
      setAttempts((current) =>
        current.map((attempt) =>
          attempt.id === candidate.id ? { ...attempt, review } : attempt
        )
      );
      setReviewMessage("Candidate sent to Ellie for review.");
    } catch (error) {
      setReviewMessage(
        error instanceof Error ? error.message : "Review could not be created."
      );
    } finally {
      setReviewBusy(false);
    }
  }

  async function revokeReview(review: ReviewStatus) {
    setReviewBusy(true);
    setReviewMessage(null);
    let key = revokeKeys.current.get(review.id);
    if (!key) {
      key = crypto.randomUUID();
      revokeKeys.current.set(review.id, key);
    }
    try {
      const next = await readJson<ReviewStatus>(
        await fetch(`/api/review-requests/${review.id}/revoke`, {
          method: "POST",
          headers: { "Idempotency-Key": key }
        })
      );
      setAttempts((current) =>
        current.map((candidate) =>
          candidate.id === next.generationAttemptId
            ? { ...candidate, review: next }
            : candidate
        )
      );
      setReviewMessage("Review request revoked.");
    } catch (error) {
      setReviewMessage(
        error instanceof Error ? error.message : "Review could not be revoked."
      );
    } finally {
      setReviewBusy(false);
    }
  }

  async function copyReviewLink(reviewUrl: string) {
    try {
      await navigator.clipboard.writeText(reviewUrl);
      setReviewMessage("Review link copied.");
    } catch {
      setReviewMessage("The review link could not be copied. Open it instead.");
    }
  }

  function markImageBroken(assetId: string) {
    setBrokenImages((current) => new Set(current).add(assetId));
  }

  return (
    <Panel
      title={product ? `${product.name} · ${product.sku}` : "Product"}
      onClose={onClose}
    >
      {!product ? (
        <p className={message ? styles.error : styles.notice}>
          {message ?? "Loading product..."}
        </p>
      ) : (
        <>
          <section className={styles.productHero}>
            <div className={styles.sourceStage}>
              {product.sourceUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.sourceUrl}
                  alt={`${product.name} source product`}
                />
              ) : (
                <div className={styles.imageEmpty}>No source photo</div>
              )}
              <span
                className={`${styles.sourceState} ${styles[`source_${product.sourceStatus ?? "missing"}`]}`}
              >
                Source {product.sourceStatus ?? "missing"}
              </span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Category</dt>
                <dd>{product.category ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Color / finish</dt>
                <dd>{product.colorFinish ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Material</dt>
                <dd>{product.material ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Price</dt>
                <dd>{money(product.priceMinor, product.currency)}</dd>
              </div>
            </dl>
          </section>
          <section className={styles.sceneEditor}>
            {revisionReviewId ? (
              <div className={styles.revisionBanner} role="status">
                <strong>Revising from Ellie&apos;s feedback</strong>
                <span>
                  Update the direction below. The saved revision will retain the
                  link to the reviewed candidate.
                </span>
              </div>
            ) : null}
            <div>
              <p className={styles.eyebrow}>Scene direction</p>
              <h3>Describe the finished product photo</h3>
            </div>
            <textarea
              ref={sceneInput}
              value={scene}
              onChange={(event) => setScene(event.target.value)}
              rows={6}
              placeholder="For example: morning kitchen counter, steam, warm light"
            />
            {sceneIsDirty && product.sceneVersion ? (
              <p className={styles.dirtyNotice}>
                Unsaved changes. Existing images were generated from version{" "}
                {product.sceneVersion}.
              </p>
            ) : null}
            <div className={styles.sceneFooter}>
              <span>
                {product.sceneVersion
                  ? `Version ${product.sceneVersion}`
                  : "Not saved yet"}
              </span>
              <button
                className={styles.primaryButton}
                onClick={save}
                disabled={busy || scene.trim().length < 8}
              >
                {busy
                  ? "Saving..."
                  : revisionReviewId
                    ? "Save revision"
                    : "Save scene"}
              </button>
            </div>
            {message ? (
              <p
                className={
                  message.startsWith("Scene saved") ||
                  message.startsWith("Revision saved")
                    ? styles.success
                    : styles.error
                }
              >
                {message}
              </p>
            ) : null}
          </section>
          <section className={styles.generationPanel}>
            <div>
              <p className={styles.eyebrow}>Image generation</p>
              <h3>Generate candidates</h3>
            </div>
            {workflowLoading ? (
              <p className={styles.notice}>Loading generation history...</p>
            ) : !product.readyToGenerate ? (
              <p className={styles.notice}>
                A ready source photo and saved scene are required.
              </p>
            ) : activeAttempt ? (
              <div className={styles.generationStatus}>
                <strong>{activeAttempt.customerState.label}</strong>
                <p>
                  {activeAttempt.customerState.nextAction ??
                    "You can close this panel. Progress will resume here when you return."}
                </p>
              </div>
            ) : quote ? (
              <div className={styles.quoteConfirmation}>
                <div>
                  <span>Estimated cost</span>
                  <strong>
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: quote.currency,
                      minimumFractionDigits: 4
                    }).format(Number(quote.estimatedAmount))}
                  </strong>
                </div>
                <p>
                  Confirming creates one paid Luma generation. Repeated clicks
                  use the same request key.
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.primaryButton}
                    onClick={confirmGeneration}
                    disabled={generationBusy}
                  >
                    {generationBusy
                      ? "Confirming..."
                      : `Confirm ${quote.estimatedAmount} ${quote.currency} generation`}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setQuote(null)}
                    disabled={generationBusy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : currentCandidate ? (
              <div className={styles.generationStatus}>
                <strong>
                  {successfulCandidates.length} candidate
                  {successfulCandidates.length === 1 ? "" : "s"} available
                </strong>
                <p>
                  Review the selected image below or deliberately create another
                  candidate from scene version {product.sceneVersion}.
                </p>
                <button
                  className={styles.secondaryButton}
                  onClick={reviewQuote}
                  disabled={generationBusy || sceneIsDirty}
                >
                  {generationBusy
                    ? "Loading quote..."
                    : "Generate another candidate"}
                </button>
                {sceneIsDirty ? (
                  <p>Save the scene changes before requesting a new quote.</p>
                ) : null}
              </div>
            ) : latestCurrentAttempt?.status === "failed" ? (
              <div className={styles.generationStatus}>
                <strong>{latestCurrentAttempt.customerState.label}</strong>
                <p>
                  {latestCurrentAttempt.customerState.nextAction ??
                    "Review the scene and try again deliberately."}
                </p>
                <button
                  className={styles.primaryButton}
                  onClick={reviewQuote}
                  disabled={generationBusy}
                >
                  {generationBusy ? "Loading quote..." : "Review a new quote"}
                </button>
              </div>
            ) : (
              <button
                className={styles.primaryButton}
                onClick={reviewQuote}
                disabled={generationBusy}
              >
                {generationBusy
                  ? "Loading quote..."
                  : "Review generation quote"}
              </button>
            )}
            {generationMessage ? (
              <p
                className={
                  generationMessage.includes("could not")
                    ? styles.error
                    : styles.success
                }
              >
                {generationMessage}
              </p>
            ) : null}
          </section>
          {selectedCandidate?.outputAssetId ? (
            <section className={styles.candidateSection}>
              <div className={styles.candidateHeading}>
                <div>
                  <p className={styles.eyebrow}>Generated images</p>
                  <h3>Candidate {selectedCandidate.attemptNumber}</h3>
                  <p className={styles.help}>
                    Scene version {selectedCandidate.sceneBriefVersion}
                    {selectedCandidate.sceneBriefId !== product.sceneBriefId
                      ? " · Previous scene"
                      : " · Current scene"}
                  </p>
                </div>
                <div className={styles.candidateNavigation}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    aria-label="Show previous candidate"
                    disabled={selectedCandidateIndex <= 0}
                    onClick={() =>
                      setSelectedAttemptId(
                        successfulCandidates[selectedCandidateIndex - 1]?.id ??
                          null
                      )
                    }
                  >
                    Previous
                  </button>
                  <span aria-live="polite">
                    {selectedCandidateIndex + 1} of{" "}
                    {successfulCandidates.length}
                  </span>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    aria-label="Show next candidate"
                    disabled={
                      selectedCandidateIndex < 0 ||
                      selectedCandidateIndex >= successfulCandidates.length - 1
                    }
                    onClick={() =>
                      setSelectedAttemptId(
                        successfulCandidates[selectedCandidateIndex + 1]?.id ??
                          null
                      )
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
              <div className={styles.compareControl}>
                <button
                  type="button"
                  className={!compareWithSource ? styles.activeCompare : ""}
                  onClick={() => setCompareWithSource(false)}
                >
                  Candidate only
                </button>
                <button
                  type="button"
                  className={compareWithSource ? styles.activeCompare : ""}
                  onClick={() => setCompareWithSource(true)}
                >
                  Compare with source
                </button>
              </div>
              <div className={compareWithSource ? styles.compareStage : ""}>
                {compareWithSource && product.sourceUrl ? (
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={product.sourceUrl}
                      alt={`${product.name} source product`}
                    />
                    <figcaption>Source</figcaption>
                  </figure>
                ) : null}
                <figure>
                  {brokenImages.has(selectedCandidate.outputAssetId) ? (
                    <p className={styles.error}>
                      The generated image could not be loaded. Refresh the panel
                      or check the stored asset.
                    </p>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={styles.candidateImage}
                      src={`/api/assets/${encodeURIComponent(selectedCandidate.outputAssetId)}/content`}
                      alt={`${product.name} generated candidate ${selectedCandidate.attemptNumber}`}
                      onError={() =>
                        markImageBroken(selectedCandidate.outputAssetId!)
                      }
                    />
                  )}
                  <figcaption>
                    Candidate {selectedCandidate.attemptNumber}
                  </figcaption>
                </figure>
              </div>
              {selectedCandidate.review ? (
                <>
                  <MayaReviewStatus
                    state={selectedCandidate.review.state}
                    feedback={selectedCandidate.review.feedback}
                    reviewUrl={selectedCandidate.review.reviewUrl}
                    createdAt={selectedCandidate.review.createdAt}
                  />
                  <div className={styles.actions}>
                    <button
                      className={styles.secondaryButton}
                      onClick={() =>
                        void copyReviewLink(selectedCandidate.review!.reviewUrl)
                      }
                      disabled={reviewBusy}
                    >
                      Copy review link
                    </button>
                    {selectedCandidate.review.state === "pending" ? (
                      <button
                        className={styles.secondaryButton}
                        onClick={() =>
                          void revokeReview(selectedCandidate.review!)
                        }
                        disabled={reviewBusy}
                      >
                        {reviewBusy ? "Updating..." : "Revoke review"}
                      </button>
                    ) : null}
                    {selectedCandidate.review.state === "changes_requested" ? (
                      <button
                        className={styles.primaryButton}
                        onClick={() => {
                          setRevisionReviewId(selectedCandidate.review!.id);
                          sceneInput.current?.focus();
                          sceneInput.current?.scrollIntoView?.({
                            behavior: "smooth",
                            block: "center"
                          });
                        }}
                      >
                        Revise scene from feedback
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <button
                  className={styles.primaryButton}
                  onClick={() => void sendToEllie(selectedCandidate)}
                  disabled={reviewBusy}
                >
                  {reviewBusy ? "Sending..." : "Send to Ellie for review"}
                </button>
              )}
              {reviewMessage ? (
                <p
                  className={
                    reviewMessage.includes("could not")
                      ? styles.error
                      : styles.success
                  }
                >
                  {reviewMessage}
                </p>
              ) : null}
            </section>
          ) : null}
          {successfulCandidates.length > 1 ? (
            <section className={styles.candidateHistory}>
              <div>
                <p className={styles.eyebrow}>Candidate history</p>
                <h3>Choose a candidate</h3>
              </div>
              <div className={styles.historyGrid}>
                {successfulCandidates.map((candidate) => (
                  <button
                    type="button"
                    className={`${styles.candidateCard} ${candidate.id === selectedCandidate?.id ? styles.selectedCandidate : ""}`}
                    key={candidate.id}
                    onClick={() => setSelectedAttemptId(candidate.id)}
                    aria-pressed={candidate.id === selectedCandidate?.id}
                  >
                    {candidate.outputAssetId &&
                    !brokenImages.has(candidate.outputAssetId) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/assets/${encodeURIComponent(candidate.outputAssetId)}/content`}
                        alt={`${product.name} previous generated candidate ${candidate.attemptNumber}`}
                        onError={() =>
                          markImageBroken(candidate.outputAssetId!)
                        }
                      />
                    ) : (
                      <div className={styles.historyImageError}>
                        Image unavailable
                      </div>
                    )}
                    <div>
                      <strong>Candidate {candidate.attemptNumber}</strong>
                      <span>
                        Scene version {candidate.sceneBriefVersion}
                        {candidate.sceneBriefId !== product.sceneBriefId
                          ? " · Previous scene"
                          : " · Earlier candidate"}
                      </span>
                      <span>
                        {candidate.review
                          ? candidate.review.state.replace("_", " ")
                          : "Not sent for review"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {product.notes ? (
            <section className={styles.notes}>
              <h3>Imported notes</h3>
              <p>{product.notes}</p>
            </section>
          ) : null}
          {product.approvedOutputs.length ? (
            <section className={styles.approvedImages}>
              <div>
                <p className={styles.eyebrow}>Approved delivery</p>
                <h3>Approved images</h3>
              </div>
              <div className={styles.approvedGrid}>
                {product.approvedOutputs.map((output) => (
                  <article key={output.assetId}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={output.imageUrl}
                      alt={`${product.name} approved image, candidate ${output.attemptNumber}`}
                    />
                    <div>
                      <strong>Candidate {output.attemptNumber}</strong>
                      <a
                        className={styles.secondaryButton}
                        href={output.downloadUrl}
                        download
                      >
                        Download approved image
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <section className={styles.timeline}>
            <h3>History</h3>
            {product.history.length ? (
              product.history.map((event) => (
                <div key={event.id}>
                  <span className={styles.timelineMark} />
                  <p>
                    <strong>
                      {event.type === "scene_brief_saved"
                        ? "Scene direction saved"
                        : event.type === "catalog_product_updated"
                          ? "Catalog updated"
                          : "Catalog imported"}
                    </strong>
                    <br />
                    <span>{new Date(event.createdAt).toLocaleString()}</span>
                  </p>
                </div>
              ))
            ) : (
              <p className={styles.help}>No activity yet.</p>
            )}
          </section>
        </>
      )}
    </Panel>
  );
}

function Panel({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button, a, input, textarea")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className={styles.scrim}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className={styles.panelHeader}>
          <h2>{title}</h2>
          <button className={styles.secondaryButton} onClick={onClose}>
            Close
          </button>
        </header>
        <div className={styles.panelBody}>{children}</div>
      </aside>
    </div>
  );
}

export function CatalogWorkspace({
  actorName,
  initialData,
  accountControl
}: {
  actorName: string;
  initialData: ProductList;
  accountControl: React.ReactNode;
}) {
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<
    "all" | "needs_setup" | "ready_to_generate"
  >("all");
  const [panel, setPanel] = useState<
    { type: "import" } | { type: "product"; id: string } | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (nextSearch = search, nextStatus = status) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ status: nextStatus });
        if (nextSearch.trim()) params.set("search", nextSearch.trim());
        setData(
          await readJson<ProductList>(
            await fetch(`/api/products?${params}`, { cache: "no-store" })
          )
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Products could not be loaded."
        );
      } finally {
        setLoading(false);
      }
    },
    [search, status]
  );

  async function loadMore() {
    if (!data.nextCursor) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        cursor: data.nextCursor
      });
      if (search.trim()) params.set("search", search.trim());
      const next = await readJson<ProductList>(
        await fetch(`/api/products?${params}`, { cache: "no-store" })
      );
      setData((current) => ({
        ...next,
        products: [...current.products, ...next.products]
      }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "More products could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(search, status), 250);
    return () => window.clearTimeout(timer);
  }, [search, status, refresh]);

  const attention = useMemo(
    () =>
      data.products
        .filter((product) => product.status === "needs_setup")
        .slice(0, 4),
    [data.products]
  );
  const progress = data.counts.all
    ? Math.round((data.counts.ready_to_generate / data.counts.all) * 100)
    : 0;

  return (
    <main className={styles.workspace}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.wordmark}>Maya Home Goods</span>
          <span className={styles.signedIn}>Signed in as {actorName}</span>
        </div>
        <nav aria-label="Workspace">
          <a aria-current="page" href="#products">
            Products
          </a>
          <span>Reviews</span>
          <span>Usage</span>
        </nav>
        <div className={styles.headerActions}>
          <a
            className={styles.secondaryButton}
            href="/api/exports/catalog.csv"
            download
          >
            Export catalog status
          </a>
          <button
            className={styles.secondaryButton}
            onClick={() => setPanel({ type: "import" })}
          >
            Import CSV
          </button>
          {accountControl}
        </div>
      </header>

      <section className={styles.launchBand} aria-labelledby="launch-heading">
        <div>
          <p className={styles.eyebrow}>Launch workspace</p>
          <h1 id="launch-heading">Q4 Product Images</h1>
          <p>
            {data.counts.ready_to_generate} ready to generate ·{" "}
            {data.counts.needs_setup} need setup · no generation spend yet
          </p>
        </div>
        <div className={styles.progressSummary}>
          <strong>
            {data.counts.ready_to_generate} of {data.counts.all}
          </strong>
          <span>prepared</span>
        </div>
        <div
          className={styles.progressTrack}
          aria-label={`${progress}% of products prepared`}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className={styles.attentionBand}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Priority queue</p>
            <h2>Needs your attention</h2>
          </div>
          <span>{attention.length} shown</span>
        </div>
        {attention.length ? (
          <div className={styles.attentionList}>
            {attention.map((product) => (
              <button
                className={styles.attentionRow}
                key={product.id}
                onClick={() => setPanel({ type: "product", id: product.id })}
              >
                <ProductImage product={product} />
                <span className={styles.productIdentity}>
                  <strong>{product.name}</strong>
                  <small>
                    {product.sku} ·{" "}
                    {product.sourceStatus === "failed"
                      ? "Source photo needs attention"
                      : product.sceneSummary
                        ? "Source photo is still preparing"
                        : "Add scene direction"}
                  </small>
                </span>
                <span className={styles.rowAction}>Finish setup</span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.emptyBand}>
            <p>No products need setup in this view.</p>
          </div>
        )}
      </section>

      <section className={styles.productsBand} id="products">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Catalog</p>
            <h2>All products</h2>
          </div>
          <span>{data.counts.all} products</span>
        </div>
        <div className={styles.filters}>
          <label>
            <span className={styles.srOnly}>Search products</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or SKU"
            />
          </label>
          <div
            className={styles.tabs}
            role="group"
            aria-label="Filter by status"
          >
            {(["all", "needs_setup", "ready_to_generate"] as const).map(
              (value) => (
                <button
                  key={value}
                  className={status === value ? styles.activeTab : ""}
                  onClick={() => setStatus(value)}
                >
                  {value === "all"
                    ? "All"
                    : value === "needs_setup"
                      ? "Needs setup"
                      : "Ready"}
                  <span>{data.counts[value]}</span>
                </button>
              )
            )}
          </div>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
        {loading ? <p className={styles.notice}>Updating products...</p> : null}
        {!data.products.length && !loading ? (
          <div className={styles.emptyBand}>
            <h3>
              {data.counts.all
                ? "No products match this view"
                : "Import your first catalog"}
            </h3>
            <p>
              {data.counts.all
                ? "Try another search or status."
                : "Start with the supplied CSV and review every row before import."}
            </p>
            <button
              className={styles.primaryButton}
              onClick={() => setPanel({ type: "import" })}
            >
              Import CSV
            </button>
          </div>
        ) : (
          <>
            <div
              className={styles.productTable}
              role="table"
              aria-label="Products"
            >
              <div className={styles.tableHeader} role="row">
                <span>Product</span>
                <span>Scene</span>
                <span>Status</span>
                <span>Next action</span>
              </div>
              {data.products.map((product) => (
                <button
                  className={styles.productRow}
                  role="row"
                  key={product.id}
                  onClick={() => setPanel({ type: "product", id: product.id })}
                >
                  <span className={styles.productCell}>
                    <ProductImage product={product} />
                    <span className={styles.productIdentity}>
                      <strong>{product.name}</strong>
                      <small>
                        {product.sku}
                        {product.category ? ` · ${product.category}` : ""}
                      </small>
                    </span>
                  </span>
                  <span className={styles.sceneCell}>
                    {product.sceneSummary ?? "No scene direction"}
                  </span>
                  <StatusBadge product={product} />
                  <span className={styles.rowAction}>{product.nextAction}</span>
                </button>
              ))}
            </div>
            {data.nextCursor ? (
              <div className={styles.pagination}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => void loadMore()}
                  disabled={loading}
                >
                  {loading ? "Loading..." : "View more products"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
      {panel?.type === "import" ? (
        <ImportPanel
          onClose={() => setPanel(null)}
          onCommitted={() => void refresh()}
        />
      ) : null}
      {panel?.type === "product" ? (
        <ProductPanel
          productId={panel.id}
          onClose={() => setPanel(null)}
          onSaved={() => void refresh()}
        />
      ) : null}
    </main>
  );
}
