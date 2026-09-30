import {
  and,
  count,
  desc,
  eq,
  ilike,
  lt,
  or,
  sql,
  type SQL
} from "drizzle-orm";
import { getDb } from "@/db/client";
import { activityEvents, assets } from "@/db/schema";
import { users } from "@/db/schema/auth";
import { reviewRequests } from "@/modules/reviews/schema";
import { generationAttempts } from "@/modules/generation/schema";
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

type ProductCursor = {
  v: 1;
  timestamp: string;
  id: string;
};

const overviewPageSize = 4;

function overviewWindow(input: { offset?: number; limit?: number }) {
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const limit = Math.min(
    12,
    Math.max(1, Math.trunc(input.limit ?? overviewPageSize))
  );
  return { offset, limit };
}

function latestReviewStateSql() {
  return sql<"pending" | "approved" | "changes_requested" | "revoked" | null>`(
    select ${reviewRequests.state} from ${reviewRequests}
    where ${reviewRequests.productId} = ${products.id}
    order by coalesce(${reviewRequests.revokedAt}, ${reviewRequests.decidedAt}, ${reviewRequests.createdAt}) desc,
      ${reviewRequests.createdAt} desc,
      ${reviewRequests.id} desc
    limit 1
  )`;
}

function latestReviewSceneVersionSql() {
  return sql<number | null>`(
    select ${reviewRequests.sceneVersion} from ${reviewRequests}
    where ${reviewRequests.productId} = ${products.id}
    order by coalesce(${reviewRequests.revokedAt}, ${reviewRequests.decidedAt}, ${reviewRequests.createdAt}) desc,
      ${reviewRequests.createdAt} desc,
      ${reviewRequests.id} desc
    limit 1
  )`;
}

function latestReviewEventAtSql() {
  return sql<Date | null>`(
    select coalesce(${reviewRequests.revokedAt}, ${reviewRequests.decidedAt}, ${reviewRequests.createdAt})
    from ${reviewRequests}
    where ${reviewRequests.productId} = ${products.id}
    order by coalesce(${reviewRequests.revokedAt}, ${reviewRequests.decidedAt}, ${reviewRequests.createdAt}) desc,
      ${reviewRequests.createdAt} desc,
      ${reviewRequests.id} desc
    limit 1
  )`;
}

export function encodeProductCursor(input: { timestamp: string; id: string }) {
  return Buffer.from(JSON.stringify({ v: 1, ...input }), "utf8").toString(
    "base64url"
  );
}

export function decodeProductCursor(value: string): ProductCursor {
  try {
    if (value.length > 512) throw new Error("Cursor is too long.");
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<ProductCursor>;
    if (
      parsed.v !== 1 ||
      typeof parsed.timestamp !== "string" ||
      !Number.isFinite(Date.parse(parsed.timestamp)) ||
      typeof parsed.id !== "string" ||
      !/^product_[a-z0-9]{24}$/.test(parsed.id)
    ) {
      throw new Error("Cursor fields are invalid.");
    }
    return parsed as ProductCursor;
  } catch {
    throw new AppError("BAD_REQUEST", "Product cursor is invalid.", 400);
  }
}

export function durableSourceUrl(
  assetId: string | null,
  status: "pending" | "ready" | "failed" | null
) {
  return assetId && status === "ready"
    ? `/api/assets/${encodeURIComponent(assetId)}/content`
    : null;
}

