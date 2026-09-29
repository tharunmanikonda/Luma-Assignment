import { describe, expect, it } from "vitest";
import type { NormalizedCatalogRow } from "./catalog-csv";
import {
  isCatalogRowUnchanged,
  type ExistingProductSnapshot
} from "./ingestion-service";

const row: NormalizedCatalogRow = {
  sku: "HG-002",
  name: "Stoneware Mug 12oz",
  category: "Ceramics",
  colorFinish: "Sage",
  material: "Stoneware",
  priceMinor: 2800,
  currency: "USD",
  photoUrl: "https://images.example/hg-002.jpg",
  shotIdea: "morning kitchen counter, steam, warm light",
  notes: "bestseller"
};

const existing: ExistingProductSnapshot = {
  id: "product_123456789012345678901234",
  sku: row.sku,
  name: row.name,
  category: row.category,
  colorFinish: row.colorFinish,
  material: row.material,
  priceMinor: row.priceMinor,
  currency: row.currency,
  notes: row.notes,
  photoUrl: row.photoUrl,
  sceneText: row.shotIdea
};

describe("catalog row change detection", () => {
  it("treats an unchanged row as a no-op", () => {
    expect(isCatalogRowUnchanged(existing, row)).toBe(true);
  });

  it("does not treat Maya's current scene as replaceable import data", () => {
    expect(
      isCatalogRowUnchanged(
        { ...existing, sceneText: "Maya's carefully authored kitchen scene" },
        row
      )
    ).toBe(true);
  });

  it("detects a seed scene or catalog field that still needs applying", () => {
    expect(isCatalogRowUnchanged({ ...existing, sceneText: null }, row)).toBe(
      false
    );
    expect(isCatalogRowUnchanged(existing, { ...row, priceMinor: 3000 })).toBe(
      false
    );
  });
});
