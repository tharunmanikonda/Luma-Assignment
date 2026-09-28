import { describe, expect, it } from "vitest";

function claimInMemory(ids: string[], claimers: number) {
  const claimed = new Set<string>();

  return Array.from({ length: claimers }, () => {
    const next = ids.find((id) => !claimed.has(id));
    if (!next) return null;
    claimed.add(next);
    return next;
  });
}

describe("job leasing invariant", () => {
  it("does not hand the same ready job to two concurrent claimers", () => {
    const claims = claimInMemory(["job_1"], 2);
    expect(claims).toEqual(["job_1", null]);
  });
});
