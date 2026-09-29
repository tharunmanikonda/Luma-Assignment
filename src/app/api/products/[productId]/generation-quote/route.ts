import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { generationApi } from "@/modules/generation/api";
import { getGenerationService } from "@/modules/generation/runtime";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  return generationApi(async () => {
    const actor = await requireOperator();
    const { productId } = await params;
    const sourceAssetId =
      request.nextUrl.searchParams.get("sourceAssetId") ?? "";
    const sceneBriefId = request.nextUrl.searchParams.get("sceneBriefId") ?? "";
    const result = await getGenerationService().quote(
      actor.workspaceId,
      productId,
      sourceAssetId,
      sceneBriefId
    );
    return NextResponse.json(result);
  });
}
