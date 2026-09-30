import type { PoolClient, QueryResultRow } from "pg";
import { getPool } from "@/db/client";
import { newId } from "@/shared/ids";
import type {
  ReviewDecisionInput,
  ReviewHistoryCursor,
  ReviewHistoryItem,
  ReviewRecord
} from "./domain";
import { ReviewError } from "./errors";

export interface CreateReviewCommand {
  generationAttemptId: string;
  workspaceId: string;
  createdBy: string;
  idempotencyKey: string;
}

export interface ReviewStore {
  create(command: CreateReviewCommand): Promise<ReviewRecord>;
  revoke(input: {
    reviewId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
  }): Promise<ReviewRecord>;
  decide(input: {
    reviewId: string;
    approverUserId: string;
    idempotencyKey: string;
    decision: ReviewDecisionInput;
  }): Promise<ReviewRecord>;
  findAssigned(
    reviewId: string,
    approverUserId: string
  ): Promise<ReviewRecord | null>;
  findForOperator(
    reviewId: string,
    workspaceId: string
  ): Promise<ReviewRecord | null>;
  listForOperatorProduct(
    productId: string,
    workspaceId: string
  ): Promise<ReviewRecord[]>;
  listHistory(
    productId: string,
    throughAttemptNumber: number,
    after: ReviewHistoryCursor | null,
    limit: number
  ): Promise<ReviewHistoryItem[]>;
}

interface CandidateRow extends QueryResultRow {
  generationAttemptId: string;
  workspaceId: string;
  productId: string;
  productName: string;
  sku: string;
  category: string | null;
  colorFinish: string | null;
  material: string | null;
  attemptNumber: number;
  sceneVersion: number;
  sceneDirection: string;
  sourceAssetId: string;
  candidateAssetId: string;
}

interface ApproverRow extends QueryResultRow {
  id: string;
}

const reviewColumns = `
  id,
  generation_attempt_id as "generationAttemptId",
  workspace_id as "workspaceId",
  product_id as "productId",
  approver_user_id as "approverUserId",
  created_by as "createdBy",
  state,
  feedback,
  decision_actor_id as "decisionActorId",
  create_idempotency_key as "createIdempotencyKey",
  decision_idempotency_key as "decisionIdempotencyKey",
  revoke_idempotency_key as "revokeIdempotencyKey",
  product_name as "productName",
  sku,
  category,
  color_finish as "colorFinish",
  material,
  attempt_number as "attemptNumber",
  scene_version as "sceneVersion",
  scene_direction as "sceneDirection",
  source_asset_id as "sourceAssetId",
  candidate_asset_id as "candidateAssetId",
  created_at as "createdAt",
  decided_at as "decidedAt",
  revoked_at as "revokedAt"
`;

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function firstReview(rows: QueryResultRow[]) {
  return rows[0] as ReviewRecord | undefined;
}

async function recordActivity(
  client: PoolClient,
  input: {
    workspaceId: string;
    productId: string;
    actorId: string;
    eventType: string;
    reviewId: string;
  }
) {
  await client.query(
    `insert into activity_events
      (id, workspace_id, product_id, actor_type, actor_id, event_type, event_data_json)
     values ($1, $2, $3, 'user', $4, $5, $6::jsonb)`,
    [
      newId("event"),
      input.workspaceId,
      input.productId,
      input.actorId,
      input.eventType,
      JSON.stringify({ reviewId: input.reviewId })
    ]
  );
}

