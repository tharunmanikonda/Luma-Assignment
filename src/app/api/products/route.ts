import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import { listProducts } from "@/modules/catalog/catalog-service";
import type { CatalogWorkflowStatus } from "@/modules/catalog/status";
import { AppError } from "@/shared/errors";

const statuses = new Set(["all", "needs_setup", "ready_to_generate"]);

export const GET = apiRoute(async (request) => {
  const actor = await requireOperator();
  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? "all";
  if (!statuses.has(status)) {
    throw new AppError("BAD_REQUEST", "Product status filter is invalid.", 400);
  }
  return NextResponse.json(
    await listProducts({
      actor,
      search: params.get("search") ?? undefined,
      status: status as CatalogWorkflowStatus | "all",
      cursor: params.get("cursor") ?? undefined
    })
  );
});
