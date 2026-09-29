import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { assets, jobs } from "@/db/schema";
import { AppError } from "@/shared/errors";
import { newId } from "@/shared/ids";
import type { GenerationAttemptRecord, ProductGenerationInput } from "./domain";
import type { AuthorizeAttemptInput, GenerationRepository } from "./repository";
import { generationAttempts } from "./schema";

type ProductRow = {
  productId: string;
  workspaceId: string;
  name: string;
  category: string | null;
  material: string | null;
  colorFinish: string | null;
  sourceAssetId: string | null;
  sourceProductId: string | null;
  sourceWorkspaceId: string | null;
  sourceObjectKey: string | null;
  sourceStatus: "pending" | "ready" | "failed" | null;
  sourceMimeType: string | null;
  sceneBriefId: string | null;
  sceneProductId: string | null;
  sceneVersion: number | null;
  sceneText: string | null;
  hasReconciliation: boolean;
};

export class PostgresGenerationRepository implements GenerationRepository {
  async getProductInput(
    workspaceId: string,
    productId: string,
    sourceAssetId: string,
    sceneBriefId: string
  ) {
    const result = await getDb().execute(sql`
      select
        p.id as "productId", p.workspace_id as "workspaceId", p.name,
        p.category, p.material, p.color_finish as "colorFinish",
        a.id as "sourceAssetId", a.product_id as "sourceProductId",
        a.workspace_id as "sourceWorkspaceId", a.object_key as "sourceObjectKey",
        a.status as "sourceStatus", a.mime_type as "sourceMimeType",
        s.id as "sceneBriefId", s.product_id as "sceneProductId",
        s.version as "sceneVersion", s.text as "sceneText",
        exists (
          select 1 from generation_attempts ga
          where ga.product_id = p.id and ga.status = 'reconciliation_required'
        ) as "hasReconciliation"
      from products p
      left join assets a on a.id = ${sourceAssetId}
      left join scene_briefs s on s.id = ${sceneBriefId}
      where p.id = ${productId} and p.workspace_id = ${workspaceId}
      limit 1
    `);
    const row = result.rows[0] as ProductRow | undefined;
    if (!row) return null;
    return {
      productId: row.productId,
      workspaceId: row.workspaceId,
      name: row.name,
      category: row.category,
      material: row.material,
      colorFinish: row.colorFinish,
      sourceAsset: row.sourceAssetId
        ? {
            id: row.sourceAssetId,
            productId: row.sourceProductId,
            workspaceId: row.sourceWorkspaceId!,
            objectKey: row.sourceObjectKey!,
            status: row.sourceStatus!,
            mimeType: row.sourceMimeType
          }
        : null,
      sceneBrief: row.sceneBriefId
        ? {
            id: row.sceneBriefId,
            productId: row.sceneProductId!,
            version: row.sceneVersion!,
            text: row.sceneText!
          }
        : null,
      hasReconciliationRequiredAttempt: row.hasReconciliation
    } satisfies ProductGenerationInput;
  }

