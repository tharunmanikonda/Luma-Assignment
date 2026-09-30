import type { ActorRole } from "./session";

export function roleHomePath(role: ActorRole) {
  return role === "approver" ? "/reviews" : "/app";
}