function summaryFromRow(row: {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  updatedAt: Date;
  sourceAssetId: string | null;
  sourceStatus: "pending" | "ready" | "failed" | null;
  sceneText: string | null;
  sceneVersion?: number | null;
  attempts: number;
  activeAttempts: number;
  latestReviewState:
    "pending" | "approved" | "changes_requested" | "revoked" | null;
  latestReviewSceneVersion?: number | null;
}) {
  const status = deriveCatalogStatus({
    sourceStatus: row.sourceStatus,
    sceneText: row.sceneText
  });
  const reviewRequiresAction =
    row.latestReviewState &&
    ["changes_requested", "revoked"].includes(row.latestReviewState) &&
    (row.sceneVersion ?? 0) <= (row.latestReviewSceneVersion ?? 0);
  const workflow =
    reviewRequiresAction && row.latestReviewState === "revoked"
      ? { label: "Review revoked", nextAction: "Edit scene direction" }
      : reviewRequiresAction && row.latestReviewState === "changes_requested"
        ? { label: "Changes requested", nextAction: "Revise from feedback" }
        : row.activeAttempts > 0
          ? { label: "Generating", nextAction: "View progress" }
          : row.latestReviewState === "pending"
            ? { label: "Waiting on Ellie", nextAction: "Open review" }
            : row.latestReviewState === "approved"
              ? { label: "Approved", nextAction: "Download approved" }
              : row.attempts > 0
                ? { label: "Generated", nextAction: "Review images" }
                : {
                    label: statusLabels[status],
                    nextAction:
                      status === "ready_to_generate"
                        ? "Generate image"
                        : "Finish setup"
                  };
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    updatedAt: row.updatedAt.toISOString(),
    sourceStatus: row.sourceStatus,
    sourceUrl: durableSourceUrl(row.sourceAssetId, row.sourceStatus),
    sceneSummary: row.sceneText,
    status,
    statusLabel: workflow.label,
    attempts: row.attempts,
    nextAction: workflow.nextAction
  };
}

function catalogConditions(input: { workspaceId: string; search?: string }) {
  const conditions: SQL[] = [eq(products.workspaceId, input.workspaceId)];
  const search = input.search?.trim();
  if (search) {
    conditions.push(
      or(
        ilike(products.sku, `%${search}%`),
        ilike(products.name, `%${search}%`)
      )!
    );
  }
  return conditions;
}

const readyCondition = sql<boolean>`${assets.status} = 'ready' and nullif(btrim(${sceneBriefs.text}), '') is not null`;
const needsSetupCondition = sql<boolean>`not coalesce((${readyCondition}), false)`;

function statusCondition(status?: CatalogWorkflowStatus | "all") {
  if (status === "ready_to_generate") return readyCondition;
  if (status === "needs_setup") return needsSetupCondition;
  return undefined;
}

function countProducts(conditions: SQL[], status?: CatalogWorkflowStatus) {
  return getDb()
    .select({ value: count() })
    .from(products)
    .leftJoin(assets, eq(assets.id, products.currentSourceAssetId))
    .leftJoin(sceneBriefs, eq(sceneBriefs.id, products.currentSceneBriefId))
    .where(and(...conditions, statusCondition(status)));
}

export async function listProducts(input: {
  actor: ActorContext;
  search?: string;
  status?: CatalogWorkflowStatus | "all";
  cursor?: string;
}) {
  const db = getDb();
  const baseConditions = catalogConditions({
    workspaceId: input.actor.workspaceId,
    search: input.search
  });
  const cursor = input.cursor ? decodeProductCursor(input.cursor) : null;
  const cursorCondition = cursor
    ? or(
        sql`${products.updatedAt} < ${cursor.timestamp}::timestamptz`,
        and(
          sql`${products.updatedAt} = ${cursor.timestamp}::timestamptz`,
          lt(products.id, cursor.id)
        )
      )
    : undefined;

  const [rows, [allCount], [needsSetupCount], [readyCount]] = await Promise.all(
    [
      db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          category: products.category,
          updatedAt: products.updatedAt,
          cursorTimestamp: sql<string>`${products.updatedAt}::text`,
          sourceAssetId: assets.id,
          sourceStatus: assets.status,
          sceneText: sceneBriefs.text,
          sceneVersion: sceneBriefs.version,
          attempts: sql<number>`(
            select count(*)::int from ${generationAttempts}
            where ${generationAttempts.productId} = ${products.id}
          )`,
          activeAttempts: sql<number>`(
            select count(*)::int from ${generationAttempts}
            where ${generationAttempts.productId} = ${products.id}
              and ${generationAttempts.status} in ('pending', 'submitting', 'queued', 'processing', 'storing')
          )`,
          latestReviewState: latestReviewStateSql(),
          latestReviewSceneVersion: latestReviewSceneVersionSql()
        })
        .from(products)
        .leftJoin(assets, eq(assets.id, products.currentSourceAssetId))
        .leftJoin(sceneBriefs, eq(sceneBriefs.id, products.currentSceneBriefId))
        .where(
          and(...baseConditions, statusCondition(input.status), cursorCondition)
        )
        .orderBy(desc(products.updatedAt), desc(products.id))
        .limit(pageSize + 1),
      countProducts(baseConditions),
      countProducts(baseConditions, "needs_setup"),
      countProducts(baseConditions, "ready_to_generate")
    ]
  );

  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return {
    products: page.map(summaryFromRow),
    counts: {
      all: allCount.value,
      needs_setup: needsSetupCount.value,
      ready_to_generate: readyCount.value
    },
    nextCursor:
      hasMore && last
        ? encodeProductCursor({
            timestamp: last.cursorTimestamp,
            id: last.id
          })
        : null
  };
}

