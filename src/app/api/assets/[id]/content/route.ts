import { requireReviewActor, withReviewApiErrors } from "@/modules/reviews/api";
import { getAssetContentService } from "@/modules/reviews/asset-content";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withReviewApiErrors(async () => {
    const actor = await requireReviewActor();
    const { id } = await context.params;
    const content = await getAssetContentService().read({
      assetId: id,
      actor
    });
    const bytes = Uint8Array.from(content.bytes);
    return new Response(bytes.buffer, {
      headers: {
        "cache-control": "private, no-store",
        "content-length": String(content.bytes.byteLength),
        "content-type": content.contentType,
        "x-content-type-options": "nosniff"
      }
    });
  })();
}
