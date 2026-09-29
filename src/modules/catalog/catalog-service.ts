import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activityEvents, assets } from "@/db/schema";
import { AppError } from "@/shared/errors";
import { products, sceneBriefs } from "./schema";
import {
  deriveCatalogStatus,
  statusLabels,
  type CatalogWorkflowStatus
} from "./status";

const pageSize = 24;

type ActorContext = {
  id: string;
  workspaceId: string;
};

function summaryFromRow(row: {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  updatedAt: Date;
  sourceStatus: "pending" | "ready" | "failed" | null;
  sourceUrl: string | null;
  sceneText: string | null;
}) {
  const status = deriveCatalogStatus({
    sourceStatus: row.sourceStatus,
    sceneText: row.sceneText
  });
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    updatedAt: row.updatedAt.toISOString(),
    sourceStatus: row.sourceStatus,
    sourceUrl: row.sourceUrl,
    sceneSummary: row.sceneText,
    status,
    statusLabel: statusLabels[status],
    attempts: 0,
    nextAction:
      status === "ready_to_generate" ? "Review product" : "Finish setup"
  };
}

export async function listProducts(input: {
  actor: ActorContext;
  search?: string;
  status?: CatalogWorkflowStatus | "all";
  cursor?: string;
}) {
  const db = getDb();
  const search = input.search?.trim();
  const where = search
    ? and(
        eq(products.workspaceId, input.actor.workspaceId),
        or(
          ilike(products.sku, `%${search}%`),
          ilike(products.name, `%${search}%`)
        )
      )
    : eq(products.workspaceId, input.actor.workspaceId);
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      category: products.category,
      updatedAt: products.updatedAt,
      sourceStatus: assets.status,
      sourceUrl: assets.originalUrl,
      sceneText: sceneBriefs.text
    })
    .from(products)
    .leftJoin(assets, eq(assets.id, products.currentSourceAssetId))
    .leftJoin(sceneBriefs, eq(sceneBriefs.id, products.currentSceneBriefId))
    .where(where)
    .orderBy(desc(products.updatedAt), desc(products.id));

  const summaries = rows.map(summaryFromRow);
  const filtered =
    !input.status || input.status === "all"
      ? summaries
      : summaries.filter((product) => product.status === input.status);
  const start = input.cursor
    ? Math.max(
        0,
        filtered.findIndex((product) => product.id === input.cursor) + 1
      )
    : 0;
  const page = filtered.slice(start, start + pageSize);
  const counts = {
    all: summaries.length,
    needs_setup: summaries.filter((product) => product.status === "needs_setup")
      .length,
    ready_to_generate: summaries.filter(
      (product) => product.status === "ready_to_generate"
    ).length
  };

  return {
    products: page,
    counts,
    nextCursor:
      start + pageSize < filtered.length ? (page.at(-1)?.id ?? null) : null
  };
}

export async function getProduct(input: {
  actor: ActorContext;
  productId: string;
}) {
  const db = getDb();
  const [row] = await db
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
      targetApprovedImages: products.targetApprovedImages,
      updatedAt: products.updatedAt,
      sourceAssetId: assets.id,
      sourceStatus: assets.status,
      sourceUrl: assets.originalUrl,
      sourceWidth: assets.width,
      sourceHeight: assets.height,
      sourceFailure: assets.failureDetailsJson,
      sceneBriefId: sceneBriefs.id,
      sceneVersion: sceneBriefs.version,
      sceneText: sceneBriefs.text
    })
    .from(products)
    .leftJoin(assets, eq(assets.id, products.currentSourceAssetId))
    .leftJoin(sceneBriefs, eq(sceneBriefs.id, products.currentSceneBriefId))
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.workspaceId, input.actor.workspaceId)
      )
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Product not found.", 404);

  const status = deriveCatalogStatus({
    sourceStatus: row.sourceStatus,
    sceneText: row.sceneText
  });
  const history = await db
    .select({
      id: activityEvents.id,
      type: activityEvents.eventType,
      data: activityEvents.eventDataJson,
      createdAt: activityEvents.createdAt
    })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, input.actor.workspaceId),
        eq(activityEvents.productId, input.productId)
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(20);

  return {
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    status,
    statusLabel: statusLabels[status],
    readyToGenerate: status === "ready_to_generate",
    approvedCount: 0,
    attempts: 0,
    history: history.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString()
    }))
  };
}
