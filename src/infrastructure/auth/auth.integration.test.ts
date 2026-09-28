import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { authRateLimits, sessions } from "@/db/schema";
import { seedDemoUsers, upsertDemoUser } from "@/scripts/seed-demo-users";
import { resetFoundationDatabase, runDatabaseTests } from "@/test/postgres";
import { auth } from "./auth";

const baseUrl = "http://localhost:3000/api/auth";

function jsonRequest(
  path: string,
  body?: unknown,
  cookie?: string,
  ip = "127.0.0.1"
) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": ip
  });
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function cookieFrom(response: Response) {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie)
    throw new Error("Expected Better Auth to set a session cookie.");
  return setCookie.split(";", 1)[0];
}

async function signIn(email: string, password: string, ip: string) {
  return auth.handler(
    jsonRequest("/sign-in/email", { email, password }, undefined, ip)
  );
}

describe.runIf(runDatabaseTests)("Better Auth PostgreSQL integration", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedDemoUsers();
    await seedDemoUsers();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("keeps public email signup disabled", async () => {
    const response = await auth.handler(
      jsonRequest("/sign-up/email", {
        name: "Unauthorized",
        email: "new-user@example.test",
        password: "not-allowed-password"
      })
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("signs in a seeded user, reads the session, and signs out", async () => {
    const response = await signIn(
      process.env.DEMO_MAYA_EMAIL!,
      process.env.DEMO_MAYA_PASSWORD!,
      "127.0.0.2"
    );
    expect(response.status).toBe(200);
    const cookie = cookieFrom(response);

    const sessionResponse = await auth.handler(
      jsonRequest("/get-session", undefined, cookie, "127.0.0.2")
    );
    const payload = await sessionResponse.json();
    expect(payload.user).toMatchObject({
      email: process.env.DEMO_MAYA_EMAIL,
      role: "operator",
      workspaceId: "ws_demo"
    });

    const signOutResponse = await auth.handler(
      jsonRequest("/sign-out", {}, cookie, "127.0.0.2")
    );
    expect(signOutResponse.status).toBe(200);
    const revoked = await auth.handler(
      jsonRequest("/get-session", undefined, cookie, "127.0.0.2")
    );
    expect(await revoked.json()).toBeNull();
  });

  it("revokes existing sessions when a seeded password rotates", async () => {
    const email = process.env.DEMO_ELLIE_EMAIL!;
    const originalPassword = process.env.DEMO_ELLIE_PASSWORD!;
    const response = await signIn(email, originalPassword, "127.0.0.3");
    const cookie = cookieFrom(response);

    await upsertDemoUser({
      email,
      password: "rotated-local-password",
      displayName: "Ellie",
      role: "approver",
      workspaceId: "ws_demo"
    });

    const [remaining] = await getDb()
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, (await response.json()).user.id));
    expect(remaining).toBeUndefined();
    const revoked = await auth.handler(
      jsonRequest("/get-session", undefined, cookie, "127.0.0.3")
    );
    expect(await revoked.json()).toBeNull();

    await upsertDemoUser({
      email,
      password: originalPassword,
      displayName: "Ellie",
      role: "approver",
      workspaceId: "ws_demo"
    });
  });

  it("rate limits the real password sign-in route in PostgreSQL", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await signIn(
        process.env.DEMO_MAYA_EMAIL!,
        "wrong-password",
        "127.0.0.9"
      );
      statuses.push(response.status);
    }

    expect(statuses.at(-1)).toBe(429);
    const rows = await getDb().select().from(authRateLimits);
    expect(rows.some((row) => row.key.includes("/sign-in/email"))).toBe(true);
  });
});
