import { describe, expect, it } from "vitest";
import type {
  ObjectStore,
  StoredObject
} from "@/infrastructure/storage/object-store";
import { AssetContentService, type AssetAccessStore } from "./asset-content";
import type { ReviewActor } from "./domain";

const maya: ReviewActor = {
  id: "user_maya",
  workspaceId: "ws_demo",
  role: "operator"
};
const ellie: ReviewActor = {
  id: "user_ellie",
  workspaceId: "ws_demo",
  role: "approver"
};
const otherApprover: ReviewActor = {
  id: "user_other",
  workspaceId: "ws_demo",
  role: "approver"
};

const assets = {
  asset_source: {
    workspaceId: "ws_demo",
    objectKey: "private/source.webp",
    mimeType: "image/webp",
    approverIds: [ellie.id]
  },
  asset_unrelated: {
    workspaceId: "ws_demo",
    objectKey: "private/unrelated.webp",
    mimeType: "image/webp",
    approverIds: [otherApprover.id]
  },
  asset_other_workspace: {
    workspaceId: "ws_other",
    objectKey: "private/other-workspace.webp",
    mimeType: "image/webp",
    approverIds: []
  }
} as const;

class MemoryAssetAccessStore implements AssetAccessStore {
  async findAuthorized(assetId: string, actor: ReviewActor) {
    const asset = assets[assetId as keyof typeof assets];
    if (!asset || asset.workspaceId !== actor.workspaceId) return null;
    if (
      actor.role === "approver" &&
      !(asset.approverIds as readonly string[]).includes(actor.id)
    ) {
      return null;
    }
    return { objectKey: asset.objectKey, mimeType: asset.mimeType };
  }
}

class MemoryObjectStore implements ObjectStore {
  objects = new Map<string, StoredObject>([
    [
      "private/source.webp",
      {
        key: "private/source.webp",
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/webp"
      }
    ]
  ]);

  async put(input: StoredObject) {
    this.objects.set(input.key, input);
  }

  async get(key: string) {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async signedReadUrl() {
    return "unused";
  }
}

function setup() {
  return new AssetContentService(
    new MemoryAssetAccessStore(),
    new MemoryObjectStore()
  );
}

describe("AssetContentService", () => {
  it("serves an asset reachable through Ellie's assigned review", async () => {
    const result = await setup().read({
      actor: ellie,
      assetId: "asset_source"
    });
    expect(result.contentType).toBe("image/webp");
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(result).not.toHaveProperty("objectKey");
  });

  it("hides the same asset from the wrong approver", async () => {
    await expect(
      setup().read({ actor: otherApprover, assetId: "asset_source" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("allows Maya to read a ready asset in her workspace", async () => {
    await expect(
      setup().read({ actor: maya, assetId: "asset_source" })
    ).resolves.toMatchObject({ contentType: "image/webp" });
  });

  it("denies unrelated and cross-workspace assets", async () => {
    await expect(
      setup().read({ actor: ellie, assetId: "asset_unrelated" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      setup().read({ actor: maya, assetId: "asset_other_workspace" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
