import type { QueryResultRow } from "pg";
import { getPool } from "@/db/client";
import { getObjectStore } from "@/infrastructure/storage/local-object-store";
import type { ObjectStore } from "@/infrastructure/storage/object-store";
import { AppError } from "@/shared/errors";

export const catalogExportColumns = [
  "SKU",
  "Product Name",
  "Category",
  "Color / Finish",
  "Material",
  "Price",
  "Notes",
  "Workflow Status",
  "Approved Count",
  "Target Approved Images",
  "Attempt Count",
  "Latest Attempt",
  "Latest Review State",
  "Latest Feedback",
  "Approved Download",
  "Updated At"
] as const;

const formulaPrefix = /^[\s]*[=+\-@]/;

export function safeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return formulaPrefix.test(text) ? `'${text}` : text;
}

export function csvLine(values: unknown[]) {
  return values
    .map((value) => `"${safeCsvCell(value).replaceAll('"', '""')}"`)
    .join(",");
}

export function approvedFilename(input: {
  sku: string;
  attemptNumber: number;
  mimeType: string | null;
}) {
  const safeSku =
    input.sku
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "approved-image";
  return `${safeSku}-approved-v${input.attemptNumber}${extensionFor(input.mimeType)}`;
}

function extensionFor(mimeType: string | null) {
  switch (mimeType?.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/png":
    default:
      return ".png";
  }
}

export type WorkflowStatus =
  | "needs_setup"
  | "ready_to_generate"
  | "generating"
  | "ready_for_maya"
  | "waiting_for_ellie"
  | "changes_requested"
  | "approved"
  | "failed";

export const workflowStatusLabels: Record<WorkflowStatus, string> = {
  needs_setup: "Needs setup",
  ready_to_generate: "Ready to generate",
  generating: "Generating",
  ready_for_maya: "Ready for Maya",
  waiting_for_ellie: "Waiting for Ellie",
  changes_requested: "Changes requested",
  approved: "Approved",
  failed: "Failed"
};

export function deriveWorkflowStatus(input: {
  sourceStatus: "pending" | "ready" | "failed" | null;
  sceneText: string | null;
  latestAttemptStatus: string | null;
  latestAttemptHasOutput: boolean;
  latestAttemptHasReview: boolean;
  latestReviewState:
    "pending" | "approved" | "changes_requested" | "revoked" | null;
  approvedCount: number;
  targetApprovedImages: number;
}): WorkflowStatus {
  if (input.approvedCount >= input.targetApprovedImages) return "approved";
  if (input.latestReviewState === "changes_requested")
    return "changes_requested";
  if (input.latestReviewState === "pending") return "waiting_for_ellie";
  if (input.latestAttemptStatus === "failed") return "failed";
  if (
    input.latestAttemptStatus &&
    ["pending", "submitting", "queued", "processing", "storing"].includes(
      input.latestAttemptStatus
    )
  ) {
    return "generating";
  }
  if (
    input.latestAttemptStatus === "reconciliation_required" ||
    (input.latestAttemptStatus === "succeeded" &&
      input.latestAttemptHasOutput &&
      !input.latestAttemptHasReview)
  ) {
    return "ready_for_maya";
  }
  return input.sourceStatus === "ready" && Boolean(input.sceneText?.trim())
    ? "ready_to_generate"
    : "needs_setup";
}

interface ExportRow extends QueryResultRow {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  colorFinish: string | null;
  material: string | null;
  priceMinor: number | null;
  currency: string;
  notes: string | null;
  targetApprovedImages: number;
  updatedAt: Date;
  sourceStatus: "pending" | "ready" | "failed" | null;
  sceneText: string | null;
  attemptCount: number;
  latestAttemptNumber: number | null;
  latestAttemptStatus: string | null;
  latestAttemptOutputAssetId: string | null;
  latestAttemptReviewId: string | null;
  latestReviewState:
    "pending" | "approved" | "changes_requested" | "revoked" | null;
  latestFeedback: string | null;
  approvedCount: number;
  approvedAssetId: string | null;
}

interface DownloadRow extends QueryResultRow {
  objectKey: string;
  mimeType: string | null;
  sku: string;
  attemptNumber: number;
}

export class DeliveryService {
  constructor(
    private readonly objectStore: ObjectStore = getObjectStore(),
    private readonly appOrigin = process.env.APP_ORIGIN ??
      "http://localhost:3000"
  ) {}