const latestReviewActionableCondition = sql<boolean>`(
  ${latestReviewStateSql()} in ('changes_requested', 'revoked')
  and coalesce(${sceneBriefs.version}, 0) <= coalesce(${latestReviewSceneVersionSql()}, 0)
)`;

const priorityCondition = sql<boolean>`(
  coalesce((${needsSetupCondition}), false)
  or ${latestReviewActionableCondition}
)`;

const priorityRank = sql<number>`case
  when ${assets.status} = 'failed' then 0
  when ${latestReviewStateSql()} = 'changes_requested'
    and coalesce(${sceneBriefs.version}, 0) <= coalesce(${latestReviewSceneVersionSql()}, 0) then 1
  when ${latestReviewStateSql()} = 'revoked'
    and coalesce(${sceneBriefs.version}, 0) <= coalesce(${latestReviewSceneVersionSql()}, 0) then 2
  when ${assets.status} is null or ${assets.status} = 'pending' then 3
  when nullif(btrim(${sceneBriefs.text}), '') is null then 4
  else 5
end`;

export async function listPriorityQueue(input: {
  actor: ActorContext;
  offset?: number;
  limit?: number;
}) {
  const db = getDb();
  const { offset, limit } = overviewWindow(input);
  const baseConditions = [
    eq(products.workspaceId, input.actor.workspaceId),
    priorityCondition
  ];
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category,
        updatedAt: products.updatedAt,
        sourceAssetId: assets.id,
        sourceStatus: assets.status,
        sceneText: sceneBriefs.text,
        sceneVersion: sceneBriefs.version,
        attempts: sql<number>`(
          select count(*)::int from ${generationAttempts}
          where ${generationAttempts.productId} = ${products.id}
        )`,
        activeAttempts: sql<number>`(
          select count(*)::int from ${generationAttempts}
          where ${generationAttempts.productId} = ${products.id}
            and ${generationAttempts.status} in ('pending', 'submitting', 'queued', 'processing', 'storing')
        )`,
        latestReviewState: latestReviewStateSql(),
        latestReviewSceneVersion: latestReviewSceneVersionSql(),
        latestReviewEventAt: latestReviewEventAtSql()
      })
      .from(products)
      .leftJoin(assets, eq(assets.id, products.currentSourceAssetId))
      .leftJoin(sceneBriefs, eq(sceneBriefs.id, products.currentSceneBriefId))
      .where(and(...baseConditions))
      .orderBy(
        priorityRank,
        desc(sql`coalesce(${latestReviewEventAtSql()}, ${products.updatedAt})`),
        desc(products.id)
      )
      .offset(offset)
      .limit(limit),
    db
      .select({ value: count() })
      .from(products)
      .leftJoin(assets, eq(assets.id, products.currentSourceAssetId))
      .leftJoin(sceneBriefs, eq(sceneBriefs.id, products.currentSceneBriefId))
      .where(and(...baseConditions))
  ]);

  return {
    items: rows.map(summaryFromRow),
    total: total.value,
    offset,
    limit
  };
}

