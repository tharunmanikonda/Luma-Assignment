import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/infrastructure/auth/session";
import { AppError } from "@/shared/errors";
import { generationApi } from "@/modules/generation/api";
import { presentAttempt } from "@/modules/generation/presenter";
import {
  getGenerationRepository,
  getGenerationService
} from "@/modules/generation/runtime";

const bodySchema = z.object({
  sourceAssetId: z.string().min(1),
  sceneBriefId: z.string().min(1),
  pricingVersion: z.string().min(1),
  quoteFingerprint: z.string().length(64)
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return generationApi(async () => {
    const actor = await requireOperator();
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey)
      throw new AppError(
        "BAD_REQUEST",
        "An Idempotency-Key header is required.",
        400
      );
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success)
      throw new AppError(
        "VALIDATION_FAILED",
        "Review the generation details and try again.",
        422
      );
    const { id } = await params;
    const result = await getGenerationService().authorize({
      workspaceId: actor.workspaceId,
      productId: id,
      actorId: actor.id,
      idempotencyKey,
      ...parsed.data
    });
    return NextResponse.json(
      { attempt: presentAttempt(result.attempt), replayed: !result.created },
      { status: 202 }
    );
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return generationApi(async () => {
    const actor = await requireOperator();
    const { id } = await params;
    const attempts = await getGenerationRepository().listAttempts(
      actor.workspaceId,
      id
    );
    const estimatedPriceMicros = attempts.reduce(
      (sum, attempt) => sum + attempt.estimatedPriceMicros,
      0
    );
    return NextResponse.json({
      attempts: attempts.map(presentAttempt),
      estimatedUsage: {
        amount: (estimatedPriceMicros / 1_000_000).toFixed(4),
        currency: "USD"
      }
    });
  });
}
