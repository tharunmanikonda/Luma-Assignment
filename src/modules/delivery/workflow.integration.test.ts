import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { users, workspaces } from "@/db/schema";
import { FakeLumaGateway } from "@/infrastructure/luma/fake-luma-gateway";
import type {
  ObjectStore,
  StoredObject
} from "@/infrastructure/storage/object-store";
import { getProduct } from "@/modules/catalog/catalog-service";
import { products, sceneBriefs } from "@/modules/catalog/schema";
import { PostgresGenerationRepository } from "@/modules/generation/postgres-repository";
import { GenerationService } from "@/modules/generation/service";
import { GenerationWorker } from "@/modules/generation/worker";
import {
  commitIngestionBatch,
  createIngestionBatch,
  parseIngestionBatch
} from "@/modules/ingestion/ingestion-service";
import { ingestSourceAsset } from "@/modules/ingestion/source-image-service";
import { ReviewService } from "@/modules/reviews/service";
import { PostgresReviewStore } from "@/modules/reviews/store";
import { saveSceneBrief } from "@/modules/scene-briefs/scene-brief-service";
import { resetFoundationDatabase, runDatabaseTests } from "@/test/postgres";
import { DeliveryService } from "./export-service";
import { readUsageSummary } from "./usage-service";

class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  async put(input: StoredObject) {
    this.objects.set(input.key, { ...input, bytes: input.bytes.slice() });
  }

  async get(key: string) {
    const object = this.objects.get(key);
    return object ? { ...object, bytes: object.bytes.slice() } : null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async signedReadUrl(key: string) {
    return `/test-objects/${encodeURIComponent(key)}`;
  }
}

const maya = {
  id: "usr_delivery_maya",
  workspaceId: "ws_delivery",
  role: "operator" as const
};
const ellie = {
  id: "usr_delivery_ellie",
  workspaceId: "ws_delivery",
  role: "approver" as const
};

function testPng() {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  new DataView(bytes.buffer).setUint32(16, 640);
  new DataView(bytes.buffer).setUint32(20, 480);
  return bytes;
}

async function completeAttempt(
  repository: PostgresGenerationRepository,
  objectStore: ObjectStore,
  attemptId: string
) {
  const worker = new GenerationWorker(
    repository,
    new FakeLumaGateway("success"),
    objectStore
  );
  expect(await worker.submit(attemptId)).toEqual({ action: "complete" });
  expect(await worker.poll(attemptId, 0)).toEqual({ action: "complete" });
  expect(await worker.poll(attemptId, 1)).toEqual({ action: "complete" });
  expect(await worker.persist(attemptId)).toEqual({ action: "complete" });
  const completed = await repository.getAttempt(attemptId);
  expect(completed).toMatchObject({
    status: "succeeded",
    outputAssetId: expect.any(String)
  });
  return completed!;
}