function reviewActivityLabel(
  state: "pending" | "approved" | "changes_requested" | "revoked"
) {
  if (state === "pending") return "Pending review";
  if (state === "approved") return "Approved";
  if (state === "changes_requested") return "Changes requested";
  return "Review revoked";
}

function reviewActivityAction(
  state: "pending" | "approved" | "changes_requested" | "revoked"
) {
  if (state === "pending") return "Waiting on Ellie";
  if (state === "approved") return "Download approved";
  if (state === "changes_requested") return "Revise from feedback";
  return "Edit scene direction";
}

export async function listReviewActivity(input: {
  actor: ActorContext;
  offset?: number;
  limit?: number;
}) {
  const db = getDb();
  const { offset, limit } = overviewWindow(input);
  const eventAt = sql<Date>`coalesce(${reviewRequests.revokedAt}, ${reviewRequests.decidedAt}, ${reviewRequests.createdAt})`;
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: reviewRequests.id,
        productId: reviewRequests.productId,
        productName: reviewRequests.productName,
        sku: reviewRequests.sku,
        attemptNumber: reviewRequests.attemptNumber,
        state: reviewRequests.state,
        eventAt
      })
      .from(reviewRequests)
      .where(eq(reviewRequests.workspaceId, input.actor.workspaceId))
      .orderBy(desc(eventAt), desc(reviewRequests.id))
      .offset(offset)
      .limit(limit),
    db
      .select({ value: count() })
      .from(reviewRequests)
      .where(eq(reviewRequests.workspaceId, input.actor.workspaceId))
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: row.productName,
      sku: row.sku,
      attemptNumber: row.attemptNumber,
      state: row.state,
      statusLabel: reviewActivityLabel(row.state),
      nextAction: reviewActivityAction(row.state),
      eventAt: row.eventAt.toISOString()
    })),
    total: total.value,
    offset,
    limit
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
  const [history, approvedOutputs] = await Promise.all([
    db
      .select({
        id: activityEvents.id,
        type: activityEvents.eventType,
        data: activityEvents.eventDataJson,
        actorDisplayName: users.displayName,
        createdAt: activityEvents.createdAt
      })
      .from(activityEvents)
      .leftJoin(users, eq(users.id, activityEvents.actorId))
      .where(
        and(
          eq(activityEvents.workspaceId, input.actor.workspaceId),
          eq(activityEvents.productId, input.productId)
        )
      )
      .orderBy(desc(activityEvents.createdAt))
      .limit(20),
    db
      .select({
        assetId: reviewRequests.candidateAssetId,
        attemptNumber: reviewRequests.attemptNumber,
        decidedAt: reviewRequests.decidedAt
      })
      .from(reviewRequests)
      .where(
        and(
          eq(reviewRequests.workspaceId, input.actor.workspaceId),
          eq(reviewRequests.productId, input.productId),
          eq(reviewRequests.state, "approved")
        )
      )
      .orderBy(desc(reviewRequests.attemptNumber), desc(reviewRequests.id))
  ]);

  return {
    ...row,
    sourceUrl: durableSourceUrl(row.sourceAssetId, row.sourceStatus),
    updatedAt: row.updatedAt.toISOString(),
    status,
    statusLabel: statusLabels[status],
    readyToGenerate: status === "ready_to_generate",
    approvedCount: 0,
    attempts: 0,
    approvedOutputs: approvedOutputs.map((output) => ({
      ...output,
      imageUrl: `/api/assets/${encodeURIComponent(output.assetId)}/content`,
      downloadUrl: `/api/assets/${encodeURIComponent(output.assetId)}/download`,
      decidedAt: output.decidedAt?.toISOString() ?? null
    })),
    history: history.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString()
    }))
  };
}
