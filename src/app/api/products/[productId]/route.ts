import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import { getProduct } from "@/modules/catalog/catalog-service";
import { AppError } from "@/shared/errors";

export const GET = apiRoute(async (request) => {
  const actor = await requireOperator();
  const productId = new URL(request.url).pathname.split("/").at(-1);
  if (!productId)
    throw new AppError("BAD_REQUEST", "Product ID is required.", 400);
  return NextResponse.json(await getProduct({ actor, productId }));
});