describe.runIf(runDatabaseTests)(
  "fake-provider delivery workflow PostgreSQL integration",
  () => {
    const objectStore = new MemoryObjectStore();
    const repository = new PostgresGenerationRepository();
    const generation = new GenerationService(repository, 1_000_000);
    const reviews = new ReviewService(
      new PostgresReviewStore(),
      "http://localhost:3000"
    );
    const delivery = new DeliveryService(objectStore, "http://localhost:3000");

    beforeAll(async () => {
      await resetFoundationDatabase();
      await getDb()
        .insert(workspaces)
        .values([
          { id: maya.workspaceId, name: "Delivery Workflow" },
          { id: "ws_delivery_other", name: "Other Workspace" }
        ]);
      await getDb()
        .insert(users)
        .values([
          {
            id: maya.id,
            name: "Maya",
            email: "maya-delivery@example.test",
            displayName: "Maya",
            role: maya.role,
            workspaceId: maya.workspaceId
          },
          {
            id: ellie.id,
            name: "Ellie",
            email: "ellie-delivery@example.test",
            displayName: "Ellie",
            role: ellie.role,
            workspaceId: ellie.workspaceId
          },
          {
            id: "usr_delivery_other",
            name: "Other Maya",
            email: "other-delivery@example.test",
            displayName: "Other Maya",
            role: "operator",
            workspaceId: "ws_delivery_other"
          }
        ]);
    });

    afterAll(async () => {
      await closeDb();
    });

    it("carries a product from catalog import through revision, approval, and delivery", async () => {
      const csv = new TextEncoder().encode(
        [
          "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
          "HG-QA-001,Stoneware Vase,Decor,Matte white,Stoneware,129.00,https://images.example.test/vase.png,Morning kitchen counter,Delivery workflow fixture"
        ].join("\n")
      );
      const batch = await createIngestionBatch({
        actor: maya,
        idempotencyKey: "delivery-catalog-upload",
        filename: "catalog.csv",
        contentType: "text/csv",
        bytes: csv,
        objectStore
      });
      await parseIngestionBatch(batch.id, objectStore);
      expect(
        await commitIngestionBatch({ actor: maya, batchId: batch.id })
      ).toMatchObject({ committed: 1, repeated: false });

      const [product] = await getDb()
        .select({
          id: products.id,
          sourceAssetId: products.currentSourceAssetId
        })
        .from(products)
        .where(
          and(
            eq(products.workspaceId, maya.workspaceId),
            eq(products.sku, "HG-QA-001")
          )
        );
      expect(product.sourceAssetId).toEqual(expect.any(String));
      await ingestSourceAsset(product.sourceAssetId!, {
        objectStore,
        resolver: async () => ["8.8.8.8"],
        fetcher: (async () =>
          new Response(testPng(), {
            status: 200,
            headers: { "content-type": "image/png" }
          })) as typeof fetch
      });
      await getDb()
        .update(products)
        .set({ targetApprovedImages: 1 })
        .where(eq(products.id, product.id));

      const initialScene = await saveSceneBrief({
        actor: maya,
        productId: product.id,
        scene: "Warm morning light on a pale kitchen counter."
      });
      const firstQuote = await generation.quote(
        maya.workspaceId,
        product.id,
        product.sourceAssetId!,
        initialScene.id
      );
      expect(firstQuote.ready).toBe(true);
      if (!firstQuote.ready) throw new Error("Expected a ready quote.");
      const firstAuthorized = await generation.authorize({
        workspaceId: maya.workspaceId,
        productId: product.id,
        sourceAssetId: product.sourceAssetId!,
        sceneBriefId: initialScene.id,
        pricingVersion: firstQuote.quote.pricingVersion,
        quoteFingerprint: firstQuote.quote.quoteFingerprint,
        idempotencyKey: "delivery-generation-one",
        actorId: maya.id
      });
      const replayedAuthorization = await generation.authorize({
        workspaceId: maya.workspaceId,
        productId: product.id,
        sourceAssetId: product.sourceAssetId!,
        sceneBriefId: initialScene.id,
        pricingVersion: firstQuote.quote.pricingVersion,
        quoteFingerprint: firstQuote.quote.quoteFingerprint,
        idempotencyKey: "delivery-generation-one",
        actorId: maya.id
      });
      expect(replayedAuthorization).toMatchObject({
        created: false,
        attempt: { id: firstAuthorized.attempt.id }
      });

      const firstAttempt = await completeAttempt(
        repository,
        objectStore,
        firstAuthorized.attempt.id
      );
      const firstReview = await reviews.createReview({
        actor: maya,
        generationAttemptId: firstAttempt.id,
        idempotencyKey: "delivery-review-one"
      });
      expect(
        await reviews.createReview({
          actor: maya,
          generationAttemptId: firstAttempt.id,
          idempotencyKey: "delivery-review-one"
        })
      ).toMatchObject({ id: firstReview.id });
      const requestedChanges = await reviews.decideReview({
        actor: ellie,
        reviewId: firstReview.id,
        idempotencyKey: "delivery-change-one",
        decision: {
          decision: "changes_requested",
          feedback: "Use cooler daylight and leave more space around the vase."
        }
      });
      expect(
        await reviews.decideReview({
          actor: ellie,
          reviewId: firstReview.id,
          idempotencyKey: "delivery-change-one",
          decision: {
            decision: "changes_requested",
            feedback:
              "Use cooler daylight and leave more space around the vase."
          }
        })
      ).toMatchObject({ id: requestedChanges.id, state: "changes_requested" });
      await expect(
        delivery.approvedDownload({
          workspaceId: maya.workspaceId,
          assetId: firstAttempt.outputAssetId!
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

      const revision = await saveSceneBrief({
        actor: maya,
        productId: product.id,
        scene:
          "Cool daylight on a pale kitchen counter with generous space around the vase.",
        basedOnReviewId: firstReview.id
      });
      expect(revision).toMatchObject({
        source: "revision_feedback",
        basedOnReviewId: firstReview.id
      });
      const secondQuote = await generation.quote(
        maya.workspaceId,
        product.id,
        product.sourceAssetId!,
        revision.id
      );
      expect(secondQuote.ready).toBe(true);
      if (!secondQuote.ready) throw new Error("Expected a ready quote.");
      const secondAuthorized = await generation.authorize({
        workspaceId: maya.workspaceId,
        productId: product.id,
        sourceAssetId: product.sourceAssetId!,
        sceneBriefId: revision.id,
        pricingVersion: secondQuote.quote.pricingVersion,
        quoteFingerprint: secondQuote.quote.quoteFingerprint,
        idempotencyKey: "delivery-generation-two",
        actorId: maya.id
      });
      const secondAttempt = await completeAttempt(
        repository,
        objectStore,
        secondAuthorized.attempt.id
      );
      const secondReview = await reviews.createReview({
        actor: maya,
        generationAttemptId: secondAttempt.id,
        idempotencyKey: "delivery-review-two"
      });
      const approval = await reviews.decideReview({
        actor: ellie,
        reviewId: secondReview.id,
        idempotencyKey: "delivery-approve-two",
        decision: { decision: "approved" }
      });
      expect(
        await reviews.decideReview({
          actor: ellie,
          reviewId: secondReview.id,
          idempotencyKey: "delivery-approve-two",
          decision: { decision: "approved" }
        })
      ).toMatchObject({ id: approval.id, state: "approved" });
      const ellieView = await reviews.readAssignedReview({
        actor: ellie,
        reviewId: secondReview.id
      });
      expect(ellieView).toMatchObject({
        state: "approved",
        candidate: { attemptNumber: 2 },
        history: [
          {
            attemptNumber: 1,
            state: "changes_requested",
            feedback:
              "Use cooler daylight and leave more space around the vase."
          }
        ]
      });

      const approved = await delivery.approvedDownload({
        workspaceId: maya.workspaceId,
        assetId: secondAttempt.outputAssetId!
      });
      expect(Array.from(approved.bytes.slice(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
      ]);
      expect(approved).toMatchObject({
        contentType: "image/png",
        filename: "hg-qa-001-approved-v2.png"
      });
      await expect(
        delivery.approvedDownload({
          workspaceId: "ws_delivery_other",
          assetId: secondAttempt.outputAssetId!
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

      const csvExport = await delivery.catalogCsv(maya.workspaceId);
      expect(csvExport).toContain('"HG-QA-001"');
      expect(csvExport).toContain('"Approved"');
      expect(csvExport).toContain(
        `"http://localhost:3000/api/assets/${secondAttempt.outputAssetId}/download"`
      );
      const usage = await readUsageSummary(maya.workspaceId);
      expect(usage).toMatchObject({
        attempts: { total: 2, successful: 2, failed: 0, active: 0 },
        approvedImages: 1,
        estimatedSpend: { amount: "0.0868", currency: "USD" },
        efficiency: {
          attemptsPerApprovedImage: 2,
          estimatedCostPerApprovedImage: "0.0868"
        }
      });

      const productDetail = await getProduct({
        actor: maya,
        productId: product.id
      });
      expect(productDetail.approvedOutputs).toEqual([
        expect.objectContaining({
          assetId: secondAttempt.outputAssetId,
          attemptNumber: 2,
          downloadUrl: `/api/assets/${secondAttempt.outputAssetId}/download`
        })
      ]);
      const sceneVersions = await getDb()
        .select({ version: sceneBriefs.version })
        .from(sceneBriefs)
        .where(eq(sceneBriefs.productId, product.id));
      expect(sceneVersions.map(({ version }) => version)).toEqual([1, 2, 3]);
    });
  }
);
