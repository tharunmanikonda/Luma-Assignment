import { isIP } from "node:net";

const blockedHostnameSuffixes = [".local", ".internal", ".localhost"];

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function blockedIpv6(address: string) {
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return blockedIpv4(mappedIpv4);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("2001:db8:")
  );
}

export function isPublicIp(address: string) {
  const version = isIP(address);
  if (version === 4) return !blockedIpv4(address);
  if (version === 6) return !blockedIpv6(address);
  return false;
}

export async function assertSafeSourceUrl(
  value: string,
  resolveAddresses: (hostname: string) => Promise<string[]>
) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Source images must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Source image links cannot contain credentials.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("Source image host is not public.");
  }

  const addresses = isIP(hostname)
    ? [hostname]
    : await resolveAddresses(hostname);
  if (!addresses.length || addresses.some((address) => !isPublicIp(address))) {
    throw new Error("Source image host resolves to a private address.");
  }

  return url;
}

export type ImageMetadata = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
};

function jpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8]
      };
    }
    offset += 2 + length;
  }
  return null;
}

export function inspectImage(bytes: Uint8Array): ImageMetadata {
  let result: ImageMetadata | null = null;

  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    String.fromCharCode(...bytes.slice(1, 4)) === "PNG"
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    result = {
      mimeType: "image/png",
      extension: "png",
      width: view.getUint32(16),
      height: view.getUint32(20)
    };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dimensions = jpegDimensions(bytes);
    if (dimensions) {
      result = { mimeType: "image/jpeg", extension: "jpg", ...dimensions };
    }
  } else if (
    bytes.length >= 25 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X" && bytes.length >= 30) {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      result = { mimeType: "image/webp", extension: "webp", width, height };
    } else if (
      chunk === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      result = { mimeType: "image/webp", extension: "webp", width, height };
    } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      const height =
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
      result = { mimeType: "image/webp", extension: "webp", width, height };
    }
  }

  if (!result)
    throw new Error("Source image must be a valid JPEG, PNG, or WebP file.");
  if (
    result.width < 1 ||
    result.height < 1 ||
    result.width > 8000 ||
    result.height > 8000
  ) {
    throw new Error(
      "Source image dimensions must be between 1 and 8,000 pixels."
    );
  }
  return result;
}
