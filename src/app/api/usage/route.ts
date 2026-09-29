import { NextResponse } from "next/server";
import { requireOperator } from "@/infrastructure/auth/session";
import { readUsageSummary } from "@/modules/delivery/usage-service";
import { generationApi } from "@/modules/generation/api";

export async function GET() {
  return generationApi(async () => {
    const actor = await requireOperator();
    return NextResponse.json(await readUsageSummary(actor.workspaceId));
  });
}
