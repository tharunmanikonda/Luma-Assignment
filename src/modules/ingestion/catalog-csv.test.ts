import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCatalogCsv, parseUsdPrice } from "./catalog-csv";

describe("catalog CSV", () => {
  it("accepts the supplied 40-row catalog without preprocessing", async () => {
    const csv = await readFile("data/catalog.csv", "utf8");
    const parsed = parseCatalogCsv(csv);

    expect(parsed.headerErrors).toEqual([]);
    expect(parsed.rows).toHaveLength(40);
    expect(parsed.rows.filter((row) => row.errors.length)).toHaveLength(0);
    expect(parsed.rows[1].normalized).toMatchObject({
      sku: "HG-002",
      priceMinor: 2800,
      shotIdea: "morning kitchen counter, steam, warm light"
    });
  });

  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    const csv = [
      "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
      'HG-1,"Vase, Large",Decor,Blue,Clay,$12.50,https://example.com/a.jpg,"Shelf with ""art""","Line one\nLine two"'
    ].join("\n");
    const [row] = parseCatalogCsv(csv).rows;

    expect(row.raw["Product Name"]).toBe("Vase, Large");
    expect(row.raw["Shot Idea"]).toBe('Shelf with "art"');
    expect(row.raw.Notes).toBe("Line one\nLine two");
  });

  it("reports missing headers and row-level malformed data", () => {
    const missing = parseCatalogCsv("SKU,Product Name\nHG-1,Vase");
    expect(missing.headerErrors).toContain("Missing required column: Photo.");

    const malformed = parseCatalogCsv(
      [
        "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
        "HG-1,Vase,Decor,Blue,Clay,free,ftp://example.com/a.jpg,Scene,Note,EXTRA"
      ].join("\n")
    );
    expect(malformed.rows[0].errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["INVALID_PRICE", "INVALID_URL", "COLUMN_COUNT"])
    );
  });

  it("blocks every occurrence of a duplicate normalized SKU", () => {
    const parsed = parseCatalogCsv(
      [
        "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
        "hg-1,Vase,Decor,Blue,Clay,$12,https://example.com/a.jpg,,",
        " HG-1 ,Vase 2,Decor,Blue,Clay,$14,https://example.com/b.jpg,,"
      ].join("\n")
    );

    expect(parsed.rows.every((row) => row.normalized === null)).toBe(true);
    expect(
      parsed.rows.every((row) => row.errors[0].code === "DUPLICATE_SKU")
    ).toBe(true);
  });

  it("stores prices as integer cents", () => {
    expect(parseUsdPrice("$48")).toBe(4800);
    expect(parseUsdPrice("1,249.95")).toBe(124995);
    expect(parseUsdPrice("12.999")).toBeNull();
    expect(parseUsdPrice("free")).toBeNull();
  });
});
