import type {
  GenerationAttemptRecord,
  GenerationFailure,
  GenerationStatus,
  ProductGenerationInput
} from "./domain";

export interface AuthorizeAttemptInput {
  workspaceId: string;
  product: ProductGenerationInput;
  actorId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  quoteFingerprint: string;
  pricingVersion: string;
  estimatedPriceMicros: number;
  budgetMicros: number;
  promptText: string;
  promptTemplateVersion: string;
}

export interface GenerationRepository {
  getProductInput(
    workspaceId: string,
    productId: string,
    sourceAssetId: string,
    sceneBriefId: string
  ): Promise<ProductGenerationInput | null>;
  authorizeAttempt(
    input: AuthorizeAttemptInput
  ): Promise<{ attempt: GenerationAttemptRecord; created: boolean }>;
  getAttempt(attemptId: string): Promise<GenerationAttemptRecord | null>;
  listAttempts(
    workspaceId: string,
    productId: string
  ): Promise<GenerationAttemptRecord[]>;
  estimatedUsageMicros(workspaceId: string): Promise<number>;
  transition(
    attemptId: string,
    from: GenerationStatus[],
    patch: Partial<GenerationAttemptRecord>,
    nextJob?: {
      type: "poll_generation" | "persist_generation_output";
      deduplicationKey: string;
      payload: unknown;
      runAfter?: Date;
    }
  ): Promise<GenerationAttemptRecord | null>;
  completePersistence(input: {
    attemptId: string;
    workspaceId: string;
    productId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    checksum: string;
  }): Promise<GenerationAttemptRecord>;
}

export function failure(
  phase: GenerationFailure["phase"],
  code: string,
  reason: string,
  retryable: boolean,
  extras: Partial<GenerationFailure> = {}
): GenerationFailure {
  return { phase, code, reason, retryable, ...extras };
}
