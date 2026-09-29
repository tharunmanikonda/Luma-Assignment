// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogWorkspace } from "./catalog-workspace";

afterEach(() => {
  cleanup();
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
});
