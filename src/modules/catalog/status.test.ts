import { describe, expect, it } from "vitest";
import { deriveCatalogStatus } from "./status";

describe("catalog status", () => {
  it("is derived from source readiness and scene direction", () => {
    expect(
      deriveCatalogStatus({ sourceStatus: "ready", sceneText: "Kitchen" })
    ).toBe("ready_to_generate");
    expect(
      deriveCatalogStatus({ sourceStatus: "pending", sceneText: "Kitchen" })
    ).toBe("needs_setup");
    expect(deriveCatalogStatus({ sourceStatus: "ready", sceneText: " " })).toBe(
      "needs_setup"
    );
  });
});
