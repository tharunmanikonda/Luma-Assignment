export const generationStatuses = [
  "pending",
  "submitting",
  "queued",
  "processing",
  "storing",
  "succeeded",
  "failed",
  "reconciliation_required"
] as const;

export type GenerationStatus = (typeof generationStatuses)[number];
export type GenerationBlockerCode =
  | "SOURCE_REQUIRED"
  | "SOURCE_NOT_READY"
  | "SCENE_REQUIRED"
  | "SCENE_INVALID"
  | "RECONCILIATION_REQUIRED";

export interface GenerationBlocker {
  code: GenerationBlockerCode;
  message: string;
}

export interface ProductGenerationInput {
  productId: string;
  workspaceId: string;
  name: string;
  category: string | null;
  material: string | null;
  colorFinish: string | null;
  sourceAsset: {
    id: string;
    productId: string | null;
    workspaceId: string;
    objectKey: string;
    status: "pending" | "ready" | "failed";
    mimeType: string | null;
  } | null;
  sceneBrief: {
    id: string;
    productId: string;
    version: number;
    text: string;
  } | null;
  hasReconciliationRequiredAttempt: boolean;
}

export interface GenerationQuote {
  productId: string;
  sourceAssetId: string;
  sceneBriefId: string;
  sceneBriefVersion: number;
  model: "uni-1";
  requestType: "image_edit";
  candidateCount: 1;
  estimatedPriceMicros: number;
  estimatedAmount: string;
  currency: "USD";
  pricingVersion: string;
  promptTemplateVersion: string;
  quoteFingerprint: string;
}

export interface GenerationFailure {
  phase: "submission" | "generation" | "persistence" | "reconciliation";
  code: string;
  reason: string;
  retryable: boolean;
  httpStatus?: number;
  requestId?: string;
}

export interface GenerationAttemptRecord {
  id: string;
  workspaceId: string;
  productId: string;
  attemptNumber: number;
  sourceAssetId: string;
  sceneBriefId: string;
  sceneBriefVersion: number;
  promptText: string;
  promptTemplateVersion: string;
  provider: "luma";
  model: "uni-1";
  requestType: "image_edit";
  status: GenerationStatus;
  idempotencyKey: string;
  requestFingerprint: string;
  quoteFingerprint: string;
  pricingVersion: string;
  estimatedPriceMicros: number;
  providerGenerationId: string | null;
  providerRequestId: string | null;
  providerApiVersion: string | null;
  providerOutputUrl: string | null;
  outputAssetId: string | null;
  failureDetails: GenerationFailure | null;
  createdBy: string;
  createdAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
}

export function generationReadiness(input: ProductGenerationInput) {
  const blockers: GenerationBlocker[] = [];
  const scene = input.sceneBrief?.text.trim() ?? "";

  if (!input.sourceAsset) {
    blockers.push({
      code: "SOURCE_REQUIRED",
      message: "Add a product photo before creating an image."
    });
  } else if (
    input.sourceAsset.status !== "ready" ||
    input.sourceAsset.workspaceId !== input.workspaceId ||
    input.sourceAsset.productId !== input.productId
  ) {
    blockers.push({
      code: "SOURCE_NOT_READY",
      message: "The product photo is still being prepared or cannot be used."
    });
  }

  if (!input.sceneBrief) {
    blockers.push({
      code: "SCENE_REQUIRED",
      message: "Describe the scene before creating an image."
    });
  } else if (
    input.sceneBrief.productId !== input.productId ||
    scene.length < 8
  ) {
    blockers.push({
      code: "SCENE_INVALID",
      message: "Add a little more scene detail before creating an image."
    });
  }

  if (input.hasReconciliationRequiredAttempt) {
    blockers.push({
      code: "RECONCILIATION_REQUIRED",
      message:
        "A previous request has an uncertain provider result. Resolve it before spending again."
    });
  }

  return blockers;
}

export function customerGenerationState(attempt: GenerationAttemptRecord) {
  switch (attempt.status) {
    case "pending":
    case "submitting":
      return { label: "Preparing", terminal: false, nextAction: null };
    case "queued":
      return { label: "Waiting", terminal: false, nextAction: null };
    case "processing":
      return { label: "Creating image", terminal: false, nextAction: null };
    case "storing":
      return { label: "Finishing", terminal: false, nextAction: null };
    case "succeeded":
      return { label: "Ready to review", terminal: true, nextAction: null };
    case "reconciliation_required":
      return {
        label: "Needs attention",
        terminal: false,
        nextAction: "Check this request before creating another image."
      };
    case "failed":
      return {
        label: "Could not create",
        terminal: true,
        nextAction: safeFailureAction(attempt.failureDetails?.code)
      };
  }
}

function safeFailureAction(code?: string) {
  switch (code) {
    case "content_moderated":
      return "Review the scene instructions or source photo, then confirm a new attempt.";
    case "image_too_large":
    case "unsupported_format":
    case "corrupt_input":
      return "Replace or prepare the source photo before trying again.";
    case "budget_exhausted":
      return "Generation is paused until budget is available.";
    default:
      return "Review the attempt details, then deliberately confirm a new attempt.";
  }
}
