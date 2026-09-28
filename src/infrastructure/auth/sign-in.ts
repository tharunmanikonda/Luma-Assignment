"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { createSession, destroySession } from "./session";
import { verifyPassword } from "./password";

export type SignInState = {
  error?: string;
};

function safeNext(value: FormDataEntryValue | null): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/app";
  }

  return value;
}

export async function signInAction(
  _state: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  const [row] = await getDb()
    .select({
      userId: users.id,
      passwordHash: accounts.passwordHash
    })
    .from(users)
    .innerJoin(accounts, eq(accounts.userId, users.id))
    .where(eq(users.email, email))
    .limit(1);

  if (
    !row?.passwordHash ||
    !(await verifyPassword(row.passwordHash, password))
  ) {
    return { error: "That email and password did not match." };
  }

  await createSession(row.userId);
  redirect(next);
}

export async function signOutAction() {
  await destroySession();
  redirect("/sign-in");
}
