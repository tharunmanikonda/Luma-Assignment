import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { AppError } from "@/shared/errors";
import { newId } from "@/shared/ids";
import { getEnv } from "@/shared/env";

export const sessionCookieName = "luma_session";
const sessionDays = 7;

export type ActorRole = "operator" | "approver";

export interface Actor {
  id: string;
  email: string;
  displayName: string;
  role: ActorRole;
  workspaceId: string;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function makeSessionToken() {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string) {
  const token = makeSessionToken();
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  const requestHeaders = await headers();

  await getDb()
    .insert(sessions)
    .values({
      id: newId("usr"),
      token,
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
      ipAddress: requestHeaders.get("x-forwarded-for"),
      userAgent: requestHeaders.get("user-agent")
    });

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  if (token) {
    await getDb()
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(token)));
  }

  cookieStore.delete(sessionCookieName);
}

export async function getSessionActor(): Promise<Actor | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;

  const [row] = await getDb()
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      workspaceId: users.workspaceId
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  return row ?? null;
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
  if (actor.role !== "operator") {
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
  if (actor.role !== role) redirect("/access-denied");
  return actor;
}
