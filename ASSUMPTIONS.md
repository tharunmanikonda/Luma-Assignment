# Assumptions

## Task 01 Boundary

I treated Task 01 as the foundation only: auth, database schema, storage, jobs, health checks, and a role-gated shell. Catalog import, product workflow, Luma generation, reviews, exports, deployment, and final challenge narrative remain outside this task.

## Auth Library Boundary

The schema is Better Auth-compatible and includes Better Auth's expected auth tables, but the implementation currently uses a small local credential/session wrapper so the foundation can be verified without depending on public sign-up, email, or provider features. Public sign-up is explicitly disabled.

## Local Development

The platform uses local PostgreSQL through Docker Compose and local filesystem object storage by default. Real Luma, object-storage, hosting, and submission credentials are not read by this task.
