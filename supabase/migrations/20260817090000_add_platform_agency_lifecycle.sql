-- Platform Batch A: tenant lifecycle authority and access enforcement.
--
-- Platform authority remains independent from agency membership. Lifecycle
-- state is service-managed and is consulted by both membership predicates so
-- a suspended or archived agency cannot keep using an existing tenant session.

create type public.organization_lifecycle_status as enum (
  'provisioning',
  'active',
  'restricted',
  'suspended',
  'archived'
);

create table public.organization_lifecycle (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  status public.organization_lifecycle_status not null default 'active',
  reason text check (reason is null or char_length(reason) between 12 and 500),
  changed_by uuid references public.profiles(id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create trigger organization_lifecycle_set_updated_at
  before update on public.organization_lifecycle
  for each row execute function public.set_updated_at();

insert into public.organization_lifecycle (organization_id, status)
select organization.id, 'active'::public.organization_lifecycle_status
from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function private.seed_organization_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.organization_lifecycle (organization_id, status)
  values (new.id, 'active')
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function private.seed_organization_lifecycle() from public;

create trigger organizations_seed_lifecycle
  after insert on public.organizations
  for each row execute function private.seed_organization_lifecycle();

create table public.organization_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  previous_status public.organization_lifecycle_status not null,
  next_status public.organization_lifecycle_status not null,
  reason text not null check (char_length(reason) between 12 and 500),
  actor_id uuid references public.profiles(id) on delete set null,
  version bigint not null check (version > 1),
  created_at timestamptz not null default statement_timestamp(),
  constraint organization_lifecycle_events_real_change_check
    check (previous_status <> next_status)
);

create index organization_lifecycle_status_idx
  on public.organization_lifecycle (status, updated_at desc);

create index organization_lifecycle_events_org_created_idx
  on public.organization_lifecycle_events (organization_id, created_at desc);

alter table public.organization_lifecycle enable row level security;
alter table public.organization_lifecycle_events enable row level security;

revoke all on table public.organization_lifecycle
  from public, anon, authenticated, service_role;
revoke all on table public.organization_lifecycle_events
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.organization_lifecycle
  to service_role;
grant select, insert on table public.organization_lifecycle_events
  to service_role;

create or replace function public.is_active_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.memberships membership
    join public.organization_lifecycle lifecycle
      on lifecycle.organization_id = membership.organization_id
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and lifecycle.status in ('active', 'restricted')
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  permitted_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.memberships membership
    join public.organization_lifecycle lifecycle
      on lifecycle.organization_id = membership.organization_id
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any(permitted_roles)
      and lifecycle.status in ('active', 'restricted')
  );
$$;

create or replace function public.set_organization_lifecycle_service(
  target_organization_id uuid,
  target_status public.organization_lifecycle_status,
  actor_id uuid,
  change_reason text,
  expected_version bigint
)
returns public.organization_lifecycle
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_record public.organization_lifecycle;
  updated_record public.organization_lifecycle;
  normalized_reason text := btrim(coalesce(change_reason, ''));
begin
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A lifecycle reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = actor_id
      and administrator.status = 'active'
  ) then
    raise exception 'An active platform operator is required.'
      using errcode = '42501';
  end if;

  select lifecycle.*
  into current_record
  from public.organization_lifecycle lifecycle
  where lifecycle.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'Organization lifecycle record was not found.'
      using errcode = 'P0002';
  end if;

  if current_record.version <> expected_version then
    raise exception 'Organization lifecycle changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  if current_record.status = target_status then
    raise exception 'Organization is already in the requested lifecycle state.'
      using errcode = '22023';
  end if;

  update public.organization_lifecycle lifecycle
  set status = target_status,
      reason = normalized_reason,
      changed_by = actor_id,
      version = lifecycle.version + 1
  where lifecycle.organization_id = target_organization_id
    and lifecycle.version = expected_version
  returning lifecycle.* into updated_record;

  if not found then
    raise exception 'Organization lifecycle changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  insert into public.organization_lifecycle_events (
    organization_id,
    previous_status,
    next_status,
    reason,
    actor_id,
    version
  ) values (
    target_organization_id,
    current_record.status,
    updated_record.status,
    normalized_reason,
    actor_id,
    updated_record.version
  );

  insert into public.platform_audit_events (
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    actor_id,
    'agency.lifecycle_changed',
    'organization',
    target_organization_id,
    jsonb_build_object(
      'previousStatus', current_record.status,
      'nextStatus', updated_record.status,
      'version', updated_record.version
    )
  );

  return updated_record;
end;
$$;

revoke all on function public.set_organization_lifecycle_service(
  uuid,
  public.organization_lifecycle_status,
  uuid,
  text,
  bigint
) from public, anon, authenticated;
grant execute on function public.set_organization_lifecycle_service(
  uuid,
  public.organization_lifecycle_status,
  uuid,
  text,
  bigint
) to service_role;

comment on table public.organization_lifecycle is
  'Service-managed agency lifecycle. Platform roles do not gain tenant-record access from this state.';

comment on function public.set_organization_lifecycle_service(
  uuid,
  public.organization_lifecycle_status,
  uuid,
  text,
  bigint
) is
  'Atomically changes agency lifecycle with optimistic concurrency and platform audit evidence. Service role only.';

