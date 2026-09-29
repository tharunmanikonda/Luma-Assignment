import {
  customerGenerationState,
  type GenerationAttemptRecord
} from "./domain";

export function presentAttempt(attempt: GenerationAttemptRecord) {
  return {
    id: attempt.id,
    productId: attempt.productId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    customerState: customerGenerationState(attempt),
    sceneBriefId: attempt.sceneBriefId,
    sceneBriefVersion: attempt.sceneBriefVersion,
    promptText: attempt.promptText,
    promptTemplateVersion: attempt.promptTemplateVersion,
    estimate: {
      amount: (attempt.estimatedPriceMicros / 1_000_000).toFixed(4),
      currency: "USD",
      pricingVersion: attempt.pricingVersion
    },
    outputAssetId: attempt.outputAssetId,
    failure: attempt.failureDetails
      ? {
          code: attempt.failureDetails.code,
          message: customerGenerationState(attempt).nextAction
        }
      : null,
    createdAt: attempt.createdAt,
    submittedAt: attempt.submittedAt,
    completedAt: attempt.completedAt
  };
}
