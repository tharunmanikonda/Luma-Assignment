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
    ).toBe("/api/assets/asset_123/content?variant=thumbnail");
  });

  it("keeps the operations overview stable when catalog filters change", async () => {
    const setupProduct = {
      ...productSummary,
      id: "product_setup_123456789012345678",
      name: "Linen Throw",
      sku: "HG-003",
      status: "needs_setup" as const,
      statusLabel: "Needs setup",
      nextAction: "Add scene direction"
    };
    const initialData = {
      products: [setupProduct, productSummary],
      counts: { all: 2, needs_setup: 1, ready_to_generate: 1 },
      nextCursor: null
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/usage") {
          return jsonResponse({
            estimatedSpend: { amount: "0.0434", currency: "USD" },
            attempts: { total: 1, successful: 1, failed: 0, active: 0 },
            approvedImages: 0,
            efficiency: { approvedPerAttempt: 0 }
          });
        }
        if (url.startsWith("/api/products/overview/priority")) {
          return jsonResponse({
            items: [setupProduct],
            total: 1,
            offset: 0,
            limit: 4
          });
        }
        if (url.startsWith("/api/products/overview/reviews")) {
          return jsonResponse({
            items: [],
            total: 0,
            offset: 0,
            limit: 4
          });
        }
        if (url.includes("status=ready_to_generate")) {
          return jsonResponse({
            products: [productSummary],
            counts: initialData.counts,
            nextCursor: null
          });
        }
        return jsonResponse(initialData);
      })
    );

    render(
      <CatalogWorkspace
        actorName="Maya"
        initialData={initialData}
        accountControl={<button>Sign out</button>}
      />
    );

    expect(
      await screen.findByRole("button", { name: /Linen Throw/ })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ready\s*1/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Linen Throw/ })).toBeTruthy()
    );
    expect(screen.getByText("$0.04")).toBeTruthy();
  });

  it("requires quote review and avoids repeat generation until the direction changes", async () => {
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
      name: "Generate image"
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
    await screen.findByText("1 generated image available");
    expect(screen.queryByRole("button", { name: "Generate image" })).toBeNull();
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).endsWith("/generation-attempts") &&
          init?.method === "POST"
      )
    ).toHaveLength(1);
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
      screen.getByRole("link", { name: "Export" }).getAttribute("href")
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
        name: "Stoneware Mug approved generated image 2"
      })
    ).toBeTruthy();
  });

  it("renders meaningful lifecycle history labels instead of raw catalog fallbacks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === `/api/products/${productSummary.id}`) {
          return jsonResponse(
            productDetail({
              history: [
                historyEvent("event_approved", "review.approved", {
                  attemptNumber: 2,
                  sceneVersion: 2
                }),
                historyEvent("event_sent", "review.created", {
                  attemptNumber: 2,
                  sceneVersion: 2
                }),
                historyEvent("event_generated", "generation.completed", {
                  attemptNumber: 2,
                  sceneVersion: 2
                }),
                historyEvent("event_requested", "generation.requested", {
                  attemptNumber: 2,
                  sceneVersion: 2
                }),
                historyEvent("event_scene", "scene_brief_saved", {
                  version: 2
                }),
                historyEvent("event_revoked", "review.revoked", {
                  attemptNumber: 1,
                  sceneVersion: 1
                }),
                historyEvent("event_imported", "catalog_product_imported", {
                  rowNumber: 24
                })
              ]
            })
          );
        }
        if (url.endsWith("/generation-attempts")) {
          return jsonResponse({ attempts: [] });
        }
        return jsonResponse(emptyProductList());
      })
    );

    renderWorkspace();
    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));

    expect(await screen.findByText("Image 2 approved by Ellie")).toBeTruthy();
    expect(screen.getByText("Image 2 sent to Ellie for review")).toBeTruthy();
    expect(screen.getByText("Image 2 generated")).toBeTruthy();
    expect(screen.getByText("Generation 2 requested/authorized")).toBeTruthy();
    expect(screen.getByText("Scene direction 2 saved")).toBeTruthy();
    expect(screen.getByText("Review for image 1 revoked")).toBeTruthy();
    expect(screen.getByText("Product imported")).toBeTruthy();
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
          name: "Stoneware Mug generated image 1"
        })
      ).getAttribute("src")
    ).toBe("/api/assets/asset_candidate/content?variant=preview");
    expect(
      screen.queryByRole("button", { name: "Review generation quote" })
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));

    expect(
      await screen.findByRole("img", {
        name: "Stoneware Mug generated image 1"
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
        name: "Stoneware Mug generated image 1"
      })
    ).toBeTruthy();
    expect(screen.getByText(/Direction 1.*Previous scene/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate image" })).toBeTruthy();
  });

  it("keeps revoked generated images visible without exposing the old review link", async () => {
    const revokedAttempt = successfulAttempt({
      review: {
        ...pendingReview(),
        state: "revoked",
        revokedAt: "2026-09-29T01:00:00.000Z"
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/generation-attempts")) {
          return jsonResponse({ attempts: [revokedAttempt] });
        }
        if (url === `/api/products/${productSummary.id}`) {
          return jsonResponse(productDetail());
        }
        return jsonResponse(emptyProductList());
      })
    );

    renderWorkspace();
    fireEvent.click(screen.getByRole("row", { name: /Stoneware Mug.*HG-002/ }));

    expect(await screen.findByText("Request revoked")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "Stoneware Mug generated image 1"
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Copy review link" })
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "Open review link" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit scene direction" })
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
        name: "Stoneware Mug generated image 2"
      })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Show previous generated image" })
    );
    expect(
      screen.getByRole("img", {
        name: "Stoneware Mug generated image 1"
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

function historyEvent(id: string, type: string, data: Record<string, unknown>) {
  return {
    id,
    type,
    data,
    actorDisplayName: type.startsWith("review.") ? "Ellie" : "Maya",
    createdAt: "2026-09-29T01:00:00.000Z"
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
