-- CRM core: companies establish commercial context and activity events provide
-- a tenant-scoped timeline for human and AIOS work.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  website text,
  email text,
  phone text,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, name)
);

alter table public.contacts
  add column company_id uuid references public.companies(id) on delete set null;

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  activity_type text not null check (activity_type in ('note', 'contact_created', 'company_created', 'deal_created', 'deal_stage_changed', 'task_created', 'ai_observation')),
  body text not null default '' check (char_length(body) <= 5_000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index companies_organization_name_idx on public.companies (organization_id, lower(name)) where archived_at is null;
create index contacts_company_idx on public.contacts (company_id) where company_id is not null;
create index activity_events_organization_created_idx on public.activity_events (organization_id, created_at desc);
create index activity_events_contact_created_idx on public.activity_events (contact_id, created_at desc) where contact_id is not null;
create index activity_events_deal_created_idx on public.activity_events (deal_id, created_at desc) where deal_id is not null;

create trigger companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.activity_events enable row level security;

create policy "members may access companies" on public.companies
  for all to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

create policy "members may access activity events" on public.activity_events
  for all to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

grant select, insert, update, delete on table public.companies, public.activity_events to authenticated;
