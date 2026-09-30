import { describe, expect, it } from "vitest";
import { hasRole, type Actor } from "./session";
import { safeNext } from "./safe-next";

const maya: Actor = {
  id: "usr_maya",
  email: "maya@example.test",
  displayName: "Maya",
  role: "operator",
  workspaceId: "ws_demo"
};

describe("authorization helpers", () => {
  it.each([
    ["/app", "/app"],
    ["/reviews/rev_1?view=proof", "/reviews/rev_1?view=proof"],
    ["https://attacker.example", "/"],
    ["//attacker.example", "/"],
    ["app", "/"],
    [null, "/"]
  ])("normalizes return path %s", (value, expected) => {
    expect(safeNext(value)).toBe(expected);
  });

  it("denies a signed-in actor with the wrong role", () => {
    expect(hasRole(maya, "operator")).toBe(true);
    expect(hasRole(maya, "approver")).toBe(false);
  });
});
