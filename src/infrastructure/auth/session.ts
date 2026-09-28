import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/shared/errors";
import { auth } from "./auth";

export type ActorRole = "operator" | "approver";

export interface Actor {
  id: string;
  email: string;
  displayName: string;
  role: ActorRole;
  workspaceId: string;
}

export async function getSessionActor(): Promise<Actor | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true }
  });
  if (!session) return null;

  const { user } = session;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role as ActorRole,
    workspaceId: user.workspaceId
  };
}

export async function requireSession(): Promise<Actor> {
  const actor = await getSessionActor();
  if (!actor) {
    throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  }

  return actor;
}

export async function requireOperator(): Promise<Actor> {
  const actor = await requireSession();
  if (!hasRole(actor, "operator")) {
    throw new AppError(
      "FORBIDDEN",
      "This workspace is only available to Maya's operator account.",
      403
    );
  }

  return actor;
}

export async function requireRolePage(role: ActorRole) {
  const actor = await getSessionActor();
  if (!actor) redirect(`/sign-in?next=${role === "operator" ? "/app" : "/"}`);
  if (!hasRole(actor, role)) redirect("/access-denied");
  return actor;
}

export function hasRole(actor: Actor, role: ActorRole) {
  return actor.role === role;
}
