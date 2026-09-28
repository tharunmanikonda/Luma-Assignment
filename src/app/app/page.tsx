import { signOutAction } from "@/infrastructure/auth/sign-in";
import { requireRolePage } from "@/infrastructure/auth/session";

export default async function OperatorAppPage() {
  const actor = await requireRolePage("operator");

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">Maya Home Goods</div>
          <div className="muted">Signed in as {actor.displayName}</div>
        </div>
        <form action={signOutAction}>
          <button className="button secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <section className="grid" aria-label="Platform foundation status">
        <article className="card">
          <h2>Catalog workspace</h2>
          <p className="muted">
            Ready for Task 02 to add CSV import without changing auth or app
            shell.
          </p>
        </article>
        <article className="card">
          <h2>Private assets</h2>
          <p className="muted">
            Local object storage is configured behind a provider-neutral
            interface.
          </p>
        </article>
        <article className="card">
          <h2>Durable worker</h2>
          <p className="muted">
            PostgreSQL jobs can be enqueued, leased, completed, and retried.
          </p>
        </article>
      </section>
    </main>
  );
}
