# Platform Foundation

Task 01 owns the local platform pieces that later feature tasks consume.

## Owned Paths

- `src/db/schema/*`: core workspace, auth, asset, activity, and job schemas.
- `drizzle/0000_platform_foundation.sql`: reviewed initial PostgreSQL migration.
- `src/infrastructure/auth/*`: seeded-account sign-in, session cookies, and role helpers.
- `src/infrastructure/storage/*`: provider-neutral object store and local filesystem adapter.
- `src/worker/core/*`: durable job enqueue and leasing primitives.
- `src/shared/*`: env validation, IDs, clock, logging, HTTP error envelopes.
- `src/components/ui` is reserved for future shared UI primitives; Task 01 currently uses global tokens only.

Feature tasks may import these modules but should not change their contracts without coordinator approval.

## Local Setup

1. Copy `.env.example` to `.env.local` and keep the fake local values unless a coordinator provides deployment secrets.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Apply the reviewed migration with `npm run db:migrate`.
4. Seed the two demo users with `npm run seed:demo`. The command never prints passwords.
5. Run the app with `npm run dev`.
6. Run the long-lived worker with `npm run worker`. Stop it with `Ctrl+C`; it
   handles `SIGINT` and `SIGTERM` cleanly.

The local sign-in page is `/sign-in`. Maya uses the operator account from `.env.local`; Ellie uses the approver account.

## Authorization Contract

- Public sign-up is disabled at `/api/auth/sign-up/email`.
- Sessions are stored in PostgreSQL and referenced by an `HttpOnly`, `SameSite=Lax` cookie.
- `requireSession()` returns the signed-in actor.
- `requireOperator()` enforces Maya workspace access for server routes and services.
- `requireRolePage("operator" | "approver")` protects server-rendered role pages.
- Browser requests never supply role or workspace IDs as authority.

## Storage Contract

Use the `ObjectStore` interface for file bytes. The local adapter writes under `LOCAL_OBJECT_STORE_ROOT`, rejects path traversal keys, and returns application-relative signed-read placeholders. Later object-store providers should preserve the same `put`, `get`, `delete`, and `signedReadUrl` methods.

## Worker Contract

Use `enqueueJob()` with a logical deduplication key for durable work. Reusing a
key with a different job type or payload is rejected. Workers claim jobs through
`claimNextJob()`, which uses PostgreSQL row locking and skip-locked leasing so
concurrent workers do not receive the same ready job. Completion, lease renewal,
retry, and dead-letter transitions require the current worker's unexpired lease;
failures use bounded exponential backoff until `maxAttempts` is reached. If a
worker crashes during its final attempt, the next queue poll dead-letters the
expired job instead of leaving it permanently running.

Initial job types are already registered for CSV parsing, source ingestion, generation submission/polling/output persistence, export bundles, and a platform smoke test.

## Health Checks

- `/api/health` checks process liveness only.
- `/api/ready` checks database reachability and returns `503` when PostgreSQL is unavailable.
