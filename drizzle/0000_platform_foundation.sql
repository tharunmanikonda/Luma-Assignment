CREATE TYPE "public"."asset_kind" AS ENUM('catalog_upload', 'source_image', 'generated_image', 'approved_bundle');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('operator', 'approver');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('parse_ingestion_batch', 'ingest_source_asset', 'submit_generation', 'poll_generation', 'persist_generation_output', 'build_approved_bundle', 'platform_smoke_test');--> statement-breakpoint
CREATE TYPE "public"."ingestion_batch_status" AS ENUM('uploaded', 'validating', 'ready', 'committing', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scene_brief_source" AS ENUM('imported', 'maya_edited', 'revision_feedback');--> statement-breakpoint
CREATE TYPE "public"."generation_attempt_status" AS ENUM('pending', 'submitting', 'queued', 'processing', 'storing', 'succeeded', 'failed', 'reconciliation_required');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('pending', 'approved', 'changes_requested', 'revoked');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(32) NOT NULL,
	"product_id" varchar(40),
	"actor_type" text NOT NULL,
	"actor_id" varchar(40),
	"event_type" text NOT NULL,
	"event_data_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_events_actor_type_check" CHECK ("activity_events"."actor_type" in ('user', 'worker', 'system'))
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(32) NOT NULL,
	"product_id" varchar(40),
	"kind" "asset_kind" NOT NULL,
	"object_key" text NOT NULL,
	"original_url" text,
	"filename" text,
	"mime_type" text,
	"byte_size" bigint,
	"width" integer,
	"height" integer,
	"checksum" text,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"failure_details_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_provider_account_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"display_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"workspace_id" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"type" "job_type" NOT NULL,
	"deduplication_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_deduplication_key_unique" UNIQUE("deduplication_key")
);
--> statement-breakpoint
CREATE TABLE "ingestion_batches" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(32) NOT NULL,
	"source_type" text DEFAULT 'csv' NOT NULL,
	"source_asset_id" varchar(40) NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "ingestion_batch_status" DEFAULT 'uploaded' NOT NULL,
	"failure_message" text,
	"created_by" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "ingestion_batches_workspace_idempotency_unique" UNIQUE("workspace_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ingestion_items" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"batch_id" varchar(40) NOT NULL,
	"source_row_number" integer,
	"raw_data_json" jsonb NOT NULL,
	"validation_errors_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_id" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_items_batch_row_unique" UNIQUE("batch_id","source_row_number")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(32) NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"color_finish" text,
	"material" text,
	"price_minor" integer,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"notes" text,
	"current_source_asset_id" varchar(40),
	"current_scene_brief_id" varchar(40),
	"target_approved_images" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_workspace_sku_unique" UNIQUE("workspace_id","sku"),
	CONSTRAINT "products_target_approved_images_check" CHECK ("products"."target_approved_images" > 0)
);
--> statement-breakpoint
CREATE TABLE "scene_briefs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"product_id" varchar(40) NOT NULL,
	"version" integer NOT NULL,
	"text" text NOT NULL,
	"source" "scene_brief_source" NOT NULL,
	"based_on_review_id" varchar(40),
	"created_by" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_briefs_product_version_unique" UNIQUE("product_id","version")
);
--> statement-breakpoint
CREATE TABLE "generation_attempts" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(32) NOT NULL,
	"product_id" varchar(40) NOT NULL,
	"attempt_number" integer NOT NULL,
	"source_asset_id" varchar(40) NOT NULL,
	"scene_brief_id" varchar(40) NOT NULL,
	"scene_brief_version" integer NOT NULL,
	"prompt_text" text NOT NULL,
	"prompt_template_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"request_type" text NOT NULL,
	"status" "generation_attempt_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"quote_fingerprint" text NOT NULL,
	"pricing_version" text NOT NULL,
	"estimated_price_micros" integer NOT NULL,
	"provider_generation_id" text,
	"provider_request_id" text,
	"provider_api_version" text,
	"provider_output_url" text,
	"output_asset_id" varchar(40),
	"failure_details_json" jsonb,
	"created_by" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_attempt_workspace_idempotency_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "generation_attempt_product_number_unique" UNIQUE("product_id","attempt_number"),
	CONSTRAINT "generation_attempt_provider_generation_unique" UNIQUE("provider_generation_id")
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"generation_attempt_id" varchar(40) NOT NULL,
	"workspace_id" varchar(32) NOT NULL,
	"product_id" varchar(40) NOT NULL,
	"approver_user_id" varchar(40) NOT NULL,
	"created_by" varchar(40) NOT NULL,
	"state" "review_state" DEFAULT 'pending' NOT NULL,
	"feedback" text,
	"decision_actor_id" varchar(40),
	"create_idempotency_key" text NOT NULL,
	"decision_idempotency_key" text,
	"revoke_idempotency_key" text,
	"product_name" text NOT NULL,
	"sku" text NOT NULL,
	"category" text,
	"color_finish" text,
	"material" text,
	"attempt_number" integer NOT NULL,
	"scene_version" integer NOT NULL,
	"scene_direction" text NOT NULL,
	"source_asset_id" varchar(40) NOT NULL,
	"candidate_asset_id" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "review_requests_attempt_unique" UNIQUE("generation_attempt_id"),
	CONSTRAINT "review_requests_create_key_unique" UNIQUE("create_idempotency_key"),
	CONSTRAINT "review_requests_feedback_required_check" CHECK ("review_requests"."state" <> 'changes_requested' or length(trim("review_requests"."feedback")) >= 3),
	CONSTRAINT "review_requests_terminal_fields_check" CHECK ((
        "review_requests"."state" = 'pending'
        and "review_requests"."decided_at" is null
        and "review_requests"."revoked_at" is null
      ) or (
        "review_requests"."state" in ('approved', 'changes_requested')
        and "review_requests"."decided_at" is not null
        and "review_requests"."decision_actor_id" is not null
        and "review_requests"."revoked_at" is null
      ) or (
        "review_requests"."state" = 'revoked'
        and "review_requests"."revoked_at" is not null
        and "review_requests"."decided_at" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_batch_id_ingestion_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingestion_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_current_source_asset_id_assets_id_fk" FOREIGN KEY ("current_source_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_briefs" ADD CONSTRAINT "scene_briefs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_briefs" ADD CONSTRAINT "scene_briefs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_scene_brief_id_scene_briefs_id_fk" FOREIGN KEY ("scene_brief_id") REFERENCES "public"."scene_briefs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_output_asset_id_assets_id_fk" FOREIGN KEY ("output_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_generation_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("generation_attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_approver_user_id_user_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_decision_actor_id_user_id_fk" FOREIGN KEY ("decision_actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_candidate_asset_id_assets_id_fk" FOREIGN KEY ("candidate_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_workspace_event_idx" ON "activity_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "assets_workspace_kind_idx" ON "assets" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_workspace_role_idx" ON "user" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("status","locked_until");--> statement-breakpoint
CREATE INDEX "ingestion_batches_workspace_created_idx" ON "ingestion_batches" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ingestion_items_batch_idx" ON "ingestion_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "products_workspace_updated_idx" ON "products" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "scene_briefs_product_created_idx" ON "scene_briefs" USING btree ("product_id","created_at","id");--> statement-breakpoint
CREATE INDEX "generation_attempt_product_history_idx" ON "generation_attempts" USING btree ("product_id","attempt_number","id");--> statement-breakpoint
CREATE INDEX "generation_attempt_workspace_status_idx" ON "generation_attempts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "review_requests_product_history_idx" ON "review_requests" USING btree ("product_id","created_at","id");--> statement-breakpoint
CREATE INDEX "review_requests_approver_state_idx" ON "review_requests" USING btree ("approver_user_id","state");