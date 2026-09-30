import { createHash } from "node:crypto";
import sharp from "sharp";
import { requireReviewActor, withReviewApiErrors } from "@/modules/reviews/api";
import { getAssetContentService } from "@/modules/reviews/asset-content";

type ImageVariant = "original" | "thumbnail" | "preview";

const variantSizes = {
  thumbnail: { width: 640, height: 480 },
  preview: { width: 960, height: 720 }
} as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withReviewApiErrors(async () => {
    const actor = await requireReviewActor();
    const { id } = await context.params;
    const variant = readVariant(request);
    const content = await getAssetContentService().read({
      assetId: id,
      actor
    });
    const etag = createEtag(id, variant);

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: cacheHeaders(etag)
      });
    }

    const image = await renderVariant(content, variant);
    const bytes = Uint8Array.from(image.bytes);
    return new Response(bytes.buffer, {
      headers: {
        ...cacheHeaders(etag),
        "content-length": String(image.bytes.byteLength),
        "content-type": image.contentType,
        "x-content-type-options": "nosniff"
      }
    });
  })();
}

function readVariant(request: Request): ImageVariant {
  const variant = new URL(request.url).searchParams.get("variant");
  return variant === "thumbnail" || variant === "preview"
    ? variant
    : "original";
}

async function renderVariant(
  content: { bytes: Uint8Array; contentType: string },
  variant: ImageVariant
) {
  if (variant === "original" || !content.contentType.startsWith("image/")) {
    return content;
  }

  const size = variantSizes[variant];
  try {
    const bytes = await sharp(content.bytes)
      .rotate()
      .resize({
        width: size.width,
        height: size.height,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 82, effort: 3 })
      .toBuffer();
    return { bytes, contentType: "image/webp" };
  } catch {
    return content;
  }
}

function createEtag(assetId: string, variant: ImageVariant) {
  const digest = createHash("sha256")
    .update(`${assetId}:${variant}:v1`)
    .digest("base64url");
  return `"${digest}"`;
}

function cacheHeaders(etag: string) {
  return {
    "cache-control": "private, max-age=86400, must-revalidate",
    etag,
    vary: "Cookie"
  };
}
