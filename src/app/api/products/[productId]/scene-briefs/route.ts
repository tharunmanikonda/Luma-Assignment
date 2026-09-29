import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { apiRoute } from "@/modules/catalog/api-response";
import { saveSceneBrief } from "@/modules/scene-briefs/scene-brief-service";
import { AppError } from "@/shared/errors";

export const POST = apiRoute(async (request) => {
  const actor = await requireOperator();
  const parts = new URL(request.url).pathname.split("/");
  const productId = parts.at(-2);
  if (!productId)
    throw new AppError("BAD_REQUEST", "Product ID is required.", 400);
  let body: { scene?: unknown; basedOnReviewId?: string | null };
  try {
    body = await request.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }
  const brief = await saveSceneBrief({
    actor,
    productId,
    scene: body.scene,
    basedOnReviewId: body.basedOnReviewId
  });
  return NextResponse.json(brief, { status: brief.repeated ? 200 : 201 });
});