  async authorizeAttempt(input: AuthorizeAttemptInput) {
    return getDb().transaction(async (tx) => {
      await tx.execute(
        sql`select id from workspaces where id = ${input.workspaceId} for update`
      );
      const [existing] = await tx
        .select()
        .from(generationAttempts)
        .where(
          and(
            eq(generationAttempts.workspaceId, input.workspaceId),
            eq(generationAttempts.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (existing) {
        if (existing.requestFingerprint !== input.requestFingerprint)
          throw new AppError(
            "CONFLICT",
            "That confirmation key was already used for different generation inputs.",
            409
          );
        return { attempt: asRecord(existing), created: false };
      }

      const [usage] = await tx
        .select({
          total: sql<number>`coalesce(sum(${generationAttempts.estimatedPriceMicros}), 0)::int`
        })
        .from(generationAttempts)
        .where(eq(generationAttempts.workspaceId, input.workspaceId));
      if (
        (usage?.total ?? 0) + input.estimatedPriceMicros >
        input.budgetMicros
      ) {
        throw new AppError(
          "CONFLICT",
          "The demo generation budget is fully allocated.",
          409
        );
      }
      const [numberRow] = await tx
        .select({
          next: sql<number>`coalesce(max(${generationAttempts.attemptNumber}), 0)::int + 1`
        })
        .from(generationAttempts)
        .where(eq(generationAttempts.productId, input.product.productId));
      const attemptId = newId("attempt");
      const [created] = await tx
        .insert(generationAttempts)
        .values({
          id: attemptId,
          workspaceId: input.workspaceId,
          productId: input.product.productId,
          attemptNumber: numberRow?.next ?? 1,
          sourceAssetId: input.product.sourceAsset!.id,
          sceneBriefId: input.product.sceneBrief!.id,
          sceneBriefVersion: input.product.sceneBrief!.version,
          promptText: input.promptText,
          promptTemplateVersion: input.promptTemplateVersion,
          provider: "luma",
          model: "uni-1",
          requestType: "image_edit",
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          quoteFingerprint: input.quoteFingerprint,
          pricingVersion: input.pricingVersion,
          estimatedPriceMicros: input.estimatedPriceMicros,
          createdBy: input.actorId
        })
        .returning();
      await tx.insert(jobs).values({
        id: newId("job"),
        type: "submit_generation",
        deduplicationKey: `submit-generation:${attemptId}`,
        payloadJson: { attemptId }
      });
      return { attempt: asRecord(created), created: true };
    });
  }

  async getAttempt(attemptId: string) {
    const [attempt] = await getDb()
      .select()
      .from(generationAttempts)
      .where(eq(generationAttempts.id, attemptId))
      .limit(1);
    return attempt ? asRecord(attempt) : null;
  }

  async listAttempts(workspaceId: string, productId: string) {
    const rows = await getDb()
      .select()
      .from(generationAttempts)
      .where(
        and(
          eq(generationAttempts.workspaceId, workspaceId),
          eq(generationAttempts.productId, productId)
        )
      )
      .orderBy(asc(generationAttempts.createdAt));
    return rows.map(asRecord);
  }

  async estimatedUsageMicros(workspaceId: string) {
    const [row] = await getDb()
      .select({
        total: sql<number>`coalesce(sum(${generationAttempts.estimatedPriceMicros}), 0)::int`
      })
      .from(generationAttempts)
      .where(eq(generationAttempts.workspaceId, workspaceId));
    return row?.total ?? 0;
  }

  async transition(
    attemptId: string,
    from: GenerationAttemptRecord["status"][],
    patch: Partial<GenerationAttemptRecord>,
    nextJob?: {
      type: "poll_generation" | "persist_generation_output";
      deduplicationKey: string;
      payload: unknown;
      runAfter?: Date;
    }
  ) {
    return getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(generationAttempts)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(generationAttempts.id, attemptId),
            inArray(generationAttempts.status, from)
          )
        )
        .returning();
      if (!updated) return null;
      if (nextJob) {
        await tx
          .insert(jobs)
          .values({
            id: newId("job"),
            type: nextJob.type,
            deduplicationKey: nextJob.deduplicationKey,
            payloadJson: nextJob.payload,
            runAfter: nextJob.runAfter ?? new Date()
          })
          .onConflictDoNothing({ target: jobs.deduplicationKey });
      }
      return asRecord(updated);
    });
  }

  async completePersistence(input: {
    attemptId: string;
    workspaceId: string;
    productId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    checksum: string;
  }) {
    return getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(assets)
        .where(eq(assets.objectKey, input.objectKey))
        .limit(1);
      const assetId = existing?.id ?? newId("asset");
      if (!existing)
        await tx.insert(assets).values({
          id: assetId,
          workspaceId: input.workspaceId,
          productId: input.productId,
          kind: "generated_image",
          objectKey: input.objectKey,
          mimeType: input.contentType,
          byteSize: input.byteSize,
          checksum: input.checksum,
          status: "ready"
        });
      const [attempt] = await tx
        .update(generationAttempts)
        .set({
          status: "succeeded",
          outputAssetId: assetId,
          providerOutputUrl: null,
          completedAt: new Date(),
          updatedAt: new Date()
        })
        .where(
          and(
            eq(generationAttempts.id, input.attemptId),
            eq(generationAttempts.status, "storing")
          )
        )
        .returning();
      if (!attempt)
        throw new AppError(
          "CONFLICT",
          "Generation output was already finalized or is not ready to store.",
          409
        );
      return asRecord(attempt);
    });
  }
}

type AttemptRow = typeof generationAttempts.$inferSelect;
function asRecord(row: AttemptRow): GenerationAttemptRecord {
  return {
    ...row,
    provider: "luma",
    model: "uni-1",
    requestType: "image_edit",
    failureDetails: row.failureDetails ?? null
  };
}
