# Assumptions

## Customer Workflow

I assumed Maya wants one operational workspace for the 40-product drop, not another creative dashboard. That led to a single product queue, explicit generation confirmation, and a CSV export that can return to the team's spreadsheet habits.

## Approval

I assumed Ellie is the only approver for this first release. Review links are stable but not secret-bearing; Ellie signs in and can only act on reviews assigned to her account.

## Budget

I assumed every image edit may spend budget once Luma accepts it. The app therefore records an attempt before external submission, requires quote confirmation, uses idempotency keys, and refuses automatic paid resubmission after uncertain provider acceptance.

## Generated Assets

I assumed generated outputs must be copied into app-controlled storage before review or download. Luma output URLs are treated as temporary provider implementation details, not final assets.

## Evaluation

I assumed the evaluator can receive private demo credentials separately from public documentation. This repository names the required environment variables but does not include credential values.

## Deployment

I assumed this task should prepare deployment verification without deploying or calling real Luma from the agent environment. Real provider credentials, deployment secrets, and `submit.sh` remain coordinator-only.
