# Release Runbook

This document prepares the accepted take-home for deployment without exposing secrets, making paid provider calls, or submitting the challenge.

## Recommended Deployment Shape

Use one small Docker host for the take-home release:

- `web`: persistent Next.js server process, exposed through HTTPS.
- `worker`: long-running background process from the same image.
- `postgres`: PostgreSQL 16, either the compose service for the shortest demo path or a managed PostgreSQL instance for a sturdier release.
- `object-store`: private mounted volume shared by `web` and `worker` at `LOCAL_OBJECT_STORE_ROOT`.

This shape matches the implemented architecture today. It keeps the worker alive, lets `/api/ready` check PostgreSQL, and keeps source/generated images private while both processes can read and write the same durable bytes.

The fastest public path is a small VPS running Docker Compose plus a reverse proxy such as Caddy. Vercel is not the right first host because the worker must be persistent. Railway, Render, or Fly can work if configured with a persistent worker and a shared durable asset store; most PaaS setups would be better after adding an S3/R2 object-store adapter instead of relying on a shared filesystem.

## Production Package

The same `Dockerfile` builds the web and worker runtime. Start the web process with:

```bash
npm run start
```

Start the worker process with:

```bash
npm run worker
```

`docker-compose.production.example.yml` demonstrates the two-process layout and a shared private object-store volume. Copy it to deployment infrastructure rather than committing environment values.

## Environment Checklist

Configure these names in the deployment secret store or private environment file. Do not commit values, print values, or paste values into task logs.

Required runtime names:

- `NODE_ENV`
- `APP_ORIGIN`
- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `LOCAL_OBJECT_STORE_ROOT`
- `WORKER_ID`
- `LOG_LEVEL`
- `DEMO_WORKSPACE_NAME`
- `DEMO_MAYA_EMAIL`
- `DEMO_MAYA_PASSWORD`
- `DEMO_ELLIE_EMAIL`
- `DEMO_ELLIE_PASSWORD`
- `DEMO_GENERATION_BUDGET_CENTS`
- `LUMA_PROVIDER`
- `LUMA_API_KEY`

Local production smoke should set `LUMA_PROVIDER=fake` and leave `LUMA_API_KEY` unset. Controlled real-provider verification should set `LUMA_PROVIDER=real` and provide `LUMA_API_KEY` only through the host secret mechanism.

## First Deploy

1. Provision the host, domain, TLS, PostgreSQL, and private asset storage.
2. Build the image and start PostgreSQL.
3. Run database migrations once before starting or restarting the worker:

   ```bash
   npm run db:migrate
   ```

4. Seed evaluator accounts without printing credentials:

   ```bash
   npm run seed:demo
   ```

5. Start or restart `web` and `worker` from the same image. If the worker was started before migrations, restart it after migrations are applied.
6. Confirm liveness and readiness:

   ```bash
   curl --fail https://<deployment-host>/api/health
   curl --fail https://<deployment-host>/api/ready
   ```

7. Sign in as Maya and Ellie using credentials shared out-of-band.
8. Import `data/catalog.csv`, commit the valid rows, and wait for source image ingestion.

## Fake-Service Verification

Use this before any real Luma key is connected.

1. Set `LUMA_PROVIDER=fake`.
2. Use a clean PostgreSQL database and an empty private object-store volume.
3. Run migrations and seed demo users.
4. Start `web` and `worker`.
5. Verify:

- `/api/health` returns `ok: true`.
- `/api/ready` returns `ok: true` and `database: ready`.
- Maya can import `data/catalog.csv` and see committed products.
- Source images progress to ready or show customer-safe failure states.
- Maya can save scene direction for a product with a ready source image.
- Maya can confirm one generation quote.
- The worker completes the fake generation and persists one private output asset.
- Maya can send the candidate to Ellie.
- Ellie can request changes from a mobile-width browser.
- Maya can revise, send a replacement, and Ellie can approve.
- Maya can download the approved asset and export catalog status.

## Controlled Real-Luma Verification

This is coordinator-only and intentionally manual. It should create at most one paid generation.

Preflight with no paid call:

1. Confirm the deployment logs do not include request headers, bearer tokens, signed URLs, or raw provider payload secrets.
2. Confirm `LUMA_PROVIDER=real` is set only in the deployment secret store.
3. Confirm `LUMA_API_KEY` exists in the secret store without printing it.
4. Sign in as Maya.
5. Choose one product whose source image is ready and whose shot idea is safe to generate.
6. Save the scene direction.
7. Open the quote confirmation and stop before confirming.
8. Confirm the estimated cost and that the demo budget ceiling is acceptable.

Paid step, only after explicit coordinator approval:

1. Confirm the quote exactly once.
2. Watch the worker until the attempt is `succeeded`, `failed`, or `reconciliation_required`.
3. If succeeded, verify the output was copied into private app storage and the provider output URL is no longer needed for review/download.
4. Send the candidate to Ellie, approve it, download it, and export status.

Abort conditions:

- Any secret appears in logs, browser-visible payloads, screenshots, or docs.
- The worker cannot determine whether Luma accepted the request.
- Output persistence fails after provider completion.
- The budget ceiling or expected external cost is unclear.

## Public End-to-End Checklist

- Fresh browser session loads the HTTPS deployment.
- Maya sign-in works from the public URL.
- Ellie sign-in works from a separate mobile-width session.
- CSV upload handles invalid rows before commit.
- Valid rows commit without spending generation budget.
- Source image readiness survives refresh.
- Scene editing is free and persists.
- Generation quote displays before any attempt is created.
- Repeated quote-confirm clicks do not create duplicate paid attempts.
- Worker progress survives web refresh and browser closure.
- Maya can inspect a completed candidate and create a review request.
- Ellie can inspect the image-first review page on mobile.
- Ellie must provide feedback when requesting changes.
- Duplicate Ellie decisions are rejected.
- Maya can revise with prior feedback visible.
- Approved image download is deterministic and authorized.
- Catalog status export contains approved image URLs and workflow status.
- Cross-role and cross-workspace protected routes deny access.
- `/api/health` and `/api/ready` stay green after the workflow.

## Rollback Checklist

1. Stop accepting new user actions by disabling public ingress or putting the reverse proxy in maintenance mode.
2. Keep the database and object-store volumes intact.
3. Record the deployed image tag and migration version.
4. If only the app image changed, redeploy the previous image for both `web` and `worker`.
5. If a migration changed, restore the latest verified PostgreSQL backup and matching object-store snapshot together.
6. Run `/api/ready`, sign in as Maya, and verify the last approved download still resolves.
7. Re-enable ingress only after the worker is running and no jobs are stuck in an unsafe state.

## Video Preparation

Record against the public deployment, not localhost. Use fake-provider mode for the full rehearsal and the coordinator-approved single real generation only if credits and secrets are ready.

Before recording:

- Reset to a clean seeded workspace or clearly explain the existing state.
- Keep credentials out of the frame until entered, and never show secret-management screens.
- Open desktop Maya and mobile-width Ellie sessions.
- Prepare one source-ready product and one product with a validation issue.
- Prepare `APPROACH.md`, `ASSUMPTIONS.md`, and this runbook for the engineering segment.

The shortest evaluator story is: import the catalog, show source readiness, confirm one budgeted generation, send to Ellie, request changes, revise, approve, download, export, then explain why the architecture has a persistent worker, PostgreSQL queue, and private asset storage.
