import { readFile } from "node:fs/promises";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { jobs, users, workspaces } from "@/db/schema";
import type {
  ObjectStore,
  StoredObject
} from "@/infrastructure/storage/object-store";
import { getProduct } from "@/modules/catalog/catalog-service";
import { products, sceneBriefs } from "@/modules/catalog/schema";
import { saveSceneBrief } from "@/modules/scene-briefs/scene-brief-service";
import { resetFoundationDatabase, runDatabaseTests } from "@/test/postgres";
import {
  commitIngestionBatch,
  createIngestionBatch,
  getIngestionPreview,
  parseIngestionBatch
} from "./ingestion-service";

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

const maya = { id: "usr_catalog_maya", workspaceId: "ws_catalog" };
const outsider = { id: "usr_catalog_other", workspaceId: "ws_other" };

describe.runIf(runDatabaseTests)(
  "catalog ingestion PostgreSQL integration",
  () => {
    const objectStore = new MemoryObjectStore();
    let catalogBytes: Uint8Array;

    beforeAll(async () => {
      await resetFoundationDatabase();
      await getDb()
        .insert(workspaces)
        .values([
          { id: maya.workspaceId, name: "Catalog Workspace" },
          { id: outsider.workspaceId, name: "Other Workspace" }
        ]);
      await getDb()
        .insert(users)
        .values([
          {
            id: maya.id,
            name: "Maya",
            email: "maya-catalog@example.test",
            displayName: "Maya",
            role: "operator",
            workspaceId: maya.workspaceId
          },
          {
            id: outsider.id,
            name: "Other",
            email: "other-catalog@example.test",
            displayName: "Other",
            role: "operator",
            workspaceId: outsider.workspaceId
          }
        ]);
      catalogBytes = await readFile(
        new URL("../../../data/catalog.csv", import.meta.url)
      );
    });

    afterAll(async () => {
      await closeDb();
    });

    it("imports the catalog idempotently without spending generation budget", async () => {
      const first = await createIngestionBatch({
        actor: maya,
        idempotencyKey: "catalog-upload-001",
        filename: "catalog.csv",
        contentType: "text/csv",
        bytes: catalogBytes,
        objectStore
      });
      const repeatedUpload = await createIngestionBatch({
        actor: maya,
        idempotencyKey: "catalog-upload-001",
        filename: "catalog.csv",
        contentType: "text/csv",
        bytes: catalogBytes,
        objectStore
      });
      expect(repeatedUpload).toMatchObject({ id: first.id, repeated: true });

      await expect(
        createIngestionBatch({
          actor: maya,
          idempotencyKey: "catalog-upload-001",
          filename: "catalog.csv",
          contentType: "text/csv",
          bytes: new TextEncoder().encode("SKU,Product Name\nHG-001,Changed"),
          objectStore
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });

      await parseIngestionBatch(first.id, objectStore);
      const preview = await getIngestionPreview({
        actor: maya,
        batchId: first.id
      });
      expect(preview.counts).toEqual({
        total: 40,
        valid: 40,
        invalid: 0,
        create: 40,
        update: 0,
        unchanged: 0
      });

      const committed = await commitIngestionBatch({
        actor: maya,
        batchId: first.id
      });
      expect(committed).toMatchObject({
        committed: 40,
        invalid: 0,
        repeated: false
      });
      expect(
        await commitIngestionBatch({ actor: maya, batchId: first.id })
      ).toMatchObject({
        committed: 40,
        repeated: true
      });

      const [{ value: productCount }] = await getDb()
        .select({ value: count() })
        .from(products)
        .where(eq(products.workspaceId, maya.workspaceId));
      expect(productCount).toBe(40);
      const [{ value: generationJobs }] = await getDb()
        .select({ value: count() })
        .from(jobs)
        .where(eq(jobs.type, "submit_generation"));
      expect(generationJobs).toBe(0);

      const second = await createIngestionBatch({
        actor: maya,
        idempotencyKey: "catalog-upload-002",
        filename: "catalog.csv",
        contentType: "text/csv",
        bytes: catalogBytes,
        objectStore
      });
      await parseIngestionBatch(second.id, objectStore);
      expect(
        (await getIngestionPreview({ actor: maya, batchId: second.id })).counts
          .unchanged
      ).toBe(40);
      await commitIngestionBatch({ actor: maya, batchId: second.id });
      const [{ value: countAfterReimport }] = await getDb()
        .select({ value: count() })
        .from(products)
        .where(eq(products.workspaceId, maya.workspaceId));
      expect(countAfterReimport).toBe(40);

      const [product] = await getDb()
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.workspaceId, maya.workspaceId),
            eq(products.sku, "HG-002")
          )
        );
      await expect(
        getProduct({ actor: outsider, productId: product.id })
      ).rejects.toMatchObject({
        code: "NOT_FOUND"
      });

      const beforeSceneSave = await getDb()
        .select({ value: count() })
        .from(jobs)
        .where(eq(jobs.type, "submit_generation"));
      const saved = await saveSceneBrief({
        actor: maya,
        productId: product.id,
        scene: "A bright breakfast table beside a softly lit kitchen window."
      });
      expect(saved).toMatchObject({ source: "maya_edited", repeated: false });
      const versions = await getDb()
        .select({ version: sceneBriefs.version })
        .from(sceneBriefs)
        .where(eq(sceneBriefs.productId, product.id));
      expect(versions).toHaveLength(2);
      const afterSceneSave = await getDb()
        .select({ value: count() })
        .from(jobs)
        .where(eq(jobs.type, "submit_generation"));
      expect(afterSceneSave).toEqual(beforeSceneSave);
    });
  }
);
