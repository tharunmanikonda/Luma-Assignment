import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import { getIngestionPreview } from "@/modules/ingestion/ingestion-service";
import { AppError } from "@/shared/errors";

export const GET = apiRoute(async (request) => {
  const actor = await requireOperator();
  const batchId = new URL(request.url).pathname.split("/").at(-1);
  if (!batchId)
    throw new AppError("BAD_REQUEST", "Import ID is required.", 400);
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = cursorValue ? Number(cursorValue) : undefined;
  if (cursorValue && (!Number.isInteger(cursor) || (cursor ?? 0) < 0)) {
    throw new AppError("BAD_REQUEST", "Import cursor is invalid.", 400);
  }
  return NextResponse.json(
    await getIngestionPreview({ actor, batchId, cursor })
  );
});
