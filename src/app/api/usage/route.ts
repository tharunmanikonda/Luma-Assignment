import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { generationApi } from "@/modules/generation/api";
import { getGenerationRepository } from "@/modules/generation/runtime";

export async function GET() {
  return generationApi(async () => {
    const actor = await requireOperator();
    const estimatedMicros =
      await getGenerationRepository().estimatedUsageMicros(actor.workspaceId);
    return NextResponse.json({
      estimatedAmount: (estimatedMicros / 1_000_000).toFixed(4),
      currency: "USD",
      basis: "authorized attempts"
    });
  });
}
