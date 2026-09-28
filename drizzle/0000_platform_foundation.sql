CREATE TYPE "public"."asset_kind" AS ENUM('catalog_upload', 'source_image', 'generated_image', 'approved_bundle');
CREATE TYPE "public"."asset_status" AS ENUM('pending', 'ready', 'failed');
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed');
CREATE TYPE "public"."job_type" AS ENUM('parse_ingestion_batch', 'ingest_source_asset', 'submit_generation', 'poll_generation', 'persist_generation_output', 'build_approved_bundle', 'platform_smoke_test');
CREATE TYPE "public"."user_role" AS ENUM('operator', 'approver');

CREATE TABLE "workspaces" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "user" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" timestamp with time zone,
  "image" text,
  "display_name" text NOT NULL,
  "role" "user_role" NOT NULL,
  "workspace_id" varchar(32) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_email_unique" UNIQUE("email")
);

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
  "password_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "account_provider_account_unique" UNIQUE("provider_id","account_id")
);

CREATE TABLE "session" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "token_hash" text,
  "expires_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" varchar(40) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "session_token_unique" UNIQUE("token"),
  CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "verification" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "auth_rate_limits" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "count" text NOT NULL,
  "last_request" timestamp with time zone NOT NULL,
  CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);

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

CREATE TABLE "activity_events" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "workspace_id" varchar(32) NOT NULL,
  "product_id" varchar(40),
  "actor_type" text NOT NULL,
  "actor_id" varchar(40),
  "event_type" text NOT NULL,
  "event_data_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "activity_events_actor_type_check" CHECK ("actor_type" in ('user', 'worker', 'system'))
);

CREATE TABLE "jobs" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "type" "job_type" NOT NULL,
  "deduplication_key" text NOT NULL,
  "payload_json" jsonb NOT NULL,
  "status" "job_status" DEFAULT 'queued' NOT NULL,
  "run_after" timestamp with time zone DEFAULT now() NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "locked_at" timestamp with time zone,
  "locked_until" timestamp with time zone,
  "locked_by" text,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "jobs_deduplication_key_unique" UNIQUE("deduplication_key")
);

ALTER TABLE "user" ADD CONSTRAINT "user_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;

CREATE INDEX "user_workspace_role_idx" ON "user" USING btree ("workspace_id","role");
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");
CREATE INDEX "assets_workspace_kind_idx" ON "assets" USING btree ("workspace_id","kind");
CREATE INDEX "activity_events_workspace_event_idx" ON "activity_events" USING btree ("workspace_id","created_at");
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_after");
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("status","locked_until");
