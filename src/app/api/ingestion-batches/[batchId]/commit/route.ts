import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import { commitIngestionBatch } from "@/modules/ingestion/ingestion-service";
import { AppError } from "@/shared/errors";

export const POST = apiRoute(async (request) => {
  const actor = await requireOperator();
  const parts = new URL(request.url).pathname.split("/");
  const batchId = parts.at(-2);
  if (!batchId)
    throw new AppError("BAD_REQUEST", "Import ID is required.", 400);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new AppError(
      "BAD_REQUEST",
      "A valid Idempotency-Key header is required.",
      400
    );
  }
  return NextResponse.json(await commitIngestionBatch({ actor, batchId }));
});
