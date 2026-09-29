import type { QueryResultRow } from "pg";
import { getPool } from "@/db/client";

interface UsageRow extends QueryResultRow {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  activeAttempts: number;
  approvedImages: number;
  estimatedSpendMicros: number;
}

export async function readUsageSummary(workspaceId: string) {
  const result = await getPool().query<UsageRow>(
    `select
       count(ga.id)::int as "totalAttempts",
       count(ga.id) filter (where ga.status = 'succeeded')::int as "successfulAttempts",
       count(ga.id) filter (where ga.status = 'failed')::int as "failedAttempts",
       count(ga.id) filter (
         where ga.status in ('pending', 'submitting', 'queued', 'processing', 'storing', 'reconciliation_required')
       )::int as "activeAttempts",
       count(distinct rr.id) filter (where rr.state = 'approved')::int as "approvedImages",
       coalesce(sum(ga.estimated_price_micros), 0)::int as "estimatedSpendMicros"
     from generation_attempts ga
     left join review_requests rr on rr.generation_attempt_id = ga.id
     where ga.workspace_id = $1`,
    [workspaceId]
  );
  const row = result.rows[0] ?? {
    totalAttempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    activeAttempts: 0,
    approvedImages: 0,
    estimatedSpendMicros: 0
  };
  return {
    attempts: {
      total: row.totalAttempts,
      successful: row.successfulAttempts,
      failed: row.failedAttempts,
      active: row.activeAttempts
    },
    approvedImages: row.approvedImages,
    estimatedSpend: {
      amount: (row.estimatedSpendMicros / 1_000_000).toFixed(4),
      currency: "USD",
      basis: "authorized attempts",
      estimated: true
    },
    efficiency: {
      attemptsPerApprovedImage:
        row.approvedImages > 0
          ? Number((row.totalAttempts / row.approvedImages).toFixed(2))
          : null,
      estimatedCostPerApprovedImage:
        row.approvedImages > 0
          ? (row.estimatedSpendMicros / row.approvedImages / 1_000_000).toFixed(
              4
            )
          : null
    }
  };
}