  async catalogCsv(workspaceId: string) {
    const rows = await this.exportRows(workspaceId);
    const lines = [csvLine([...catalogExportColumns])];
    for (const row of rows) {
      const status = statusForRow(row);
      const downloadUrl = row.approvedAssetId
        ? new URL(
            `/api/assets/${row.approvedAssetId}/download`,
            this.appOrigin
          ).toString()
        : "";
      lines.push(
        csvLine([
          row.sku,
          row.name,
          row.category,
          row.colorFinish,
          row.material,
          formatPrice(row.priceMinor, row.currency),
          row.notes,
          workflowStatusLabels[status],
          row.approvedCount,
          row.targetApprovedImages,
          row.attemptCount,
          row.latestAttemptNumber
            ? `Attempt ${row.latestAttemptNumber}: ${row.latestAttemptStatus}`
            : "",
          row.latestReviewState ?? "",
          row.latestFeedback,
          downloadUrl,
          row.updatedAt.toISOString()
        ])
      );
    }
    return `${lines.join("\n")}\n`;
  }

  async approvedDownload(input: { workspaceId: string; assetId: string }) {
    const result = await getPool().query<DownloadRow>(
      `select
         a.object_key as "objectKey",
         a.mime_type as "mimeType",
         rr.sku,
         rr.attempt_number as "attemptNumber"
       from review_requests rr
       join assets a on a.id = rr.candidate_asset_id
       where rr.workspace_id = $1
         and rr.candidate_asset_id = $2
         and rr.state = 'approved'
         and a.status = 'ready'
       order by rr.decided_at desc, rr.id desc
       limit 1`,
      [input.workspaceId, input.assetId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError("NOT_FOUND", "Approved image not found.", 404);
    }
    const stored = await this.objectStore.get(row.objectKey);
    if (!stored) {
      throw new AppError("NOT_FOUND", "Approved image not found.", 404);
    }
    return {
      bytes: stored.bytes,
      contentType:
        stored.contentType || row.mimeType || "application/octet-stream",
      filename: approvedFilename({
        sku: row.sku,
        attemptNumber: row.attemptNumber,
        mimeType: stored.contentType || row.mimeType
      })
    };
  }

  private async exportRows(workspaceId: string) {
    const result = await getPool().query<ExportRow>(
      `select
         p.id,
         p.sku,
         p.name,
         p.category,
         p.color_finish as "colorFinish",
         p.material,
         p.price_minor as "priceMinor",
         p.currency,
         p.notes,
         p.target_approved_images as "targetApprovedImages",
         p.updated_at as "updatedAt",
         source.status as "sourceStatus",
         scene.text as "sceneText",
         coalesce(attempt_counts.count, 0)::int as "attemptCount",
         latest_attempt.attempt_number as "latestAttemptNumber",
         latest_attempt.status as "latestAttemptStatus",
         latest_attempt.output_asset_id as "latestAttemptOutputAssetId",
         latest_attempt.review_id as "latestAttemptReviewId",
         latest_review.state as "latestReviewState",
         latest_review.feedback as "latestFeedback",
         coalesce(approved.count, 0)::int as "approvedCount",
         latest_approved.candidate_asset_id as "approvedAssetId"
       from products p
       left join assets source on source.id = p.current_source_asset_id
       left join scene_briefs scene on scene.id = p.current_scene_brief_id
       left join lateral (
         select count(*) as count
         from generation_attempts ga
         where ga.product_id = p.id
       ) attempt_counts on true
       left join lateral (
         select
           ga.attempt_number,
           ga.status,
           ga.output_asset_id,
           rr.id as review_id
         from generation_attempts ga
         left join review_requests rr on rr.generation_attempt_id = ga.id
         where ga.product_id = p.id
         order by ga.attempt_number desc, ga.id desc
         limit 1
       ) latest_attempt on true
       left join lateral (
         select state, feedback
         from review_requests rr
         where rr.product_id = p.id
         order by rr.created_at desc, rr.id desc
         limit 1
       ) latest_review on true
       left join lateral (
         select count(*) as count
         from review_requests rr
         where rr.product_id = p.id and rr.state = 'approved'
       ) approved on true
       left join lateral (
         select candidate_asset_id
         from review_requests rr
         where rr.product_id = p.id and rr.state = 'approved'
         order by rr.decided_at desc, rr.id desc
         limit 1
       ) latest_approved on true
       where p.workspace_id = $1
       order by p.sku asc, p.id asc`,
      [workspaceId]
    );
    return result.rows;
  }
}

export function statusForRow(row: ExportRow) {
  return deriveWorkflowStatus({
    sourceStatus: row.sourceStatus,
    sceneText: row.sceneText,
    latestAttemptStatus: row.latestAttemptStatus,
    latestAttemptHasOutput: Boolean(row.latestAttemptOutputAssetId),
    latestAttemptHasReview: Boolean(row.latestAttemptReviewId),
    latestReviewState: row.latestReviewState,
    approvedCount: row.approvedCount,
    targetApprovedImages: row.targetApprovedImages
  });
}

function formatPrice(priceMinor: number | null, currency: string) {
  return priceMinor === null
    ? ""
    : `${currency} ${(priceMinor / 100).toFixed(2)}`;
}

let service: DeliveryService | undefined;

export function getDeliveryService() {
  service ??= new DeliveryService();
  return service;
}
