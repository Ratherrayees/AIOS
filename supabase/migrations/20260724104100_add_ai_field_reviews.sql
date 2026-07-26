-- Human review ledger for structured AI proposals. Server-only writes preserve
-- the audited distinction between a model proposal and a user-approved change.

create type public.ai_field_review_decision as enum ('accepted', 'rejected');

create table public.ai_field_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ai_run_id uuid not null references public.ai_runs(id) on delete cascade,
  entity_type text not null check (char_length(entity_type) between 1 and 120),
  entity_id uuid not null,
  field_name text not null check (char_length(field_name) between 1 and 120),
  proposed_value jsonb not null,
  decision public.ai_field_review_decision not null,
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (ai_run_id, field_name)
);

create index ai_field_reviews_entity_idx on public.ai_field_reviews (organization_id, entity_type, entity_id, reviewed_at desc);

alter table public.ai_field_reviews enable row level security;

grant select on table public.ai_field_reviews to authenticated;

-- Members can inspect their organization's decision trail. Only trusted server
-- actions write reviews after checking membership and the linked AI run.
create policy "members may read ai field reviews" on public.ai_field_reviews
  for select to authenticated
  using (public.is_active_member(organization_id));
