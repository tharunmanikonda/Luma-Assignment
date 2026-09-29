import { afterEach, describe, expect, it, vi } from "vitest";
import { withLeaseHeartbeat } from "./lease-heartbeat";

describe("generation job lease heartbeat", () => {
  afterEach(() => vi.useRealTimers());

  it("renews during long work and stops after completion", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const renew = vi.fn(async () => undefined);
    const running = withLeaseHeartbeat(() => work, renew, 1_000);

    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(renew).toHaveBeenCalledTimes(3);

    finish();
    await running;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(renew).toHaveBeenCalledTimes(3);
  });
});
