import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import { getDeliveryService } from "@/modules/delivery/export-service";

export const GET = apiRoute(async () => {
  const actor = await requireOperator();
  const csv = await getDeliveryService().catalogCsv(actor.workspaceId);
  return new Response(csv, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="catalog-status.csv"',
      "content-type": "text/csv; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
});
