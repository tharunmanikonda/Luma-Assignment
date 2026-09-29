import { requireOperator } from "@/infrastructure/auth/session";
import { getDeliveryService } from "@/modules/delivery/export-service";
import { newRequestId } from "@/shared/ids";
import { toErrorEnvelope } from "@/shared/errors";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId();
  try {
    const actor = await requireOperator();
    const { id } = await context.params;
    const download = await getDeliveryService().approvedDownload({
      workspaceId: actor.workspaceId,
      assetId: id
    });
    const bytes = Uint8Array.from(download.bytes);
    return new Response(bytes.buffer, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${download.filename}"`,
        "content-length": String(download.bytes.byteLength),
        "content-type": download.contentType,
        "x-content-type-options": "nosniff",
        "x-request-id": requestId
      }
    });
  } catch (error) {
    const envelope = toErrorEnvelope(error, requestId);
    return Response.json(envelope.body, {
      status: envelope.status,
      headers: { "x-request-id": requestId }
    });
  }
}
