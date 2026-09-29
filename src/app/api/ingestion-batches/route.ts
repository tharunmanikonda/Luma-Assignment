import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import { createIngestionBatch } from "@/modules/ingestion/ingestion-service";
import { AppError } from "@/shared/errors";

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
