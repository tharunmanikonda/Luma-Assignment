import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/shared/env";
import type { ObjectStore, StoredObject } from "./object-store";
import { safeObjectKey } from "./object-store";

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly root = getEnv().LOCAL_OBJECT_STORE_ROOT) {}

  private resolve(key: string) {
    const safeKey = safeObjectKey(key);
    const absoluteRoot = path.resolve(this.root);
    const target = path.resolve(absoluteRoot, safeKey);

    if (!target.startsWith(absoluteRoot + path.sep)) {
      throw new Error("Unsafe object key");
    }

    return target;
  }

  async put(input: StoredObject): Promise<void> {
    const target = this.resolve(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.bytes);
    await writeFile(`${target}.content-type`, input.contentType);
  }

  async get(key: string): Promise<StoredObject | null> {
    const target = this.resolve(key);

    try {
      const [bytes, contentType] = await Promise.all([
        readFile(target),
        readFile(`${target}.content-type`, "utf8")
      ]);

      return { key, bytes, contentType };
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    await rm(target, { force: true });
    await rm(`${target}.content-type`, { force: true });
  }

  async signedReadUrl(key: string): Promise<string> {
    return `/api/assets/local/${encodeURIComponent(safeObjectKey(key))}`;
  }
}

let objectStore: LocalObjectStore | undefined;

export function getObjectStore() {
  objectStore ??= new LocalObjectStore();
  return objectStore;
}
