-- Phase 18: approved, tenant-scoped sales targets for evidence-backed
-- pipeline coverage. Browser clients may read targets but cannot write them
-- directly; owner/admin changes pass through one audited function.

create table public.analytics_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  label text not null
    check (char_length(trim(label)) between 3 and 80),
  currency text not null
    check (currency ~ '^[A-Z]{3}$'),
  period_start date not null,
  period_end date not null,
  target_amount numeric(18, 2) not null
    check (target_amount > 0),
  is_active boolean not null default true,
  created_by uuid not null
    references public.profiles(id) on delete restrict,
  updated_by uuid not null
    references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint analytics_targets_organization_id_id_key
    unique (organization_id, id),
  constraint analytics_targets_period_check
    check (
      period_end >= period_start
      and period_end <= period_start + 365
    ),
  constraint analytics_targets_identity_key
    unique (organization_id, currency, period_start, period_end, label)
);

create index analytics_targets_active_period_idx
  on public.analytics_targets (
    organization_id,
    period_start,
    period_end,
    currency
  )
  where is_active;
create index analytics_targets_created_by_idx
  on public.analytics_targets (created_by);
create index analytics_targets_updated_by_idx
  on public.analytics_targets (updated_by);

create trigger analytics_targets_set_updated_at
  before update on public.analytics_targets
  for each row execute function public.set_updated_at();
create trigger analytics_targets_prevent_organization_move
  before update on public.analytics_targets
  for each row execute function private.prevent_organization_id_change();

alter table public.analytics_targets enable row level security;

create policy analytics_targets_member_select
  on public.analytics_targets
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

revoke all on table public.analytics_targets
  from public, anon, authenticated;
grant select on table public.analytics_targets to authenticated;
grant select, insert, update, delete
  on table public.analytics_targets to service_role;

create or replace function public.upsert_analytics_target(
  target_organization_id uuid,
  target_label text,
  target_currency text,
  target_period_start date,
  target_period_end date,
  target_amount numeric,
  target_is_active boolean,
  target_id uuid default null
)
returns setof public.analytics_targets
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  target_record public.analytics_targets%rowtype;
  changed_at timestamptz := statement_timestamp();
  event_name text;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to configure analytics targets.'
      using errcode = '42501';
  end if;

  if target_id is null then
    insert into public.analytics_targets (
      organization_id,
      label,
      currency,
      period_start,
      period_end,
      target_amount,
      is_active,
      created_by,
      updated_by,
      created_at,
      updated_at
    )
    values (
      target_organization_id,
      trim(target_label),
      upper(trim(target_currency)),
      target_period_start,
      target_period_end,
      target_amount,
      target_is_active,
      actor_id,
      actor_id,
      changed_at,
      changed_at
    )
    returning * into target_record;
    event_name := 'analytics.target_created';
  else
    update public.analytics_targets target
    set
      label = trim(target_label),
      currency = upper(trim(target_currency)),
      period_start = target_period_start,
      period_end = target_period_end,
      target_amount = $6,
      is_active = target_is_active,
      updated_by = actor_id,
      updated_at = changed_at
    where target.organization_id = target_organization_id
      and target.id = target_id
    returning * into target_record;

    if not found then
      raise exception 'The analytics target is not available.'
        using errcode = 'P0002';
    end if;
    event_name := case
      when target_is_active then 'analytics.target_updated'
      else 'analytics.target_retired'
    end;
  end if;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_organization_id,
    actor_id,
    'record.updated',
    'analytics_target',
    target_record.id,
    jsonb_build_object(
      'event', event_name,
      'label', target_record.label,
      'currency', target_record.currency,
      'period_start', target_record.period_start,
      'period_end', target_record.period_end,
      'target_amount', target_record.target_amount,
      'is_active', target_record.is_active
    ),
    changed_at
  );

  return next target_record;
end;
$$;

revoke all on function public.upsert_analytics_target(
  uuid,
  text,
  text,
  date,
  date,
  numeric,
  boolean,
  uuid
) from public, anon;
grant execute on function public.upsert_analytics_target(
  uuid,
  text,
  text,
  date,
  date,
  numeric,
  boolean,
  uuid
) to authenticated, service_role;
