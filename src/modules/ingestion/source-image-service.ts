import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { assets } from "@/db/schema";
import type { ObjectStore } from "@/infrastructure/storage/object-store";
import { getObjectStore } from "@/infrastructure/storage/local-object-store";
import { assertSafeSourceUrl, inspectImage } from "./source-image-policy";

const maxImageBytes = 50 * 1024 * 1024;
const maxRedirects = 3;

async function resolveAddresses(hostname: string) {
  return (await lookup(hostname, { all: true })).map((entry) => entry.address);
}

async function readLimited(response: Response) {
  if (!response.body)
    throw new Error("Source image returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxImageBytes) {
      await reader.cancel();
      throw new Error("Source image exceeds the 50 MB limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchSafeImage(
  originalUrl: string,
  fetcher: typeof fetch,
  resolver: (hostname: string) => Promise<string[]>
) {
  let url = await assertSafeSourceUrl(originalUrl, resolver);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "image/jpeg,image/png,image/webp" }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === maxRedirects) {
        throw new Error("Source image redirected too many times.");
      }
      url = await assertSafeSourceUrl(
        new URL(location, url).toString(),
        resolver
      );
      continue;
    }
    if (!response.ok)
      throw new Error(`Source image returned HTTP ${response.status}.`);
    return readLimited(response);
  }
  throw new Error("Source image redirected too many times.");
}

export async function ingestSourceAsset(
  assetId: string,
  options: {
    objectStore?: ObjectStore;
    fetcher?: typeof fetch;
    resolver?: (hostname: string) => Promise<string[]>;
  } = {}
) {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset || asset.kind !== "source_image") {
    throw new Error(`Source asset ${assetId} was not found.`);
  }
  if (asset.status === "ready") return asset;
  if (!asset.originalUrl) throw new Error("Source asset has no original URL.");

  try {
    const bytes = await fetchSafeImage(
      asset.originalUrl,
      options.fetcher ?? fetch,
      options.resolver ?? resolveAddresses
    );
    const metadata = inspectImage(bytes);
    const objectKey = asset.objectKey.replace(
      /\.pending$/,
      `.${metadata.extension}`
    );
    await (options.objectStore ?? getObjectStore()).put({
      key: objectKey,
      bytes,
      contentType: metadata.mimeType
    });
    const [ready] = await db
      .update(assets)
      .set({
        objectKey,
        mimeType: metadata.mimeType,
        byteSize: bytes.byteLength,
        width: metadata.width,
        height: metadata.height,
        checksum: createChecksum(bytes),
        status: "ready",
        failureDetailsJson: null,
        updatedAt: new Date()
      })
      .where(eq(assets.id, assetId))
      .returning();
    return ready;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Source image ingestion failed.";
    await db
      .update(assets)
      .set({
        status: "failed",
        failureDetailsJson: {
          phase: "source_ingestion",
          reason: message.slice(0, 500)
        },
        updatedAt: new Date()
      })
      .where(eq(assets.id, assetId));
    throw error;
  }
}

function createChecksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
