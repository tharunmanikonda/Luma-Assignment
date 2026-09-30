// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogWorkspace } from "./catalog-workspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CatalogWorkspace", () => {
  it("opens and closes import without replacing the dashboard context", () => {
    vi.useFakeTimers();
    render(
      <CatalogWorkspace
        actorName="Maya"
        initialData={{
          products: [],
          counts: { all: 0, needs_setup: 0, ready_to_generate: 0 },
          nextCursor: null
        }}
        accountControl={<button>Sign out</button>}
      />
    );

    expect(screen.getByRole("heading", { name: "All products" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Import CSV" })[0]);

    expect(screen.getByRole("dialog", { name: "Import catalog" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "All products" })).toBeTruthy();
    expect(
      screen.getByText(
        "Use the supplied columns. You will review every change before products are imported."
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Import catalog" })).toBeNull();
  });

  it("renders ready source images from the authenticated asset route", () => {
    vi.useFakeTimers();
    render(
      <CatalogWorkspace
        actorName="Maya"
        initialData={{
          products: [
            {
              id: "product_123456789012345678901234",
              sku: "HG-002",
              name: "Stoneware Mug",
              category: "Ceramics",
              updatedAt: "2026-09-29T00:00:00.000Z",
              sourceStatus: "ready",
              sourceUrl: "/api/assets/asset_123/content",
              sceneSummary: "Morning kitchen counter",
              status: "ready_to_generate",
              statusLabel: "Ready to generate",
              attempts: 0,
              nextAction: "Review product"
            }
          ],
          counts: { all: 1, needs_setup: 0, ready_to_generate: 1 },
          nextCursor: null
        }}
        accountControl={<button>Sign out</button>}
      />
    );

    expect(
      screen
        .getByRole("img", { name: "Stoneware Mug source product" })
        .getAttribute("src")
    ).toBe("/api/assets/asset_123/content");
  });

  it("requires quote review and uses a fresh key for another candidate", async () => {
    let generationNumber = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/products/product_123456789012345678901234") {
          return new Response(
            JSON.stringify({
              id: "product_123456789012345678901234",
              sku: "HG-002",
              name: "Stoneware Mug",
              category: "Ceramics",
              colorFinish: "White",
              material: "Stoneware",
              priceMinor: 3200,
              currency: "USD",
              notes: null,
              sourceAssetId: "asset_source",
              sourceStatus: "ready",
              sourceUrl: "/api/assets/asset_source/content",
              sourceFailure: null,
              sceneBriefId: "scene_123",
              sceneText: "Morning kitchen counter",
              sceneVersion: 1,
              statusLabel: "Ready to generate",
              readyToGenerate: true,
              approvedOutputs: [],
              history: []
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.includes("/generation-quote?")) {
          return new Response(
            JSON.stringify({
              ready: true,
              quote: {
                productId: "product_123456789012345678901234",
                sourceAssetId: "asset_source",
                sceneBriefId: "scene_123",
                estimatedAmount: "0.0434",
                currency: "USD",
                pricingVersion: "pricing-v1",
                quoteFingerprint: "f".repeat(64)
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/generation-attempts") && init?.method === "POST") {
          generationNumber += 1;
          return new Response(
            JSON.stringify({
              attempt: {
                id: `attempt_${generationNumber}`,
                attemptNumber: generationNumber,
                sceneBriefId: "scene_123",
                sceneBriefVersion: 1,
                promptText: "Morning kitchen counter",
                outputAssetId: `asset_candidate_${generationNumber}`,
                createdAt: "2026-09-29T00:15:00.000Z",
                status: "succeeded",
                customerState: {
                  label: "Ready to review",
                  terminal: true,
                  nextAction: "Review the generated image."
                },
                failure: null
              }
            }),
            { status: 202, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            products: [],
            counts: { all: 0, needs_setup: 0, ready_to_generate: 0 },
            nextCursor: null
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CatalogWorkspace
        actorName="Maya"
        initialData={{
          products: [
            {
              id: "product_123456789012345678901234",
              sku: "HG-002",
              name: "Stoneware Mug",
              category: "Ceramics",
              updatedAt: "2026-09-29T00:00:00.000Z",
              sourceStatus: "ready",
              sourceUrl: "/api/assets/asset_source/content",
              sceneSummary: "Morning kitchen counter",
              status: "ready_to_generate",
              statusLabel: "Ready to generate",
              attempts: 0,
              nextAction: "Review product"
            }
          ],
          counts: { all: 1, needs_setup: 0, ready_to_generate: 1 },
          nextCursor: null
        }}
        accountControl={<button>Sign out</button>}
      />
    );

    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));
    const reviewButton = await screen.findByRole("button", {
      name: "Review generation quote"
    });
    fireEvent.click(reviewButton);

    const confirmButton = await screen.findByRole("button", {
      name: "Confirm 0.0434 USD generation"
    });
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).endsWith("/generation-attempts") &&
          init?.method === "POST"
      )
    ).toHaveLength(0);

    fireEvent.click(confirmButton);
    await screen.findByText("1 candidate available");
    fireEvent.click(
      screen.getByRole("button", { name: "Generate another candidate" })
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Confirm 0.0434 USD generation"
      })
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            String(input).endsWith("/generation-attempts") &&
            init?.method === "POST"
        )
      ).toHaveLength(2)
    );
    const generationCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith("/generation-attempts") &&
        init?.method === "POST"
    );
    expect(generationCalls).toHaveLength(2);
    expect(
      (generationCalls[0][1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ]
    ).not.toBe(
      (generationCalls[1][1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ]
    );
  });

  it("exposes catalog export and approved image downloads to Maya", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/products/product_123456789012345678901234") {
          return new Response(
            JSON.stringify({
              id: "product_123456789012345678901234",
              sku: "HG-002",
              name: "Stoneware Mug",
              category: "Ceramics",
              colorFinish: "White",
              material: "Stoneware",
              priceMinor: 3200,
              currency: "USD",
              notes: null,
              sourceStatus: "ready",
              sourceUrl: "/api/assets/source_asset/content",
              sourceFailure: null,
              sceneText: "Morning kitchen counter",
              sceneVersion: 2,
              statusLabel: "Ready to generate",
              readyToGenerate: true,
              approvedOutputs: [
                {
                  assetId: "approved_asset",
                  attemptNumber: 2,
                  imageUrl: "/api/assets/approved_asset/content",
                  downloadUrl: "/api/assets/approved_asset/download",
                  decidedAt: "2026-09-29T00:00:00.000Z"
                }
              ],
              history: []
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            products: [],
            counts: { all: 0, needs_setup: 0, ready_to_generate: 0 },
            nextCursor: null
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    render(
      <CatalogWorkspace
        actorName="Maya"
        initialData={{
          products: [
            {
              id: "product_123456789012345678901234",
              sku: "HG-002",
              name: "Stoneware Mug",
              category: "Ceramics",
              updatedAt: "2026-09-29T00:00:00.000Z",
              sourceStatus: "ready",
              sourceUrl: "/api/assets/source_asset/content",
              sceneSummary: "Morning kitchen counter",
              status: "ready_to_generate",
              statusLabel: "Ready to generate",
              attempts: 2,
              nextAction: "Review product"
            }
          ],
          counts: { all: 1, needs_setup: 0, ready_to_generate: 1 },
          nextCursor: null
        }}
        accountControl={<button>Sign out</button>}
      />
    );

    expect(
      screen
        .getByRole("link", { name: "Export catalog status" })
        .getAttribute("href")
    ).toBe("/api/exports/catalog.csv");

    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Download approved image" })
      ).toBeTruthy()
    );
    expect(
      screen
        .getByRole("link", { name: "Download approved image" })
        .getAttribute("href")
    ).toBe("/api/assets/approved_asset/download");
    expect(
      screen.getByRole("img", {
        name: "Stoneware Mug approved image, candidate 2"
      })
    ).toBeTruthy();
  });

  it("restores a generated candidate after the product panel is closed and reopened", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/generation-attempts")) {
        return jsonResponse({ attempts: [successfulAttempt()] });
      }
      if (url === `/api/products/${productSummary.id}`) {
        return jsonResponse(productDetail());
      }
      return jsonResponse(emptyProductList());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWorkspace();
    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));

    expect(
      (
        await screen.findByRole("img", {
          name: "Stoneware Mug generated candidate 1"
        })
      ).getAttribute("src")
    ).toBe("/api/assets/asset_candidate/content");
    expect(
      screen.queryByRole("button", { name: "Review generation quote" })
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));

    expect(
      await screen.findByRole("img", {
        name: "Stoneware Mug generated candidate 1"
      })
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/generation-attempts")
      )
    ).toHaveLength(2);
  });

  it("sends one generated candidate to Ellie and exposes review actions", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith("/attempt_1/review-requests") &&
          init?.method === "POST"
        ) {
          return jsonResponse(pendingReview(), 201);
        }
        if (url.endsWith("/generation-attempts")) {
          return jsonResponse({ attempts: [successfulAttempt()] });
        }
        if (url === `/api/products/${productSummary.id}`) {
          return jsonResponse(productDetail());
        }
        return jsonResponse(emptyProductList());
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWorkspace();
    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Send to Ellie for review"
      })
    );

    expect(await screen.findByText("Waiting for Ellie")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open review link" })
        .getAttribute("href")
    ).toBe("http://localhost:3000/reviews/review_1");
    expect(screen.getByRole("button", { name: "Revoke review" })).toBeTruthy();
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/attempt_1/review-requests") &&
        init?.method === "POST"
    );
    expect(createCall?.[1]?.headers).toEqual(
      expect.objectContaining({ "Idempotency-Key": expect.any(String) })
    );
  });

  it("links requested changes to the new scene and keeps the old candidate in history", async () => {
    let saved = false;
    let sceneRequest: { basedOnReviewId?: string | null } | null = null;
    const reviewedAttempt = successfulAttempt({
      review: {
        ...pendingReview(),
        state: "changes_requested",
        feedback: "Use cooler light and less reflection.",
        decidedAt: "2026-09-29T01:00:00.000Z"
      }
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/scene-briefs") && init?.method === "POST") {
          sceneRequest = JSON.parse(String(init.body));
          saved = true;
          return jsonResponse({ id: "scene_2", version: 2 }, 201);
        }
        if (url.endsWith("/generation-attempts")) {
          return jsonResponse({ attempts: [reviewedAttempt] });
        }
        if (url === `/api/products/${productSummary.id}`) {
          return jsonResponse(
            saved
              ? productDetail({
                  sceneBriefId: "scene_2",
                  sceneVersion: 2,
                  sceneText: "Cool daylight with a quiet stone background"
                })
              : productDetail()
          );
        }
        return jsonResponse(emptyProductList());
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWorkspace();
    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Revise scene from feedback"
      })
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Cool daylight with a quiet stone background" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));

    await waitFor(() =>
      expect(sceneRequest).toEqual({
        scene: "Cool daylight with a quiet stone background",
        basedOnReviewId: "review_1"
      })
    );
    expect(
      await screen.findByRole("img", {
        name: "Stoneware Mug generated candidate 1"
      })
    ).toBeTruthy();
    expect(screen.getByText(/Scene version 1.*Previous scene/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Review generation quote" })
    ).toBeTruthy();
  });

  it("lets Maya navigate, compare, and act on any generated candidate", async () => {
    const older = successfulAttempt({
      id: "attempt_1",
      attemptNumber: 1,
      outputAssetId: "asset_candidate_1"
    });
    const newer = successfulAttempt({
      id: "attempt_2",
      attemptNumber: 2,
      outputAssetId: "asset_candidate_2",
      createdAt: "2026-09-29T00:25:00.000Z"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/generation-attempts")) {
          return jsonResponse({ attempts: [older, newer] });
        }
        if (url === `/api/products/${productSummary.id}`) {
          return jsonResponse(productDetail());
        }
        return jsonResponse(emptyProductList());
      })
    );

    renderWorkspace();
    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));

    expect(
      await screen.findByRole("img", {
        name: "Stoneware Mug generated candidate 2"
      })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Show previous candidate" })
    );
    expect(
      screen.getByRole("img", {
        name: "Stoneware Mug generated candidate 1"
      })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Compare with source" })
    );
    expect(
      screen.getAllByRole("img", { name: "Stoneware Mug source product" })
    ).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Send to Ellie for review" })
    ).toBeTruthy();
  });
});

