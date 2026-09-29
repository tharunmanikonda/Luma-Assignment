# Approach

## What I Built

This is a protected production workflow for Maya and Ellie: Maya imports the catalog, prepares scene direction, authorizes one paid image at a time, tracks worker-backed generation, sends an immutable candidate to Ellie, receives mobile feedback, revises, and exports the final status with deterministic approved-image downloads.

The implementation is intentionally not a generic asset manager. It is shaped around the team's current handoff problem: keep the sheet as the source of incoming product requests, make every budget-spending step explicit, and make Ellie's approval possible from a phone without installing anything.

## How To Run Locally

```bash
npm install
cp .env.example .env.local
docker compose up -d postgres
npm run db:migrate
npm run seed:demo
npm run dev
```

Run the worker in a second terminal:

```bash
npm run worker
```

Use the demo account environment variables you set locally. Do not commit or print real credentials.

## Key Decisions

- Authenticated review links: the URL identifies the review, but only Ellie's account can decide it. This avoids long-lived bearer links.
- One candidate per confirmation: every generation cost is tied to Maya's explicit quote review and idempotency key.
- Durable assets before review: generated output is copied into application-controlled storage before Maya can send it to Ellie.
- PostgreSQL-backed queue: enough reliability for this take-home without adding Redis, while still supporting worker restart and lease recovery.
- CSV status export: Maya's team already trusts spreadsheets, so the final handoff back to the team is a spreadsheet-safe CSV plus stable app download links.

## Road Not Taken

The strongest alternate design was a Slack-first workflow: import the sheet, post candidates into a Slack approval channel, and treat emoji/thread replies as decisions. That would match how the team currently improvises, but it would recreate the exact ambiguity that caused the wrong image to ship. I chose an authenticated approval page because it gives Ellie the same low-friction phone path while making the final decision, filename, and product binding durable.

## Scope Ledger

In:

- Seeded Maya and Ellie authentication.
- CSV upload, validation preview, commit, and re-import behavior.
- Product workspace, source asset ingestion, scene direction, quotes, generation attempts, worker lifecycle, fake Luma gateway, review links, Ellie decision flow, revision context, approved downloads, usage summary, and catalog status export.

Out:

- Public signup, team administration, notifications, batch generation, direct storefront publishing, exact provider billing reconciliation, and real deployment from this task chat.

Next:

- Swap local object storage for a deployed S3-compatible store.
- Add provider webhooks if Luma exposes them for this lifecycle.
- Add batch generation only after the single-candidate path is monitored in real use.

## Unit Economics

The app records the price snapshot for every authorized attempt and labels usage as estimated until real billing evidence is reconciled. With the current first-release policy, one approved image costs:

- dollars: authorized attempt count multiplied by the configured per-attempt estimate;
- minutes: Luma queue time plus polling/storage time, with Maya and Ellie free to leave the browser while the worker continues.

At 10x the catalog, the first pressure points are generation budget, worker throughput, and asset storage. The architecture already isolates those concerns behind the generation repository, job queue, and object-store interface, so scaling should mean more workers and durable storage rather than rewriting the workflow.

## Deployment Checklist

- Apply the reviewed Drizzle migration to a clean PostgreSQL database.
- Set server-only auth, database, object-storage, Luma, and demo account environment variables.
- Run the seed command without printing credentials.
- Start the web process and at least one worker process.
- Verify `/api/health` and `/api/ready`.
- Import `data/catalog.csv`, create one fake-provider generation, request Ellie changes, revise, approve, download the approved image, and export catalog status.
- Real Luma credentials, public deployment, and final submission are coordinator-only steps.
