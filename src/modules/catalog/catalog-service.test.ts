import { describe, expect, it } from "vitest";
import {
  clampOverviewOffset,
  decodeProductCursor,
  durableSourceUrl,
  encodeProductCursor,
  mergeProductHistory
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

describe("overview pagination", () => {
  it("moves a stale offset to the final populated page", () => {
    expect(clampOverviewOffset(3, 4, 4)).toBe(0);
    expect(clampOverviewOffset(9, 12, 4)).toBe(8);
    expect(clampOverviewOffset(0, 8, 4)).toBe(0);
  });
});

describe("product history reconstruction", () => {
  it("fills historical lifecycle gaps and collapses duplicate import noise", () => {
    const history = mergeProductHistory({
      activity: [
        {
          id: "event_import_newer",
          type: "catalog_product_imported",
          data: { rowNumber: 2 },
          actorDisplayName: "Maya",
          createdAt: new Date("2026-09-30T12:00:00Z")
        },
        {
          id: "event_import_original",
          type: "catalog_product_imported",
          data: { rowNumber: 2 },
          actorDisplayName: "Maya",
          createdAt: new Date("2026-09-29T12:00:00Z")
        }
      ],
      attempts: [
        {
          id: "attempt_1",
          attemptNumber: 1,
          sceneVersion: 1,
          status: "succeeded",
          createdBy: "maya",
          createdAt: new Date("2026-09-30T12:01:00Z"),
          completedAt: new Date("2026-09-30T12:02:00Z"),
          updatedAt: new Date("2026-09-30T12:02:00Z")
        }
      ],
      reviews: [
        {
          id: "review_1",
          attemptNumber: 1,
          sceneVersion: 1,
          state: "approved",
          createdBy: "maya",
          decisionActorId: "ellie",
          createdAt: new Date("2026-09-30T12:03:00Z"),
          decidedAt: new Date("2026-09-30T12:04:00Z"),
          revokedAt: null
        }
      ],
      userNames: new Map([
        ["maya", "Maya"],
        ["ellie", "Ellie"]
      ])
    });

    expect(history.map((event) => event.type)).toEqual([
      "review.approved",
      "review.created",
      "generation.completed",
      "generation.requested",
      "catalog_product_imported"
    ]);
    expect(
      history.filter((event) => event.type === "catalog_product_imported")
    ).toHaveLength(1);
    expect(history[0]?.actorDisplayName).toBe("Ellie");
  });

  it("enriches lifecycle events already present in the audit log", () => {
    const history = mergeProductHistory({
      activity: [
        {
          id: "event_requested",
          type: "generation.requested",
          data: { attemptId: "attempt_1" },
          actorDisplayName: null,
          createdAt: new Date("2026-09-30T12:01:00Z")
        }
      ],
      attempts: [
        {
          id: "attempt_1",
          attemptNumber: 1,
          sceneVersion: 1,
          status: "pending",
          createdBy: "maya",
          createdAt: new Date("2026-09-30T12:01:00Z"),
          completedAt: null,
          updatedAt: new Date("2026-09-30T12:01:00Z")
        }
      ],
      reviews: [],
      userNames: new Map([["maya", "Maya"]])
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe("event_requested");
    expect(history[0]?.data).toEqual({
      attemptId: "attempt_1",
      attemptNumber: 1,
      sceneVersion: 1
    });
    expect(history[0]?.actorDisplayName).toBe("Maya");
  });
});
