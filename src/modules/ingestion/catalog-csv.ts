import type { IngestionRowError } from "@/modules/catalog/schema";

export const catalogHeaders = [
  "SKU",
  "Product Name",
  "Category",
  "Color / Finish",
  "Material",
  "Price",
  "Photo",
  "Shot Idea",
  "Notes"
] as const;

export type CatalogRawRow = Record<(typeof catalogHeaders)[number], string>;

export type NormalizedCatalogRow = {
  sku: string;
  name: string;
  category: string | null;
  colorFinish: string | null;
  material: string | null;
  priceMinor: number;
  currency: "USD";
  photoUrl: string;
  shotIdea: string | null;
  notes: string | null;
};

export type ParsedCatalogRow = {
  rowNumber: number;
  raw: CatalogRawRow;
  normalized: NormalizedCatalogRow | null;
  errors: IngestionRowError[];
};

export type ParsedCatalog = {
  headers: string[];
  headerErrors: string[];
  rows: ParsedCatalogRow[];
};

export function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"' && value.length === 0) {
      quoted = true;
    } else if (char === ",") {
      record.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      record.push(value);
      if (record.some((field) => field.length > 0)) records.push(record);
      record = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  record.push(value);
  if (record.some((field) => field.length > 0)) records.push(record);
  return records;
}

function textOrNull(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

export function normalizeSku(value: string) {
  return value.trim().toUpperCase();
}

export function parseUsdPrice(value: string): number | null {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function normalizeCatalogRow(raw: CatalogRawRow): {
  normalized: NormalizedCatalogRow | null;
  errors: IngestionRowError[];
} {
  const errors: IngestionRowError[] = [];
  const sku = normalizeSku(raw.SKU);
  const name = textOrNull(raw["Product Name"]);
  const priceMinor = parseUsdPrice(raw.Price);
  const photo = raw.Photo.trim();

  if (!sku) {
    errors.push({ field: "SKU", code: "REQUIRED", message: "Add a SKU." });
  }
  if (!name) {
    errors.push({
      field: "Product Name",
      code: "REQUIRED",
      message: "Add a product name."
    });
  }
  if (priceMinor === null) {
    errors.push({
      field: "Price",
      code: "INVALID_PRICE",
      message: "Use a positive USD price such as $48 or $48.00."
    });
  }

  try {
    const url = new URL(photo);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error();
  } catch {
    errors.push({
      field: "Photo",
      code: photo ? "INVALID_URL" : "REQUIRED",
      message: photo
        ? "Use a complete HTTP or HTTPS photo link."
        : "Add a product photo link."
    });
  }

  if (errors.length || !name || priceMinor === null) {
    return { normalized: null, errors };
  }

  return {
    normalized: {
      sku,
      name,
      category: textOrNull(raw.Category),
      colorFinish: textOrNull(raw["Color / Finish"]),
      material: textOrNull(raw.Material),
      priceMinor,
      currency: "USD",
      photoUrl: photo,
      shotIdea: textOrNull(raw["Shot Idea"]),
      notes: textOrNull(raw.Notes)
    },
    errors
  };
}

export function parseCatalogCsv(input: string): ParsedCatalog {
  const records = parseCsvRecords(input.replace(/^\uFEFF/, ""));
  if (!records.length) {
    return { headers: [], headerErrors: ["The CSV is empty."], rows: [] };
  }

  const headers = records[0].map((header) => header.trim());
  const missing = catalogHeaders.filter((header) => !headers.includes(header));
  const headerErrors = missing.map(
    (header) => `Missing required column: ${header}.`
  );
  if (headerErrors.length) return { headers, headerErrors, rows: [] };

  const skuCounts = new Map<string, number>();
  const rows = records.slice(1).map((record, rowIndex): ParsedCatalogRow => {
    const raw = Object.fromEntries(
      catalogHeaders.map((header) => [
        header,
        record[headers.indexOf(header)] ?? ""
      ])
    ) as CatalogRawRow;
    const result = normalizeCatalogRow(raw);
    const rowNumber = rowIndex + 2;
    const errors = [...result.errors];

    if (record.length !== headers.length) {
      errors.push({
        field: "Row",
        code: "COLUMN_COUNT",
        message: `Row ${rowNumber} has ${record.length} values; expected ${headers.length}.`
      });
    }

    const sku = normalizeSku(raw.SKU);
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    return {
      rowNumber,
      raw,
      normalized: errors.length ? null : result.normalized,
      errors
    };
  });

  for (const row of rows) {
    const sku = normalizeSku(row.raw.SKU);
    if (sku && (skuCounts.get(sku) ?? 0) > 1) {
      row.errors.push({
        field: "SKU",
        code: "DUPLICATE_SKU",
        message: `SKU ${sku} appears more than once in this file.`
      });
      row.normalized = null;
    }
  }

  return { headers, headerErrors, rows };
}
