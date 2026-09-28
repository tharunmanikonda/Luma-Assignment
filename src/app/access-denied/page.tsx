import { signOutAction } from "@/infrastructure/auth/sign-in";
import { getSessionActor } from "@/infrastructure/auth/session";

export default async function AccessDeniedPage() {
  const actor = await getSessionActor();

  return (
    <main className="shell">
      <section className="card">
        <h1>Access denied</h1>
        <p className="muted">
          {actor?.displayName ?? "This account"} is signed in, but this area
          belongs to a different role.
        </p>
        <form action={signOutAction}>
          <button className="button" type="submit">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
