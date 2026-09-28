import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const makeId = customAlphabet(alphabet, 24);

export type IdPrefix =
  | "req"
  | "ws"
  | "usr"
  | "asset"
  | "job"
  | "batch"
  | "product"
  | "scene"
  | "attempt"
  | "review"
  | "event";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${makeId()}`;
}

export function newRequestId(): string {
  return newId("req");
}
