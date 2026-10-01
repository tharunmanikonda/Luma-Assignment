alter table "ingestion_items"
  add column if not exists "outcome_action" text;

update "ingestion_items" as item
set "outcome_action" = case
  when jsonb_array_length(item."validation_errors_json") > 0
    or item."product_id" is null then 'blocked'
  when exists (
    select 1
    from "activity_events" as event
    where event."product_id" = item."product_id"
      and event."event_type" = 'catalog_product_imported'
      and event."event_data_json"->>'batchId' = item."batch_id"
      and event."event_data_json"->>'rowNumber' = item."source_row_number"::text
  ) then 'create'
  when exists (
    select 1
    from "activity_events" as event
    where event."product_id" = item."product_id"
      and event."event_type" = 'catalog_product_updated'
      and event."event_data_json"->>'batchId' = item."batch_id"
      and event."event_data_json"->>'rowNumber' = item."source_row_number"::text
  ) then 'update'
  else 'unchanged'
end
from "ingestion_batches" as batch
where batch."id" = item."batch_id"
  and batch."status" = 'committed'
  and item."outcome_action" is null;
