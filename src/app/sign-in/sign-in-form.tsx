"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/infrastructure/auth/sign-in";

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(
    signInAction,
    {}
  );

  return (
    <form className="form" action={formAction}>
      <h1>Sign in</h1>
      <p className="muted">Use the evaluator account for Maya or Ellie.</p>
      <input type="hidden" name="next" value={next} />
      <label className="field">
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {state.error ? <p className="error">{state.error}</p> : null}
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
