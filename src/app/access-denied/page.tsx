import Link from "next/link";
import { signOutAction } from "@/infrastructure/auth/sign-in";
import { roleHomePath } from "@/infrastructure/auth/role-home";
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
        {actor ? (
          <Link className="button" href={roleHomePath(actor.role)}>
            Go to{" "}
            {actor.role === "approver" ? "review inbox" : "product workspace"}
          </Link>
        ) : null}
        <form action={signOutAction}>
          <button className="button secondary" type="submit">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
