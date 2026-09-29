import { describe, expect, it } from "vitest";
import {
  decodeProductCursor,
  durableSourceUrl,
  encodeProductCursor
} from "./catalog-service";

describe("catalog product cursors", () => {
  it("round trips the stable timestamp and id tuple", () => {
    const tuple = {
      timestamp: "2026-09-29 04:15:12.123456+00",
      id: "product_123456789012345678901234"
    };
    const cursor = encodeProductCursor(tuple);

    expect(cursor).not.toContain(tuple.id);
    expect(decodeProductCursor(cursor)).toEqual({ v: 1, ...tuple });
  });

  it.each(["not-base64", "e30", "a".repeat(513)])(
    "rejects invalid cursor %s",
    (cursor) => {
      expect(() => decodeProductCursor(cursor)).toThrow(
        "Product cursor is invalid."
      );
    }
  );
});

describe("durable source image URLs", () => {
  it("only exposes the authenticated asset route for ready assets", () => {
    expect(durableSourceUrl("asset_123", "ready")).toBe(
      "/api/assets/asset_123/content"
    );
    expect(durableSourceUrl("asset_123", "pending")).toBeNull();
    expect(durableSourceUrl("asset_123", "failed")).toBeNull();
  });
});
