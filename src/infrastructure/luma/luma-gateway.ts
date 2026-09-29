export type LumaProviderState =
  "queued" | "processing" | "completed" | "failed";
export interface LumaSubmission {
  providerGenerationId: string;
  state: LumaProviderState;
  requestId?: string;
  apiVersion?: string;
}
export interface LumaGenerationStatus extends LumaSubmission {
  outputUrl?: string;
  failureCode?: string;
  failureReason?: string;
}
export interface LumaOutput {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}
export interface LumaGateway {
  submitImageEdit(input: {
    source: { data: string; mediaType: string };
    prompt: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<LumaSubmission>;
  getGeneration(providerGenerationId: string): Promise<LumaGenerationStatus>;
  downloadOutput(outputUrl: string): Promise<LumaOutput>;
}
export class LumaRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly acceptance: "rejected" | "unknown",
    readonly retryable: boolean,
    readonly httpStatus?: number,
    readonly retryAfterMs?: number,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "LumaRequestError";
  }
}
