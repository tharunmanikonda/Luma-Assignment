import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn()
}));

vi.mock("@/modules/reviews/api", () => ({
  requireReviewActor: vi.fn(async () => ({
    id: "user_ellie",
    workspaceId: "ws_demo",
    role: "approver"
  })),
  withReviewApiErrors: (operation: () => Promise<Response>) => operation
}));

vi.mock("@/modules/reviews/asset-content", () => ({
  getAssetContentService: () => ({ read: mocks.read })
}));

import { GET } from "./route";

describe("asset content image variants", () => {
  beforeEach(async () => {
    mocks.read.mockReset();
    const bytes = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: "#c89a52"
      }
    })
      .png()
      .toBuffer();
    mocks.read.mockResolvedValue({ bytes, contentType: "image/png" });
  });

  it("returns a private cached WebP preview with a stable validator", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/assets/asset_1/content?variant=thumbnail"
      ),
      { params: Promise.resolve({ id: "asset_1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=86400, must-revalidate"
    );
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("etag")).toMatch(/^".+"$/);

    const metadata = await sharp(
      Buffer.from(await response.arrayBuffer())
    ).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 640, height: 480 });
  });

  it("honors a matching ETag without retransmitting the image", async () => {
    const first = await GET(
      new Request(
        "http://localhost/api/assets/asset_1/content?variant=preview"
      ),
      { params: Promise.resolve({ id: "asset_1" }) }
    );
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const response = await GET(
      new Request(
        "http://localhost/api/assets/asset_1/content?variant=preview",
        {
          headers: { "if-none-match": etag! }
        }
      ),
      { params: Promise.resolve({ id: "asset_1" }) }
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe(etag);
  });
});
