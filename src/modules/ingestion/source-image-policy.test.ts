import { describe, expect, it } from "vitest";
import {
  assertSafeSourceUrl,
  inspectImage,
  isPublicIp
} from "./source-image-policy";

describe("source image SSRF policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.4.2",
    "192.168.1.2",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "::1",
    "fd00::1",
    "::ffff:172.16.4.2",
    "2001:db8::1"
  ])("blocks private address %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it("checks DNS results and rejects credentials", async () => {
    await expect(
      assertSafeSourceUrl("https://images.example/a.jpg", async () => [
        "8.8.8.8"
      ])
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafeSourceUrl("https://images.example/a.jpg", async () => [
        "10.0.0.4"
      ])
    ).rejects.toThrow(/private address/);
    await expect(
      assertSafeSourceUrl("https://user:pass@example.com/a.jpg", async () => [
        "8.8.8.8"
      ])
    ).rejects.toThrow(/credentials/);
  });
});

describe("image inspection", () => {
  it("reads PNG dimensions from file bytes", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(bytes.buffer).setUint32(16, 640);
    new DataView(bytes.buffer).setUint32(20, 480);

    expect(inspectImage(bytes)).toEqual({
      mimeType: "image/png",
      extension: "png",
      width: 640,
      height: 480
    });
  });

  it("reads lossy and lossless WebP dimensions", () => {
    const lossy = new Uint8Array(30);
    lossy.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
    lossy.set([0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01], 23);
    expect(inspectImage(lossy)).toMatchObject({ width: 640, height: 480 });

    const lossless = new Uint8Array(25);
    lossless.set([
      ...Buffer.from("RIFF"),
      0,
      0,
      0,
      0,
      ...Buffer.from("WEBPVP8L"),
      0,
      0,
      0,
      0,
      0x2f,
      0x7f,
      0xc1,
      0x77,
      0
    ]);
    expect(inspectImage(lossless)).toMatchObject({ width: 384, height: 480 });
  });

  it("rejects unknown and oversized media", () => {
    expect(() => inspectImage(new Uint8Array([1, 2, 3]))).toThrow(/JPEG, PNG/);
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(bytes.buffer).setUint32(16, 9000);
    new DataView(bytes.buffer).setUint32(20, 480);
    expect(() => inspectImage(bytes)).toThrow(/8,000/);
  });
});