export class PostgresReviewStore implements ReviewStore {
  async create(command: CreateReviewCommand) {
    return inTransaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        command.idempotencyKey
      ]);

      const sameKey = await client.query(
        `select ${reviewColumns} from review_requests
         where create_idempotency_key = $1
         for update`,
        [command.idempotencyKey]
      );
      const keyedReview = firstReview(sameKey.rows);
      if (keyedReview) {
        if (keyedReview.generationAttemptId !== command.generationAttemptId) {
          throw new ReviewError(
            "IDEMPOTENCY_CONFLICT",
            "That request key was already used for another candidate.",
            409
          );
        }
        return keyedReview;
      }

      const existing = await client.query(
        `select ${reviewColumns} from review_requests
         where generation_attempt_id = $1
         for update`,
        [command.generationAttemptId]
      );
      const existingReview = firstReview(existing.rows);
      if (existingReview) return existingReview;

      const candidateResult = await client.query<CandidateRow>(
        `select
           ga.id as "generationAttemptId",
           p.workspace_id as "workspaceId",
           p.id as "productId",
           p.name as "productName",
           p.sku,
           p.category,
           p.color_finish as "colorFinish",
           p.material,
           ga.attempt_number as "attemptNumber",
           sb.version as "sceneVersion",
           sb.text as "sceneDirection",
           ga.source_asset_id as "sourceAssetId",
           ga.output_asset_id as "candidateAssetId"
         from generation_attempts ga
         join products p on p.id = ga.product_id
         join scene_briefs sb on sb.id = ga.scene_brief_id
         where ga.id = $1
           and p.workspace_id = $2
           and ga.status = 'succeeded'
           and ga.output_asset_id is not null
         for share of ga, p, sb`,
        [command.generationAttemptId, command.workspaceId]
      );
      const candidate = candidateResult.rows[0];
      if (!candidate) {
        throw new ReviewError(
          "REVIEW_NOT_ELIGIBLE",
          "This candidate is not ready to send for review.",
          409
        );
      }

      const approverResult = await client.query<ApproverRow>(
        `select id from "user"
         where workspace_id = $1 and role = 'approver'
         order by created_at asc
         limit 1
         for share`,
        [command.workspaceId]
      );
      const approver = approverResult.rows[0];
      if (!approver) {
        throw new ReviewError(
          "REVIEW_NOT_ELIGIBLE",
          "No approver is configured for this workspace.",
          409
        );
      }

      const reviewId = newId("review");
      const inserted = await client.query(
        `insert into review_requests (
           id, generation_attempt_id, workspace_id, product_id,
           approver_user_id, created_by, create_idempotency_key,
           product_name, sku, category, color_finish, material,
           attempt_number, scene_version, scene_direction,
           source_asset_id, candidate_asset_id
         ) values (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
         )
         on conflict (generation_attempt_id) do nothing
         returning ${reviewColumns}`,
        [
          reviewId,
          candidate.generationAttemptId,
          candidate.workspaceId,
          candidate.productId,
          approver.id,
          command.createdBy,
          command.idempotencyKey,
          candidate.productName,
          candidate.sku,
          candidate.category,
          candidate.colorFinish,
          candidate.material,
          candidate.attemptNumber,
          candidate.sceneVersion,
          candidate.sceneDirection,
          candidate.sourceAssetId,
          candidate.candidateAssetId
        ]
      );
      const review =
        firstReview(inserted.rows) ??
        firstReview(
          (
            await client.query(
              `select ${reviewColumns} from review_requests
               where generation_attempt_id = $1`,
              [candidate.generationAttemptId]
            )
          ).rows
        );
      if (!review) {
        throw new ReviewError(
          "REVIEW_NOT_ELIGIBLE",
          "The review could not be created.",
          409
        );
      }
      if (inserted.rowCount === 0) return review;

      await recordActivity(client, {
        workspaceId: review.workspaceId,
        productId: review.productId,
        actorId: command.createdBy,
        eventType: "review.created",
        reviewId
      });
      return review;
    });
  }

  async revoke(input: {
    reviewId: string;
    workspaceId: string;
    actorId: string;
    idempotencyKey: string;
  }) {
    return inTransaction(async (client) => {
      const result = await client.query(
        `select ${reviewColumns} from review_requests
         where id = $1 and workspace_id = $2
         for update`,
        [input.reviewId, input.workspaceId]
      );
      const current = firstReview(result.rows);
      if (!current)
        throw new ReviewError("NOT_FOUND", "Review not found.", 404);
      if (current.state === "revoked") return current;
      if (current.state !== "pending") {
        throw new ReviewError(
          "REVIEW_ALREADY_DECIDED",
          "This review already has a final decision.",
          409
        );
      }

      const updated = await client.query(
        `update review_requests
         set state = 'revoked', revoked_at = now(), revoke_idempotency_key = $2
         where id = $1 and state = 'pending'
         returning ${reviewColumns}`,
        [input.reviewId, input.idempotencyKey]
      );
      const review = firstReview(updated.rows)!;
      await recordActivity(client, {
        workspaceId: review.workspaceId,
        productId: review.productId,
        actorId: input.actorId,
        eventType: "review.revoked",
        reviewId: review.id
      });
      return review;
    });
  }

  async decide(input: {
    reviewId: string;
    approverUserId: string;
    idempotencyKey: string;
    decision: ReviewDecisionInput;
  }) {
    return inTransaction(async (client) => {
      const result = await client.query(
        `select ${reviewColumns} from review_requests
         where id = $1 and approver_user_id = $2
         for update`,
        [input.reviewId, input.approverUserId]
      );
      const current = firstReview(result.rows);
      if (!current)
        throw new ReviewError("NOT_FOUND", "Review unavailable.", 404);

      const feedback =
        input.decision.decision === "changes_requested"
          ? input.decision.feedback.trim()
          : null;
      if (current.state !== "pending") {
        const repeated =
          current.state === input.decision.decision &&
          (current.state !== "changes_requested" ||
            current.feedback === feedback);
        if (repeated) return current;
        throw new ReviewError(
          "REVIEW_ALREADY_DECIDED",
          "This review already has a final decision.",
          409
        );
      }

      const updated = await client.query(
        `update review_requests
         set state = $2,
             feedback = $3,
             decision_actor_id = $4,
             decision_idempotency_key = $5,
             decided_at = now()
         where id = $1 and state = 'pending'
         returning ${reviewColumns}`,
        [
          input.reviewId,
          input.decision.decision,
          feedback,
          input.approverUserId,
          input.idempotencyKey
        ]
      );
      const review = firstReview(updated.rows)!;
      await recordActivity(client, {
        workspaceId: review.workspaceId,
        productId: review.productId,
        actorId: input.approverUserId,
        eventType:
          review.state === "approved"
            ? "review.approved"
            : "review.changes_requested",
        reviewId: review.id
      });
      return review;
    });
  }

  async findAssigned(reviewId: string, approverUserId: string) {
    const result = await getPool().query(
      `select ${reviewColumns} from review_requests
       where id = $1 and approver_user_id = $2`,
      [reviewId, approverUserId]
    );
    return firstReview(result.rows) ?? null;
  }

  async findForOperator(reviewId: string, workspaceId: string) {
    const result = await getPool().query(
      `select ${reviewColumns} from review_requests
       where id = $1 and workspace_id = $2`,
      [reviewId, workspaceId]
    );
    return firstReview(result.rows) ?? null;
  }

  async listForOperatorProduct(productId: string, workspaceId: string) {
    const result = await getPool().query(
      `select ${reviewColumns} from review_requests
       where product_id = $1 and workspace_id = $2
       order by attempt_number asc, id asc`,
      [productId, workspaceId]
    );
    return result.rows as ReviewRecord[];
  }

  async listHistory(
    productId: string,
    throughAttemptNumber: number,
    after: ReviewHistoryCursor | null,
    limit: number
  ) {
    const result = await getPool().query(
      `select
         rr.id as "reviewId",
         ga.id as "attemptId",
         ga.attempt_number as "attemptNumber",
         ga.output_asset_id as "candidateAssetId",
         sb.text as "sceneDirection",
         sb.version as "sceneVersion",
         coalesce(rr.state::text, 'not_sent') as state,
         rr.feedback,
         rr.decided_at as "decidedAt",
         ga.created_at as "createdAt"
       from generation_attempts ga
       join scene_briefs sb on sb.id = ga.scene_brief_id
       left join review_requests rr on rr.generation_attempt_id = ga.id
       where ga.product_id = $1
         and ga.attempt_number < $2
         and (
           $3::integer is null
           or (ga.attempt_number, ga.id) > ($3::integer, $4::text)
         )
         and ga.status = 'succeeded'
         and ga.output_asset_id is not null
       order by ga.attempt_number asc, ga.id asc
       limit $5`,
      [
        productId,
        throughAttemptNumber,
        after?.attemptNumber ?? null,
        after?.attemptId ?? null,
        limit
      ]
    );
    return result.rows as ReviewHistoryItem[];
  }
}
