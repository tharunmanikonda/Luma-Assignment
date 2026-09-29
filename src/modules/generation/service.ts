import { AppError } from "@/shared/errors";
import { buildGenerationPrompt, promptTemplateVersion } from "./prompt";
import {
  buildGenerationQuote,
  generationPricing,
  requestFingerprint
} from "./pricing";
import { generationReadiness } from "./domain";
import type { GenerationRepository } from "./repository";

export class GenerationService {
  constructor(
    private readonly repository: GenerationRepository,
    private readonly budgetMicros: number
  ) {}

  async quote(
    workspaceId: string,
    productId: string,
    sourceAssetId: string,
    sceneBriefId: string
  ) {
    const product = await this.repository.getProductInput(
      workspaceId,
      productId,
      sourceAssetId,
      sceneBriefId
    );
    if (!product) throw new AppError("NOT_FOUND", "Product not found.", 404);
    const blockers = generationReadiness(product);
    if (blockers.length) return { ready: false as const, blockers };
    return { ready: true as const, quote: buildGenerationQuote(product) };
  }

  async authorize(input: {
    workspaceId: string;
    productId: string;
    sourceAssetId: string;
    sceneBriefId: string;
    pricingVersion: string;
    quoteFingerprint: string;
    idempotencyKey: string;
    actorId: string;
  }) {
    if (!input.idempotencyKey.trim())
      throw new AppError("BAD_REQUEST", "An idempotency key is required.", 400);
    const quoted = await this.quote(
      input.workspaceId,
      input.productId,
      input.sourceAssetId,
      input.sceneBriefId
    );
    if (!quoted.ready)
      throw new AppError(
        "VALIDATION_FAILED",
        quoted.blockers[0]?.message ?? "This product is not ready.",
        422
      );
    if (
      input.pricingVersion !== generationPricing.pricingVersion ||
      input.quoteFingerprint !== quoted.quote.quoteFingerprint
    ) {
      throw new AppError(
        "CONFLICT",
        "The generation quote changed. Review the current estimate before confirming.",
        409
      );
    }
    const product = await this.repository.getProductInput(
      input.workspaceId,
      input.productId,
      input.sourceAssetId,
      input.sceneBriefId
    );
    if (!product) throw new AppError("NOT_FOUND", "Product not found.", 404);
    const fingerprint = requestFingerprint(input);
    return this.repository.authorizeAttempt({
      workspaceId: input.workspaceId,
      product,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      quoteFingerprint: quoted.quote.quoteFingerprint,
      pricingVersion: quoted.quote.pricingVersion,
      estimatedPriceMicros: quoted.quote.estimatedPriceMicros,
      budgetMicros: this.budgetMicros,
      promptText: buildGenerationPrompt(product),
      promptTemplateVersion
    });
  }

  async readAttempt(workspaceId: string, attemptId: string) {
    const attempt = await this.repository.getAttempt(attemptId);
    if (!attempt || attempt.workspaceId !== workspaceId)
      throw new AppError("NOT_FOUND", "Generation attempt not found.", 404);
    return attempt;
  }
}
