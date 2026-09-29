import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getPool } from "@/db/client";
import { PostgresReviewStore } from "./store";

const runReviewDatabaseTests = process.env.RUN_DATABASE_TESTS === "true";

describe.runIf(runReviewDatabaseTests)(
  "PostgreSQL review decision concurrency",
  () => {
    beforeEach(async () => {
      const pool = getPool();
      await pool.query(
        `delete from activity_events where workspace_id = 'ws_review_test'`
      );
      await pool.query(
        `delete from review_requests where workspace_id = 'ws_review_test'`
      );
      await pool.query(
        `delete from generation_attempts where workspace_id = 'ws_review_test'`
      );
      await pool.query(
        `delete from scene_briefs where product_id = 'product_review_test'`
      );
      await pool.query(
        `delete from products where workspace_id = 'ws_review_test'`
      );
      await pool.query(
        `delete from assets where workspace_id = 'ws_review_test'`
      );
      await pool.query(
        `delete from "user" where workspace_id = 'ws_review_test'`
      );
      await pool.query(`delete from workspaces where id = 'ws_review_test'`);

      await pool.query(
        `insert into workspaces (id, name) values ('ws_review_test', 'Review Test')`
      );
      await pool.query(
        `insert into "user"
          (id, name, email, email_verified, display_name, role, workspace_id)
         values
          ('usr_review_operator', 'Maya', 'review-maya@example.test', true, 'Maya', 'operator', 'ws_review_test'),
          ('usr_review_approver', 'Ellie', 'review-ellie@example.test', true, 'Ellie', 'approver', 'ws_review_test')`
      );
      await pool.query(
        `insert into assets
          (id, workspace_id, kind, object_key, mime_type, status)
         values
          ('asset_review_source', 'ws_review_test', 'source_image', 'test/source.webp', 'image/webp', 'ready'),
          ('asset_review_candidate', 'ws_review_test', 'generated_image', 'test/candidate.webp', 'image/webp', 'ready')`
      );
      await pool.query(
        `insert into products (id, workspace_id, sku, name)
         values ('product_review_test', 'ws_review_test', 'HG-002', 'Stoneware Mug')`
      );
      await pool.query(
        `insert into scene_briefs
          (id, product_id, version, text, source, created_by)
         values
          ('scene_review_test', 'product_review_test', 1, 'Soft window light', 'maya_edited', 'usr_review_operator')`
      );
      await pool.query(
        `insert into generation_attempts (
           id, workspace_id, product_id, attempt_number, source_asset_id,
           scene_brief_id, scene_brief_version, prompt_text,
           prompt_template_version, provider, model, request_type, status,
           idempotency_key, request_fingerprint, quote_fingerprint,
           pricing_version, estimated_price_micros, output_asset_id, created_by
         ) values (
           'attempt_concurrency', 'ws_review_test', 'product_review_test', 1,
           'asset_review_source', 'scene_review_test', 1, 'Soft window light',
           'test-v1', 'fake', 'fake-image', 'image', 'succeeded',
           'generation-concurrency-key', 'request-fingerprint',
           'quote-fingerprint', 'test-pricing-v1', 1000,
           'asset_review_candidate', 'usr_review_operator'
         )`
      );
      await pool.query(
        `insert into review_requests (
           id, generation_attempt_id, workspace_id, product_id,
           approver_user_id, created_by, create_idempotency_key,
           product_name, sku, attempt_number, scene_version, scene_direction,
           source_asset_id, candidate_asset_id
         ) values (
           'review_concurrency', 'attempt_concurrency', 'ws_review_test', 'product_review_test',
           'usr_review_approver', 'usr_review_operator', 'create-concurrency-key',
           'Stoneware Mug', 'HG-002', 1, 1, 'Soft window light',
           'asset_review_source', 'asset_review_candidate'
         )`
      );
    });

    afterAll(async () => {
      await closeDb();
    });

    it("commits exactly one of two conflicting decisions", async () => {
      const store = new PostgresReviewStore();
      const outcomes = await Promise.allSettled([
        store.decide({
          reviewId: "review_concurrency",
          approverUserId: "usr_review_approver",
          idempotencyKey: "approve-concurrency-key",
          decision: { decision: "approved" }
        }),
        store.decide({
          reviewId: "review_concurrency",
          approverUserId: "usr_review_approver",
          idempotencyKey: "changes-concurrency-key",
          decision: {
            decision: "changes_requested",
            feedback: "Use cooler light."
          }
        })
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === "rejected")
      ).toHaveLength(1);
      expect(
        outcomes.find((outcome) => outcome.status === "rejected")
      ).toMatchObject({
        reason: { code: "REVIEW_ALREADY_DECIDED", status: 409 }
      });
      const row = await getPool().query(
        `select state, decision_actor_id as "decisionActorId"
         from review_requests where id = 'review_concurrency'`
      );
      expect(["approved", "changes_requested"]).toContain(row.rows[0].state);
      expect(row.rows[0].decisionActorId).toBe("usr_review_approver");
    });
  }
);
