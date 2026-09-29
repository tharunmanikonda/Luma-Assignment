import {
  LumaRequestError,
  type LumaGateway,
  type LumaGenerationStatus,
  type LumaOutput,
  type LumaSubmission
} from "./luma-gateway";

export class HttpLumaGateway implements LumaGateway {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.lumalabs.ai"
  ) {}

  async submitImageEdit(input: {
    source: string;
    prompt: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<LumaSubmission> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/generations`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          type: "image_edit",
          model: "uni-1",
          source: input.source,
          prompt: input.prompt,
          user_id: input.userId
        })
      });
    } catch {
      throw new LumaRequestError(
        "The provider submission result is unknown.",
        "submission_unknown",
        "unknown",
        false
      );
    }
    if (!response.ok) throw await this.responseError(response);
    const body = (await response.json()) as {
      id: string;
      state: LumaSubmission["state"];
    };
    return {
      providerGenerationId: body.id,
      state: body.state,
      requestId: response.headers.get("x-request-id") ?? undefined,
      apiVersion: response.headers.get("x-api-version") ?? undefined
    };
  }

  async getGeneration(id: string): Promise<LumaGenerationStatus> {
    const response = await fetch(`${this.baseUrl}/v1/generations/${id}`, {
      headers: this.headers(false)
    });
    if (!response.ok) throw await this.responseError(response);
    const body = (await response.json()) as {
      id: string;
      state: LumaGenerationStatus["state"];
      assets?: { image?: string };
      failure_code?: string;
      failure_reason?: string;
    };
    return {
      providerGenerationId: body.id,
      state: body.state,
      outputUrl: body.assets?.image,
      failureCode: body.failure_code,
      failureReason: body.failure_reason,
      requestId: response.headers.get("x-request-id") ?? undefined,
      apiVersion: response.headers.get("x-api-version") ?? undefined
    };
  }

  async downloadOutput(outputUrl: string): Promise<LumaOutput> {
    const response = await fetch(outputUrl);
    if (!response.ok) throw await this.responseError(response);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    if (!isSupportedContentType(contentType))
      throw new LumaRequestError(
        "The provider output was not a supported image.",
        "unsupported_output",
        "rejected",
        false
      );
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
  }

  private headers(json = true) {
    return {
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
      ...(json ? { "content-type": "application/json" } : {})
    };
  }

  private async responseError(response: Response) {
    const retryable = [429, 502, 503].includes(response.status);
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
      code?: string;
    };
    const retryAfter = Number(response.headers.get("retry-after"));
    return new LumaRequestError(
      body.detail ?? "The provider rejected the request.",
      body.code ?? `http_${response.status}`,
      "rejected",
      retryable,
      response.status,
      Number.isFinite(retryAfter) ? retryAfter * 1_000 : undefined,
      response.headers.get("x-request-id") ?? undefined
    );
  }
}

function isSupportedContentType(
  value: string | null | undefined
): value is LumaOutput["contentType"] {
  return ["image/jpeg", "image/png", "image/webp"].includes(value ?? "");
}
