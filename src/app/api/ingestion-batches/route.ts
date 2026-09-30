import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import {
  createIngestionBatch,
  listIngestionHistory
} from "@/modules/ingestion/ingestion-service";
import { AppError } from "@/shared/errors";

export const GET = apiRoute(async (request) => {
  const actor = await requireOperator();
  const params = new URL(request.url).searchParams;
  const offsetValue = params.get("offset");
  const offset = offsetValue ? Number(offsetValue) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new AppError("BAD_REQUEST", "Import history offset is invalid.", 400);
  }
  return NextResponse.json(
    await listIngestionHistory({ actor, offset, limit: 5 })
  );
});

export const POST = apiRoute(async (request) => {
  const actor = await requireOperator();
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new AppError("BAD_REQUEST", "Upload the catalog as form data.", 400);
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new AppError("VALIDATION_FAILED", "Choose a CSV file.", 422, false, {
      file: "Choose a CSV file to continue."
    });
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new AppError(
      "VALIDATION_FAILED",
      "The CSV must be no larger than 10 MB.",
      422,
      false,
      { file: "Choose a CSV no larger than 10 MB." }
    );
  }
  const result = await createIngestionBatch({
    actor,
    idempotencyKey: request.headers.get("idempotency-key"),
    filename: file.name,
    contentType: file.type || "text/csv",
    bytes: new Uint8Array(await file.arrayBuffer())
  });
  return NextResponse.json(result, { status: 202 });
});
