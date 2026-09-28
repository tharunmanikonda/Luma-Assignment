"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { safeNext } from "./safe-next";

export type SignInState = {
  error?: string;
};

export async function signInAction(
  _state: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers()
    });
  } catch (error) {
    if (!(error instanceof APIError)) throw error;
    return { error: "That email and password did not match." };
  }
  redirect(next);
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
