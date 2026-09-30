import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activityEvents, assets, jobs } from "@/db/schema";
import type { ObjectStore } from "@/infrastructure/storage/object-store";
import { getObjectStore } from "@/infrastructure/storage/local-object-store";
import {
  ingestionBatches,
  ingestionItems,
  products,
  sceneBriefs,
  type ImportOutcomeSummary,
  type IngestionRowError
} from "@/modules/catalog/schema";
import { AppError } from "@/shared/errors";
import { newId } from "@/shared/ids";
import {
  normalizeCatalogRow,
  parseCatalogCsv,
  type CatalogRawRow,
  type NormalizedCatalogRow
} from "./catalog-csv";

const maxUploadBytes = 10 * 1024 * 1024;
const previewPageSize = 25;

function newItemId() {
  return `item_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

type ActorContext = {
  id: string;
  workspaceId: string;
};

export type PreviewAction = "create" | "update" | "unchanged" | "blocked";

export type ExistingProductSnapshot = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  colorFinish: string | null;
  material: string | null;
  priceMinor: number | null;
  currency: string;
  notes: string | null;
  photoUrl: string | null;
  sceneText: string | null;
};

function validateIdempotencyKey(value: string | null) {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new AppError(
      "BAD_REQUEST",
      "A valid Idempotency-Key header is required.",
      400
    );
  }
  return value;
}

function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function comparableProduct(row: NormalizedCatalogRow) {
  return {
    name: row.name,
    category: row.category,
    colorFinish: row.colorFinish,
    material: row.material,
    priceMinor: row.priceMinor,
    currency: row.currency,
    notes: row.notes
  };
}

function emptySummary(): ImportOutcomeSummary {
  return {
    total: 0,
    valid: 0,
    invalid: 0,
    create: 0,
    update: 0,
    unchanged: 0,
    blocked: 0
  };
}

function summarizeActions(actions: PreviewAction[]): ImportOutcomeSummary {
  const summary = emptySummary();
  summary.total = actions.length;
  for (const action of actions) {
    if (action === "blocked") {
      summary.invalid += 1;
      summary.blocked += 1;
    } else {
      summary.valid += 1;
      summary[action] += 1;
    }
  }
  return summary;
}

function publicSummary(summary: ImportOutcomeSummary | null) {
  return summary ?? emptySummary();
}

export function isCatalogRowUnchanged(
  existing: ExistingProductSnapshot,
  row: NormalizedCatalogRow
) {
  const catalog = comparableProduct(row);
  return (
    existing.name === catalog.name &&
    existing.category === catalog.category &&
    existing.colorFinish === catalog.colorFinish &&
    existing.material === catalog.material &&
    existing.priceMinor === catalog.priceMinor &&
    existing.currency === catalog.currency &&
    existing.notes === catalog.notes &&
    existing.photoUrl === row.photoUrl &&
    (existing.sceneText !== null || row.shotIdea === null)
  );
}

export async function createIngestionBatch(input: {
  actor: ActorContext;
  idempotencyKey: string | null;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  objectStore?: ObjectStore;
}) {
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  if (!input.filename.toLowerCase().endsWith(".csv")) {
    throw new AppError("VALIDATION_FAILED", "Choose a CSV file.", 422, false, {
      file: "The filename must end in .csv."
    });
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > maxUploadBytes) {
    throw new AppError(
      "VALIDATION_FAILED",
      "The CSV must be between 1 byte and 10 MB.",
      422,
      false,
      { file: "Choose a CSV no larger than 10 MB." }
    );
  }

  const db = getDb();
  const digest = checksum(input.bytes);
  const [existing] = await db
    .select({
      id: ingestionBatches.id,
      status: ingestionBatches.status,
      checksum: assets.checksum
    })
    .from(ingestionBatches)
    .innerJoin(assets, eq(assets.id, ingestionBatches.sourceAssetId))
    .where(
      and(
        eq(ingestionBatches.workspaceId, input.actor.workspaceId),
        eq(ingestionBatches.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);

  if (existing) {
    if (existing.checksum !== digest) {
      throw new AppError(
        "CONFLICT",
        "This upload key was already used for a different file.",
        409
      );
    }
    return { id: existing.id, status: existing.status, repeated: true };
  }

  const [sameFile] = await db
    .select({
      id: ingestionBatches.id,
      status: ingestionBatches.status,
      filename: assets.filename,
      createdAt: ingestionBatches.createdAt,
      committedAt: ingestionBatches.committedAt
    })
    .from(ingestionBatches)
    .innerJoin(assets, eq(assets.id, ingestionBatches.sourceAssetId))
    .where(
      and(
        eq(ingestionBatches.workspaceId, input.actor.workspaceId),
        eq(assets.checksum, digest),
        inArray(ingestionBatches.status, [
          "uploaded",
          "validating",
          "ready",
          "committing",
          "committed"
        ])
      )
    )
    .orderBy(desc(ingestionBatches.createdAt))
    .limit(1);
  if (sameFile) {
    return {
      id: sameFile.id,
      status: sameFile.status,
      repeated: false,
      fileDuplicate: true,
      filename: sameFile.filename,
      createdAt: sameFile.createdAt.toISOString(),
      committedAt: sameFile.committedAt?.toISOString() ?? null
    };
  }

  const batchId = newId("batch");
  const assetId = newId("asset");
  const objectKey = `workspaces/${input.actor.workspaceId}/imports/${batchId}/catalog.csv`;
  const objectStore = input.objectStore ?? getObjectStore();
  await objectStore.put({
    key: objectKey,
    bytes: input.bytes,
    contentType: input.contentType || "text/csv"
  });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(assets).values({
        id: assetId,
        workspaceId: input.actor.workspaceId,
        kind: "catalog_upload",
        objectKey,
        filename: input.filename,
        mimeType: input.contentType || "text/csv",
        byteSize: input.bytes.byteLength,
        checksum: digest,
        status: "ready"
      });
      await tx.insert(ingestionBatches).values({
        id: batchId,
        workspaceId: input.actor.workspaceId,
        sourceAssetId: assetId,
        idempotencyKey,
        createdBy: input.actor.id
      });
      await tx.insert(jobs).values({
        id: newId("job"),
        type: "parse_ingestion_batch",
        deduplicationKey: `parse-batch:${batchId}`,
        payloadJson: { batchId }
      });
    });
  } catch (error) {
    const [raced] = await db
      .select({
        id: ingestionBatches.id,
        status: ingestionBatches.status,
        checksum: assets.checksum
      })
      .from(ingestionBatches)
      .innerJoin(assets, eq(assets.id, ingestionBatches.sourceAssetId))
      .where(
        and(
          eq(ingestionBatches.workspaceId, input.actor.workspaceId),
          eq(ingestionBatches.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    if (!raced) throw error;
    if (raced.checksum !== digest) {
      throw new AppError(
        "CONFLICT",
        "This upload key was already used for a different file.",
        409
      );
    }
    return { id: raced.id, status: raced.status, repeated: true };
  }

  return { id: batchId, status: "uploaded" as const, repeated: false };
}

export async function parseIngestionBatch(
  batchId: string,
  objectStore: ObjectStore = getObjectStore()
) {
  const db = getDb();
  const [batch] = await db
    .select({
      id: ingestionBatches.id,
      workspaceId: ingestionBatches.workspaceId,
      status: ingestionBatches.status,
      objectKey: assets.objectKey
    })
    .from(ingestionBatches)
    .innerJoin(assets, eq(assets.id, ingestionBatches.sourceAssetId))
    .where(eq(ingestionBatches.id, batchId))
    .limit(1);
  if (!batch) throw new Error(`Ingestion batch ${batchId} was not found.`);
  if (batch.status === "ready" || batch.status === "committed") return;

  await db
    .update(ingestionBatches)
    .set({ status: "validating", failureMessage: null })
    .where(eq(ingestionBatches.id, batchId));

  try {
    const stored = await objectStore.get(batch.objectKey);
    if (!stored)
      throw new Error("The uploaded CSV could not be read from storage.");
    const parsed = parseCatalogCsv(
      new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)
    );
    if (parsed.headerErrors.length) {
      await db
        .update(ingestionBatches)
        .set({
          status: "failed",
          failureMessage: parsed.headerErrors.join(" ")
        })
        .where(eq(ingestionBatches.id, batchId));
      return;
    }

    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: ingestionBatches.status })
        .from(ingestionBatches)
        .where(eq(ingestionBatches.id, batchId))
        .for("update")
        .limit(1);
      if (locked?.status === "committed") return;
      await tx
        .delete(ingestionItems)
        .where(eq(ingestionItems.batchId, batchId));

      for (let offset = 0; offset < parsed.rows.length; offset += 250) {
        const chunk = parsed.rows.slice(offset, offset + 250);
        if (chunk.length) {
          await tx.insert(ingestionItems).values(
            chunk.map((row) => ({
              id: newItemId(),
              batchId,
              sourceRowNumber: row.rowNumber,
              rawDataJson: row.raw,
              validationErrorsJson: row.errors
            }))
          );
        }
      }
      await tx
        .update(ingestionBatches)
        .set({ status: "ready", failureMessage: null })
        .where(eq(ingestionBatches.id, batchId));
    });
    const summary = await computeOutcomeSummary(batch.workspaceId, batchId);
    await db
      .update(ingestionBatches)
      .set({ outcomeSummaryJson: summary })
      .where(eq(ingestionBatches.id, batchId));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "CSV validation failed.";
    await db
      .update(ingestionBatches)
      .set({ status: "failed", failureMessage: message.slice(0, 500) })
      .where(eq(ingestionBatches.id, batchId));
    throw error;
  }
}

async function existingProductsForRows(workspaceId: string, skus: string[]) {
  if (!skus.length) return new Map<string, ExistingProductSnapshot>();
  const rows = await getDb()
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      category: products.category,
      colorFinish: products.colorFinish,
      material: products.material,
      priceMinor: products.priceMinor,
      currency: products.currency,
      notes: products.notes,
      photoUrl: assets.originalUrl,
      sceneText: sceneBriefs.text
    })
    .from(products)
    .leftJoin(assets, eq(assets.id, products.currentSourceAssetId))
    .leftJoin(sceneBriefs, eq(sceneBriefs.id, products.currentSceneBriefId))
    .where(
      and(eq(products.workspaceId, workspaceId), inArray(products.sku, skus))
    );
  return new Map(rows.map((row) => [row.sku, row]));
}

function itemOutcome(
  raw: CatalogRawRow,
  errors: IngestionRowError[],
  existingBySku: Map<string, ExistingProductSnapshot>
): { action: PreviewAction; normalized: NormalizedCatalogRow | null } {
  if (errors.length) return { action: "blocked", normalized: null };
  const normalized = normalizeCatalogRow(raw).normalized;
  if (!normalized) return { action: "blocked", normalized: null };
  const existing = existingBySku.get(normalized.sku);
  if (!existing) return { action: "create", normalized };
  return {
    action: isCatalogRowUnchanged(existing, normalized)
      ? "unchanged"
      : "update",
    normalized
  };
}

async function computeOutcomeSummary(workspaceId: string, batchId: string) {
  const allItems = await getDb()
    .select()
    .from(ingestionItems)
    .where(eq(ingestionItems.batchId, batchId))
    .orderBy(asc(ingestionItems.sourceRowNumber));
  const normalizedRows = allItems
    .filter((item) => !item.validationErrorsJson.length)
    .map(
      (item) =>
        normalizeCatalogRow(item.rawDataJson as CatalogRawRow).normalized
    )
    .filter((row): row is NormalizedCatalogRow => Boolean(row));
  const existingBySku = await existingProductsForRows(
    workspaceId,
    normalizedRows.map((row) => row.sku)
  );
  return summarizeActions(
    allItems.map(
      (item) =>
        itemOutcome(
          item.rawDataJson as CatalogRawRow,
          item.validationErrorsJson,
          existingBySku
        ).action
    )
  );
}

export async function getIngestionPreview(input: {
  actor: ActorContext;
  batchId: string;
  cursor?: number;
}) {
  const db = getDb();
  const [batch] = await db
    .select({
      id: ingestionBatches.id,
      status: ingestionBatches.status,
      failureMessage: ingestionBatches.failureMessage,
      outcomeSummary: ingestionBatches.outcomeSummaryJson,
      filename: assets.filename,
      createdAt: ingestionBatches.createdAt,
      committedAt: ingestionBatches.committedAt
    })
    .from(ingestionBatches)
    .innerJoin(assets, eq(assets.id, ingestionBatches.sourceAssetId))
    .where(
      and(
        eq(ingestionBatches.id, input.batchId),
        eq(ingestionBatches.workspaceId, input.actor.workspaceId)
      )
    )
    .limit(1);
  if (!batch) throw new AppError("NOT_FOUND", "Import not found.", 404);

  const allItems = await db
    .select()
    .from(ingestionItems)
    .where(eq(ingestionItems.batchId, input.batchId))
    .orderBy(asc(ingestionItems.sourceRowNumber));
  const normalizedRows = allItems
    .filter((item) => !item.validationErrorsJson.length)
    .map(
      (item) =>
        normalizeCatalogRow(item.rawDataJson as CatalogRawRow).normalized
    )
    .filter((row): row is NormalizedCatalogRow => Boolean(row));
  const existingBySku = await existingProductsForRows(
    input.actor.workspaceId,
    normalizedRows.map((row) => row.sku)
  );

  const outcomes = allItems.map((item) => ({
    item,
    ...itemOutcome(
      item.rawDataJson as CatalogRawRow,
      item.validationErrorsJson,
      existingBySku
    )
  }));
  const summary = summarizeActions(outcomes.map(({ action }) => action));
  const cursor = input.cursor ?? 0;
  const page = outcomes
    .filter(({ item }) => (item.sourceRowNumber ?? 0) > cursor)
    .slice(0, previewPageSize);
  const nextCursor =
    page.length === previewPageSize ? page.at(-1)?.item.sourceRowNumber : null;

  return {
    batch,
    counts: {
      total: summary.total,
      valid: summary.valid,
      invalid: summary.invalid,
      create: summary.create,
      update: summary.update,
      unchanged: summary.unchanged,
      blocked: summary.blocked
    },
    items: page.map(({ item, action, normalized }) => ({
      id: item.id,
      rowNumber: item.sourceRowNumber,
      raw: item.rawDataJson,
      errors: item.validationErrorsJson,
      action,
      normalized
    })),
    nextCursor
  };
}

export async function listIngestionHistory(input: {
  actor: ActorContext;
  offset?: number;
  limit?: number;
}) {
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const limit = Math.min(10, Math.max(1, Math.trunc(input.limit ?? 5)));
  const db = getDb();
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: ingestionBatches.id,
        status: ingestionBatches.status,
        failureMessage: ingestionBatches.failureMessage,
        outcomeSummary: ingestionBatches.outcomeSummaryJson,
        filename: assets.filename,
        createdAt: ingestionBatches.createdAt,
        committedAt: ingestionBatches.committedAt
      })
      .from(ingestionBatches)
      .innerJoin(assets, eq(assets.id, ingestionBatches.sourceAssetId))
      .where(eq(ingestionBatches.workspaceId, input.actor.workspaceId))
      .orderBy(desc(ingestionBatches.createdAt), desc(ingestionBatches.id))
      .offset(offset)
      .limit(limit),
    db
      .select({ value: count() })
      .from(ingestionBatches)
      .where(eq(ingestionBatches.workspaceId, input.actor.workspaceId))
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      failureMessage: row.failureMessage,
      filename: row.filename,
      createdAt: row.createdAt.toISOString(),
      committedAt: row.committedAt?.toISOString() ?? null,
      summary: row.outcomeSummary
    })),
    total: total.value,
    offset,
    limit
  };
}

export async function commitIngestionBatch(input: {
  actor: ActorContext;
  batchId: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(ingestionBatches)
      .where(
        and(
          eq(ingestionBatches.id, input.batchId),
          eq(ingestionBatches.workspaceId, input.actor.workspaceId)
        )
      )
      .for("update")
      .limit(1);
    if (!batch) throw new AppError("NOT_FOUND", "Import not found.", 404);

    const items = await tx
      .select()
      .from(ingestionItems)
      .where(eq(ingestionItems.batchId, batch.id))
      .orderBy(asc(ingestionItems.sourceRowNumber));
    if (batch.status === "committed") {
      const summary = publicSummary(batch.outcomeSummaryJson);
      return {
        batchId: batch.id,
        status: batch.status,
        committed: summary.valid,
        created: summary.create,
        updated: summary.update,
        unchanged: summary.unchanged,
        invalid: summary.invalid,
        summary,
        repeated: true
      };
    }
    if (batch.status !== "ready") {
      throw new AppError(
        "CONFLICT",
        "Wait for validation to finish before importing products.",
        409
      );
    }

    await tx
      .update(ingestionBatches)
      .set({ status: "committing" })
      .where(eq(ingestionBatches.id, batch.id));

    const summary = emptySummary();
    summary.total = items.length;
    for (const item of items) {
      if (item.validationErrorsJson.length) {
        summary.invalid += 1;
        summary.blocked += 1;
        continue;
      }
      const normalized = normalizeCatalogRow(
        item.rawDataJson as CatalogRawRow
      ).normalized;
      if (!normalized) {
        summary.invalid += 1;
        summary.blocked += 1;
        continue;
      }
      summary.valid += 1;

      const [existing] = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.workspaceId, input.actor.workspaceId),
            eq(products.sku, normalized.sku)
          )
        )
        .for("update")
        .limit(1);
      const productId = existing?.id ?? newId("product");

      const [currentAsset] = existing?.currentSourceAssetId
        ? await tx
            .select({ originalUrl: assets.originalUrl })
            .from(assets)
            .where(eq(assets.id, existing.currentSourceAssetId))
            .limit(1)
        : [];
      const [currentBrief] = existing?.currentSceneBriefId
        ? await tx
            .select({ text: sceneBriefs.text })
            .from(sceneBriefs)
            .where(eq(sceneBriefs.id, existing.currentSceneBriefId))
            .limit(1)
        : [];

      if (
        existing &&
        isCatalogRowUnchanged(
          {
            ...existing,
            photoUrl: currentAsset?.originalUrl ?? null,
            sceneText: currentBrief?.text ?? null
          },
          normalized
        )
      ) {
        await tx
          .update(ingestionItems)
          .set({ productId })
          .where(eq(ingestionItems.id, item.id));
        summary.unchanged += 1;
        continue;
      }

      let sourceAssetId = existing?.currentSourceAssetId ?? null;
      if (!sourceAssetId || currentAsset?.originalUrl !== normalized.photoUrl) {
        sourceAssetId = newId("asset");
        await tx.insert(assets).values({
          id: sourceAssetId,
          workspaceId: input.actor.workspaceId,
          productId,
          kind: "source_image",
          objectKey: `workspaces/${input.actor.workspaceId}/products/${productId}/sources/${sourceAssetId}.pending`,
          originalUrl: normalized.photoUrl,
          status: "pending"
        });
        await tx
          .insert(jobs)
          .values({
            id: newId("job"),
            type: "ingest_source_asset",
            deduplicationKey: `ingest-source:${sourceAssetId}`,
            payloadJson: { assetId: sourceAssetId }
          })
          .onConflictDoNothing({ target: jobs.deduplicationKey });
      }

      if (existing) {
        await tx
          .update(products)
          .set({
            ...comparableProduct(normalized),
            currentSourceAssetId: sourceAssetId,
            updatedAt: new Date()
          })
          .where(eq(products.id, productId));
      } else {
        await tx.insert(products).values({
          id: productId,
          workspaceId: input.actor.workspaceId,
          sku: normalized.sku,
          ...comparableProduct(normalized),
          currentSourceAssetId: sourceAssetId
        });
      }

      if (!existing?.currentSceneBriefId && normalized.shotIdea) {
        const [latest] = await tx
          .select({ version: max(sceneBriefs.version) })
          .from(sceneBriefs)
          .where(eq(sceneBriefs.productId, productId));
        const sceneBriefId = newId("scene");
        await tx.insert(sceneBriefs).values({
          id: sceneBriefId,
          productId,
          version: (latest?.version ?? 0) + 1,
          text: normalized.shotIdea,
          source: "imported",
          createdBy: input.actor.id
        });
        await tx
          .update(products)
          .set({ currentSceneBriefId: sceneBriefId, updatedAt: new Date() })
          .where(eq(products.id, productId));
      }

      await tx
        .update(ingestionItems)
        .set({ productId })
        .where(eq(ingestionItems.id, item.id));
      if (existing) {
        summary.update += 1;
      } else {
        summary.create += 1;
      }
      await tx.insert(activityEvents).values({
        id: newId("event"),
        workspaceId: input.actor.workspaceId,
        productId,
        actorType: "user",
        actorId: input.actor.id,
        eventType: existing
          ? "catalog_product_updated"
          : "catalog_product_imported",
        eventDataJson: { batchId: batch.id, rowNumber: item.sourceRowNumber }
      });
    }

    await tx
      .update(ingestionBatches)
      .set({
        status: "committed",
        committedAt: new Date(),
        outcomeSummaryJson: summary
      })
      .where(eq(ingestionBatches.id, batch.id));
    return {
      batchId: batch.id,
      status: "committed" as const,
      committed: summary.valid,
      created: summary.create,
      updated: summary.update,
      unchanged: summary.unchanged,
      invalid: summary.invalid,
      summary,
      repeated: false
    };
  });
}
