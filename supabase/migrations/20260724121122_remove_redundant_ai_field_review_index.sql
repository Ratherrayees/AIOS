-- The original schema already has a unique constraint on (ai_run_id, field_name).
-- Keep that constraint and remove the redundant index added by the prior migration.
drop index if exists public.ai_field_reviews_run_field_unique_idx;
