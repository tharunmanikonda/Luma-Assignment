# Approach

## What Task 01 Built

This commit establishes a modular Next.js and TypeScript platform with PostgreSQL persistence, reviewed Drizzle migrations, seeded Maya and Ellie accounts, database-backed sessions, local private asset storage, a durable PostgreSQL job queue, health/readiness endpoints, and a restrained role-gated app shell.

## Key Tradeoffs

- Kept authentication small and server-owned so feature work can rely on stable actor contexts immediately.
- Used PostgreSQL for the queue to avoid adding Redis or another runtime before the workflow needs it.
- Used local filesystem storage behind an interface so later deployment can swap in S3-compatible storage without touching product services.
- Left customer workflow screens intentionally plain because Tasks 02-05 own import, generation, review, and final dashboard behavior.

## Scope Ledger

In: platform commands, environment schema, migration, auth/session helpers, seed command, storage adapter, jobs leasing, logging/error primitives, health checks, and foundation docs.

Out: CSV import, product records, scene briefs, Luma calls, reviews, exports, real deployment, and final submission materials.

Next: Task 02 should add catalog import and product persistence using the existing workspace, asset, job, and authorization helpers.
