alter table "ingestion_batches"
  add column if not exists "outcome_summary_json" jsonb;
