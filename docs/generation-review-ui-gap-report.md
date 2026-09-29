# Generation and Review UI Gap Report

## Goal

Complete the operator workflow from generation through review without losing state when a product panel is closed or reopened.

The intended flow is:

1. Maya saves a scene brief and explicitly confirms a priced generation.
2. The worker generates and stores the candidate image.
3. Maya sees the generated image in the product panel.
4. Maya sends that candidate to Ellie for review.
5. Maya can see the review link and current review state.
6. Ellie opens the assigned review, compares source and candidate, and approves or requests changes.
7. Maya sees Ellie's decision. If changes are requested, Maya creates a new scene revision linked to that review and may explicitly generate again.
8. Closing and reopening the product panel restores the current candidate, generation state, review state, and relevant history.

## Current State

### Already implemented

- Scene brief creation and revision persistence.
- Explicit generation quote and confirmation.
- Generation attempts, polling, worker processing, and output asset persistence.
- Authenticated asset delivery through `/api/assets/{assetId}/content`.
- Review request creation from a successful generation attempt.
- Automatic assignment to the workspace approver.
- Ellie review page with source/candidate comparison, approve, request changes, and history.
- Review decision and pending-review revocation endpoints.
- `basedOnReviewId` support when saving a scene revision.
- A Maya review status component with pending/approved/changes-requested/revoked states.

### Missing or disconnected

1. The product panel does not load existing generation attempts when opened.
2. Generation state exists only in transient React state, so closing the panel loses it.
3. A successful output image is not rendered for Maya even though `outputAssetId` is returned.
4. There is no Maya action to send a successful candidate to Ellie.
5. The existing Maya review status component is not connected to the catalog workflow.
6. Maya cannot open/copy the review link or revoke a pending request from the product panel.
7. Ellie's decision is not refreshed or displayed in Maya's panel.
8. A requested-changes revision is saved with `basedOnReviewId: null`, breaking feedback traceability.
9. Product detail returns approved outputs only and hardcodes attempt/count summaries instead of exposing useful current workflow state.
10. The success copy can continue to imply that the worker is processing after the attempt has completed.
11. A scene change has no explicit UI distinction between the prior candidate and the new current scene.
12. Reopening an unchanged scene can show a fresh quote path and encourage an accidental duplicate paid attempt.

## Required Product Behavior

### Hydration and identity

- On panel open, load the product, its scene brief, generation attempts, and associated review state.
- Treat the current scene brief ID/version as the identity of the editable prompt.
- Select the newest successful attempt for the current scene as the current candidate.
- Preserve older attempts as history. Do not hide or delete a prior candidate after the scene changes.
- Label candidates from older scene versions as previous/stale versions.

### Generation states

- No current scene: show scene editing and save action.
- Current scene with no attempt: show quote review and explicit confirmation.
- Queued or running attempt: show progress and poll persisted state.
- Successful attempt: show the generated image and review actions.
- Failed attempt: show a safe error and a deliberate path to obtain a new quote.
- Never create an attempt from a quote request, panel open, refresh, or poll.
- Do not automatically call the real Luma API from UI hydration or tests.

### Prompt changes

- Editing or saving a new scene revision must not remove the previous image.
- After a new revision is saved, show the prior candidate in history and show the quote/generate action for the new current scene.
- Invalidate any quote that belongs to a previous scene revision.
- Only explicit confirmation may create the next paid generation attempt.

### Candidate review

- Render the candidate from `/api/assets/{outputAssetId}/content` with useful loading, missing, and error states.
- For a successful candidate with no review request, show a clear `Send to Ellie` action.
- Review creation must be idempotent and should display the returned review URL/state.
- For a pending review, show assignee, status, review link, and revoke action.
- For an approved review, show the approved state and keep the image accessible.
- For requested changes, show Ellie's note and a clear revision action.
- A revision created from requested changes must send that review's ID as `basedOnReviewId`.
- Refresh or poll the review state so Maya sees Ellie's decision without needing a new generation.

### Reopen behavior

- Reopening an unchanged product with a successful current-scene candidate must show the image, not reset to the quote screen.
- Reopening while a generation is active must resume polling the persisted attempt.
- Reopening with a pending or completed review must restore its state and actions.
- Reopening after a scene revision must show both the prior candidate/history and the new scene's generation action.

## Implementation Guidance

- Reuse the existing generation-attempt list/detail APIs and review endpoints before expanding service responses.
- Extend presenters or API responses only where the UI cannot obtain the required review identity/status efficiently.
- Connect or adapt `MayaReviewStatus` instead of creating a competing review-state component.
- Keep role authorization enforced by the server. Maya actions must not make Ellie-only decisions available.
- Keep visual treatment consistent with the existing compact catalog workspace; avoid adding a separate dashboard or marketing-style page.
- Use accessible image alt text, buttons, status text, focus behavior, and loading/error feedback.
- Avoid exposing provider URLs or API secrets to the browser.

## Acceptance Tests

1. Opening a product with an existing successful attempt renders its candidate image from the authenticated asset route.
2. Closing and reopening that product restores the same candidate and does not present generation as if nothing happened.
3. A current scene without an attempt shows a quote; requesting the quote creates no attempt.
4. Only explicit confirmation creates a generation attempt, with an idempotency key.
5. A queued/running attempt resumes polling after reopen and transitions to its terminal state.
6. `Send to Ellie` creates one review request and restores the same request if retried.
7. Maya can open/copy the returned review URL and see the pending review state.
8. Ellie's approve or request-changes decision appears in Maya's panel after refresh/poll.
9. Maya can revoke a pending review and sees the revoked state.
10. Creating a revision from requested changes sends the correct `basedOnReviewId`.
11. After a scene change, the old candidate remains visible in history while the new scene shows a new quote path.
12. Failed generation, missing output, unauthorized access, and API failures have usable error states.
13. Existing Ellie review behavior and delivery workflow integration tests continue to pass.

## Verification Rules

- Use the fake provider for all automated and manual implementation verification.
- Do not read, print, overwrite, or commit `.env.local` or the real Luma API key.
- Do not trigger a real generation while implementing or testing this work.
- Run formatting, lint, typecheck, focused UI/API tests, and the full test suite.
- Verify the key reopen and prompt-change flows in the local browser at desktop and mobile widths.

## Definition of Done

The work is complete when Maya can generate, see, send, track, revise, and revisit a candidate image from one coherent product-panel workflow; Ellie can perform the existing review; and all state survives panel close/reopen and page refresh without accidental paid generations.
