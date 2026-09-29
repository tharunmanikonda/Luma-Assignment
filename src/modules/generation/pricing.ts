import { createHash } from "node:crypto";
import type { GenerationQuote, ProductGenerationInput } from "./domain";
import { promptTemplateVersion } from "./prompt";

export const generationPricing = {
  model: "uni-1",
  requestType: "image_edit",
  candidateCount: 1,
  estimatedPriceMicros: 43_400,
  currency: "USD",
  pricingVersion: "luma-uni-1-2026-09-27"
} as const;

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildGenerationQuote(
  input: ProductGenerationInput
): GenerationQuote {
  if (!input.sourceAsset || !input.sceneBrief)
    throw new Error("Ready source and scene records are required for a quote.");
  const fingerprintInput = {
    productId: input.productId,
    sourceAssetId: input.sourceAsset.id,
    sceneBriefId: input.sceneBrief.id,
    sceneBriefVersion: input.sceneBrief.version,
    sceneText: input.sceneBrief.text.trim(),
    productFacts: {
      name: input.name,
      category: input.category,
      material: input.material,
      colorFinish: input.colorFinish
    },
    ...generationPricing,
    promptTemplateVersion
  };
  return {
    productId: input.productId,
    sourceAssetId: input.sourceAsset.id,
    sceneBriefId: input.sceneBrief.id,
    sceneBriefVersion: input.sceneBrief.version,
    ...generationPricing,
    estimatedAmount: (
      generationPricing.estimatedPriceMicros / 1_000_000
    ).toFixed(4),
    promptTemplateVersion,
    quoteFingerprint: hashJson(fingerprintInput)
  };
}

export function requestFingerprint(input: {
  sourceAssetId: string;
  sceneBriefId: string;
  pricingVersion: string;
  quoteFingerprint: string;
}) {
  return hashJson(input);
}
