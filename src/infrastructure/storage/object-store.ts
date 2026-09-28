export interface StoredObject {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface ObjectStore {
  put(input: StoredObject): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  signedReadUrl(key: string): Promise<string>;
}

export function safeObjectKey(key: string) {
  if (key.includes("..") || key.startsWith("/") || key.length < 1) {
    throw new Error("Unsafe object key");
  }

  return key;
}