const productSummary = {
  id: "product_123456789012345678901234",
  sku: "HG-002",
  name: "Stoneware Mug",
  category: "Ceramics",
  updatedAt: "2026-09-29T00:00:00.000Z",
  sourceStatus: "ready" as const,
  sourceUrl: "/api/assets/asset_source/content",
  sceneSummary: "Morning kitchen counter",
  status: "ready_to_generate" as const,
  statusLabel: "Ready to generate",
  attempts: 1,
  nextAction: "Review product"
};

function emptyProductList() {
  return {
    products: [],
    counts: { all: 0, needs_setup: 0, ready_to_generate: 0 },
    nextCursor: null
  };
}

function productDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: productSummary.id,
    sku: productSummary.sku,
    name: productSummary.name,
    category: productSummary.category,
    colorFinish: "White",
    material: "Stoneware",
    priceMinor: 3200,
    currency: "USD",
    notes: null,
    sourceAssetId: "asset_source",
    sourceStatus: "ready",
    sourceUrl: "/api/assets/asset_source/content",
    sourceFailure: null,
    sceneBriefId: "scene_1",
    sceneText: "Morning kitchen counter",
    sceneVersion: 1,
    statusLabel: "Ready to generate",
    readyToGenerate: true,
    approvedOutputs: [],
    history: [],
    ...overrides
  };
}

function pendingReview() {
  return {
    id: "review_1",
    generationAttemptId: "attempt_1",
    state: "pending" as const,
    feedback: null,
    createdAt: "2026-09-29T00:30:00.000Z",
    decidedAt: null,
    revokedAt: null,
    reviewUrl: "http://localhost:3000/reviews/review_1"
  };
}

function successfulAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt_1",
    attemptNumber: 1,
    sceneBriefId: "scene_1",
    sceneBriefVersion: 1,
    promptText: "Morning kitchen counter",
    outputAssetId: "asset_candidate",
    createdAt: "2026-09-29T00:15:00.000Z",
    status: "succeeded" as const,
    customerState: {
      label: "Ready to review",
      terminal: true,
      nextAction: null
    },
    failure: null,
    review: null,
    ...overrides
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function renderWorkspace() {
  return render(
    <CatalogWorkspace
      actorName="Maya"
      initialData={{
        products: [productSummary],
        counts: { all: 1, needs_setup: 0, ready_to_generate: 1 },
        nextCursor: null
      }}
      accountControl={<button>Sign out</button>}
    />
  );
}
