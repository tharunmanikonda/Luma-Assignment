# Video Walkthrough

Video link: <replace with Loom, Drive, or YouTube URL after recording>

## Eight-Minute Storyboard

0:00-0:45 Present the customer problem: Maya needs launch-ready styled shots, Ellie needs phone approval, and nobody wants another ambiguous file folder.

0:45-1:30 Start from a clean seeded environment, sign in as Maya, and import `data/catalog.csv`. Show one blocked validation case and confirm import does not spend budget.

1:30-2:15 Open a product, show the original photo and imported shot idea, save or revise the scene, and point out that saving scene direction is free.

2:15-3:00 Review the generation quote and create one fake-provider candidate through the server boundary. Refresh or leave the page to show worker-backed progress persists.

3:00-3:45 Show the completed candidate, send the exact version to Ellie, and copy/open the stable review URL in a narrow phone-sized session.

3:45-4:45 As Ellie, inspect the image-first mobile review, compare original vs generated, request changes with required feedback, and show duplicate decisions are disabled.

4:45-5:45 Return as Maya, read Ellie's feedback, revise the scene, generate a replacement, send a new review, and approve it as Ellie.

5:45-6:30 Show Maya's approved state, deterministic approved-image download, catalog status CSV export, usage summary, and customer-safe failure/progress language.

6:30-7:30 Engineering walkthrough: auth boundary, services, PostgreSQL queue, fake vs real Luma adapter, object storage, idempotency, and review authorization.

7:30-8:00 Tradeoffs and next steps: deployment checklist, real Luma coordinator step, object-storage swap, monitoring, and why batch generation is deferred until single-product flow is observed.

## Release Recording Notes

- Record against the public deployment URL after `/api/health` and `/api/ready` pass.
- Keep credential entry brief and do not show secret-management screens.
- Use the fake provider for rehearsal. Use one real Luma generation only after the coordinator approves the paid verification step in `docs/release-runbook.md`.
- Show the deployed worker doing real background work by refreshing or closing Maya's page while the generation progresses.
- End the engineering segment with the release shape: persistent web process, persistent worker, PostgreSQL queue, private asset storage, and rollback path.
