-- Existing deployed projects predate expected-close planning. New projects
-- already receive this column from the foundational migration.
alter table public.deals
  add column if not exists expected_close_at date;

create index if not exists deals_organization_expected_close_idx
  on public.deals (organization_id, expected_close_at)
  where archived_at is null
    and stage not in ('won', 'lost');
