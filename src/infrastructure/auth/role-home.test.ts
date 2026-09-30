import { describe, expect, it } from "vitest";
import { roleHomePath } from "./role-home";

describe("roleHomePath", () => {
  it("routes each evaluator to the correct workspace", () => {
    expect(roleHomePath("operator")).toBe("/app");
    expect(roleHomePath("approver")).toBe("/reviews");
  });
});
