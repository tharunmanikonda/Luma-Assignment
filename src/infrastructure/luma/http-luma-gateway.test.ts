import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "./http-luma-gateway";

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
