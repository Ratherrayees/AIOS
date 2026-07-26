-- AIOS foundational schema. Apply with the Supabase CLI after a project exists.
-- This migration is intentionally credential-free and safe to review in source control.

create type public.app_role as enum ('owner', 'admin', 'sales', 'trip_designer', 'operations', 'finance', 'agent', 'viewer');
create type public.membership_status as enum ('active', 'invited', 'suspended');
create type public.deal_stage as enum ('new', 'qualified', 'proposal', 'decision', 'won', 'lost');
create type public.task_status as enum ('open', 'in_progress', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'agent',
  status public.membership_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text,
  email text,
  phone text,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique nulls not distinct (organization_id, email)
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  stage public.deal_stage not null default 'new',
  value_amount numeric(14, 2) check (value_amount is null or value_amount >= 0),
  currency char(3) not null default 'INR',
  expected_close_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  status public.task_status not null default 'open',
  due_at timestamptz,
  assignee_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 120),
  entity_type text not null check (char_length(entity_type) between 1 and 120),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index contacts_organization_search_idx on public.contacts (organization_id, lower(first_name), lower(last_name));
create index deals_organization_stage_idx on public.deals (organization_id, stage, expected_close_at);
create index tasks_organization_assignee_due_idx on public.tasks (organization_id, assignee_id, due_at) where status in ('open', 'in_progress');
create index audit_events_organization_created_idx on public.audit_events (organization_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger deals_set_updated_at before update on public.deals for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_active_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.has_organization_role(target_organization_id uuid, permitted_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and status = 'active'
      and role = any(permitted_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;
alter table public.audit_events enable row level security;

create policy "profile owner may read profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profile owner may update profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members may read organization" on public.organizations for select to authenticated using (public.is_active_member(id));
create policy "members may read memberships" on public.memberships for select to authenticated using (public.is_active_member(organization_id));
create policy "admins may manage memberships" on public.memberships for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "members may access contacts" on public.contacts for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access deals" on public.deals for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access tasks" on public.tasks for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may read audit events" on public.audit_events for select to authenticated using (public.is_active_member(organization_id));

-- Audit events are append-only for application users. Server-only audit writers
-- use a tightly scoped RPC or protected backend path in a later migration.
create policy "members may append audit events" on public.audit_events for insert to authenticated with check (public.is_active_member(organization_id) and actor_id = auth.uid());

revoke all on function public.is_active_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, public.app_role[]) from public;
grant execute on function public.is_active_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, public.app_role[]) to authenticated;
