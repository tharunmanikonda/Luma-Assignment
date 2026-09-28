import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalObjectStore } from "./local-object-store";

describe("LocalObjectStore", () => {
  it("writes and reads private local assets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "luma-store-"));
    const store = new LocalObjectStore(root);

    await store.put({
      key: "workspaces/ws_local/test.txt",
      bytes: new TextEncoder().encode("hello"),
      contentType: "text/plain"
    });

    const object = await store.get("workspaces/ws_local/test.txt");
    expect(object?.contentType).toBe("text/plain");
    expect(new TextDecoder().decode(object?.bytes)).toBe("hello");

    await rm(root, { recursive: true, force: true });
  });

  it("rejects path traversal keys", async () => {
    const store = new LocalObjectStore("/tmp/luma-store");
    await expect(
      store.put({
        key: "../secret",
        bytes: new Uint8Array(),
        contentType: "text/plain"
      })
    ).rejects.toThrow("Unsafe object key");
  });
});
