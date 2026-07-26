-- One human decision ledger per proposed field makes review application single-claim.
-- The action claims this unique key before changing the CRM record.
set lock_timeout = '5s';

create unique index ai_field_reviews_run_field_unique_idx
  on public.ai_field_reviews (ai_run_id, field_name);
