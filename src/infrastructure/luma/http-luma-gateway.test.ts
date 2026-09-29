import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpLumaGateway, parseRetryAfter } from "./http-luma-gateway";

afterEach(() => vi.unstubAllGlobals());

describe("Luma Agents HTTP gateway", () => {
  it("submits an inline image edit to the Agents API", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json(
          { id: "generation-1", state: "queued" },
          {
            status: 201,
            headers: {
              "x-request-id": "provider-request-1",
              "x-api-version": "2026-04-01"
            }
          }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new HttpLumaGateway("luma-api-test");
    await expect(
      gateway.submitImageEdit({
        source: { data: "aW1hZ2U=", mediaType: "image/png" },
        prompt: "Warm window light",
        userId: "ws_demo",
        idempotencyKey: "attempt-1"
      })
    ).resolves.toMatchObject({
      providerGenerationId: "generation-1",
      state: "queued",
      requestId: "provider-request-1",
      apiVersion: "2026-04-01"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://agents.lumalabs.ai/v1/generations",
      expect.objectContaining({ method: "POST" })
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      type: "image_edit",
      model: "uni-1",
      source: { data: "aW1hZ2U=", media_type: "image/png" },
      prompt: "Warm window light",
      user_id: "ws_demo"
    });
  });

  it("reads the first completed output URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "generation-1",
          state: "completed",
          output: [{ url: "https://example.test/generated.png" }]
        })
      )
    );

    await expect(
      new HttpLumaGateway("luma-api-test").getGeneration("generation-1")
    ).resolves.toMatchObject({
      state: "completed",
      outputUrl: "https://example.test/generated.png"
    });
  });
});

describe("Retry-After parsing", () => {
  it("uses the worker fallback when the header is missing", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("   ")).toBeUndefined();
  });

  it("parses numeric seconds", () => {
    expect(parseRetryAfter("2")).toBe(2_000);
    expect(parseRetryAfter("0.5")).toBe(500);
  });

  it("ignores invalid values", () => {
    expect(parseRetryAfter("later-ish")).toBeUndefined();
  });

  it("parses an HTTP date", () => {
    expect(
      parseRetryAfter(
        "Sun, 28 Sep 2026 18:00:05 GMT",
        Date.UTC(2026, 8, 28, 18)
      )
    ).toBe(5_000);
  });
});
