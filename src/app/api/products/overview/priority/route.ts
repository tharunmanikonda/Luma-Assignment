import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import { listPriorityQueue } from "@/modules/catalog/catalog-service";
import { AppError } from "@/shared/errors";

function readOffset(value: string | null) {
  if (value === null) return 0;
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new AppError("BAD_REQUEST", "Overview offset is invalid.", 400);
  }
  return offset;
}

export const GET = apiRoute(async (request) => {
  const actor = await requireOperator();
  const params = new URL(request.url).searchParams;
  return NextResponse.json(
    await listPriorityQueue({
      actor,
      offset: readOffset(params.get("offset")),
      limit: 4
    })
  );
});
