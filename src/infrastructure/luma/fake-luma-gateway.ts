export interface LumaGateway {
  submitImageEdit(input: {
    sourceAssetId: string;
    prompt: string;
    idempotencyKey: string;
  }): Promise<{
    providerGenerationId: string;
    state: "queued" | "processing" | "completed" | "failed";
  }>;
}

export class FakeLumaGateway implements LumaGateway {
  async submitImageEdit(input: {
    sourceAssetId: string;
    prompt: string;
    idempotencyKey: string;
  }) {
    return {
      providerGenerationId: `fake_${input.idempotencyKey}`,
      state:
        input.prompt.length > 0 && input.sourceAssetId.length > 0
          ? "queued"
          : "failed"
    } as const;
  }
}
