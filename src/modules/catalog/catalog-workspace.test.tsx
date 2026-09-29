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

  it("requires quote review before explicitly confirming generation", async () => {
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
          return new Response(
            JSON.stringify({
              attempt: {
                id: "attempt_123",
                status: "queued",
                customerState: {
                  label: "Waiting",
                  terminal: false,
                  nextAction: null
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
    await waitFor(() => expect(screen.getByText("Waiting")).toBeTruthy());
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
});
