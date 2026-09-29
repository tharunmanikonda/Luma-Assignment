import {
  LumaRequestError,
  type LumaGateway,
  type LumaGenerationStatus,
  type LumaOutput,
  type LumaSubmission
} from "./luma-gateway";

export type FakeLumaScenario =
  | "success"
  | "accepted_failure"
  | "rate_limited"
  | "unknown_submission"
  | "output_download_failure";

export class FakeLumaGateway implements LumaGateway {
  readonly submissions: string[] = [];
  readonly polls: string[] = [];
  private pollCount = 0;

  constructor(private readonly scenario: FakeLumaScenario = "success") {}

  async submitImageEdit(input: {
    source: string;
    prompt: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<LumaSubmission> {
    this.submissions.push(input.idempotencyKey);
    if (this.scenario === "rate_limited") {
      throw new LumaRequestError(
        "Provider capacity is temporarily full.",
        "rate_limited",
        "rejected",
        true,
        429,
        2_000,
        "fake_request_rate_limited"
      );
    }
    if (this.scenario === "unknown_submission") {
      throw new LumaRequestError(
        "The submission response was interrupted.",
        "submission_unknown",
        "unknown",
        false
      );
    }
    return {
      providerGenerationId: `fake_${input.idempotencyKey}`,
      state: "queued",
      requestId: "fake_request_submit",
      apiVersion: "fake-v1"
    };
  }

  async getGeneration(
    providerGenerationId: string
  ): Promise<LumaGenerationStatus> {
    this.polls.push(providerGenerationId);
    this.pollCount += 1;
    if (this.scenario === "accepted_failure") {
      return {
        providerGenerationId,
        state: "failed",
        requestId: "fake_request_poll",
        apiVersion: "fake-v1",
        failureCode: "generation_failed",
        failureReason: "The provider could not complete this image."
      };
    }
    if (this.pollCount === 1)
      return { providerGenerationId, state: "processing" };
    return {
      providerGenerationId,
      state: "completed",
      outputUrl: `fake-output://${providerGenerationId}`,
      requestId: "fake_request_poll",
      apiVersion: "fake-v1"
    };
  }

  async downloadOutput(): Promise<LumaOutput> {
    if (this.scenario === "output_download_failure") {
      throw new LumaRequestError(
        "Temporary output download failed.",
        "output_download_failed",
        "rejected",
        true,
        503
      );
    }
    return {
      bytes: new TextEncoder().encode("fake-image-bytes"),
      contentType: "image/png"
    };
  }
}
