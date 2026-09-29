import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { generationApi } from "@/modules/generation/api";
import { presentAttempt } from "@/modules/generation/presenter";
import { getGenerationService } from "@/modules/generation/runtime";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return generationApi(async () => {
    const actor = await requireOperator();
    const { id } = await params;
    return NextResponse.json({
      attempt: presentAttempt(
        await getGenerationService().readAttempt(actor.workspaceId, id)
      )
    });
  });
}
