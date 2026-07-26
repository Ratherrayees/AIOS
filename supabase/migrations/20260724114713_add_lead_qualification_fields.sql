-- Commercial qualification context used by human sales operators and AIOS.
alter table public.deals
  add column probability smallint not null default 10 check (probability between 0 and 100),
  add column next_step text check (next_step is null or char_length(next_step) <= 500),
  add column lost_reason text check (lost_reason is null or char_length(lost_reason) <= 500),
  add column qualified_at timestamptz,
  add column last_activity_at timestamptz;

create index deals_organization_pipeline_priority_idx
  on public.deals (organization_id, stage, probability desc, updated_at desc)
  where archived_at is null;
