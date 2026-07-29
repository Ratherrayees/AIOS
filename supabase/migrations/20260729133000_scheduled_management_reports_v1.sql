-- Phase 18 v3: durable, privacy-safe in-app management report delivery.
--
-- The deployment scheduler only wakes a server worker. The database owns
-- configuration, leases, immutable delivery history, and tenant visibility.
-- Generated CSV snapshots contain aggregate management intelligence only.

create table public.analytics_report_schedules (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  is_enabled boolean not null default false,
  cadence text not null default 'weekly'
    check (cadence in ('weekly', 'monthly')),
  period_days smallint not null default 30
    check (period_days in (30, 90, 365)),
  forecast_horizon_days smallint not null default 90
    check (forecast_horizon_days in (30, 90, 365)),
  next_run_at timestamptz not null default statement_timestamp(),
  last_delivery_at timestamptz,
  last_delivery_status text
    check (last_delivery_status in ('ready', 'failed')),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.analytics_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  trigger_type text not null
    check (trigger_type in ('scheduled', 'operator')),
  status text not null default 'running'
    check (status in ('running', 'ready', 'failed')),
  scheduled_for timestamptz not null,
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  worker_id text not null
    check (char_length(worker_id) between 16 and 128),
  report_filename text
    check (
      report_filename is null
      or report_filename ~ '^aios-management-report-[0-9]{4}-[0-9]{2}-[0-9]{2}\.csv$'
    ),
  report_csv text
    check (
      report_csv is null
      or octet_length(report_csv) between 1 and 2097152
    ),
  report_row_count integer
    check (report_row_count is null or report_row_count between 1 and 20000),
  report_sha256 text
    check (
      report_sha256 is null
      or report_sha256 ~ '^[a-f0-9]{64}$'
    ),
  error_code text
    check (
      error_code is null
      or error_code ~ '^[a-z0-9_]{3,80}$'
    ),
  schedule_snapshot jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint analytics_report_deliveries_terminal_state_check
    check (
      (
        status = 'running'
        and finished_at is null
        and report_filename is null
        and report_csv is null
        and report_row_count is null
        and report_sha256 is null
        and error_code is null
      )
      or
      (
        status = 'ready'
        and finished_at is not null
        and report_filename is not null
        and report_csv is not null
        and report_row_count is not null
        and report_sha256 is not null
        and error_code is null
      )
      or
      (
        status = 'failed'
        and finished_at is not null
        and report_filename is null
        and report_csv is null
        and report_row_count is null
        and report_sha256 is null
        and error_code is not null
      )
    )
);

create index analytics_report_schedules_due_idx
  on public.analytics_report_schedules (next_run_at, organization_id)
  where is_enabled;
create unique index analytics_report_deliveries_one_active_org_idx
  on public.analytics_report_deliveries (organization_id)
  where status = 'running';
create index analytics_report_deliveries_history_idx
  on public.analytics_report_deliveries (organization_id, started_at desc);

create trigger analytics_report_schedules_set_updated_at
  before update on public.analytics_report_schedules
  for each row execute function public.set_updated_at();
create trigger analytics_report_schedules_prevent_organization_move
  before update on public.analytics_report_schedules
  for each row execute function private.prevent_organization_id_change();
create trigger analytics_report_deliveries_prevent_organization_move
  before update on public.analytics_report_deliveries
  for each row execute function private.prevent_organization_id_change();

alter table public.analytics_report_schedules enable row level security;
alter table public.analytics_report_deliveries enable row level security;

create policy analytics_report_schedules_member_select
  on public.analytics_report_schedules
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

create policy analytics_report_deliveries_member_select
  on public.analytics_report_deliveries
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

revoke all on table public.analytics_report_schedules
  from public, anon, authenticated;
revoke all on table public.analytics_report_deliveries
  from public, anon, authenticated;
grant select on table public.analytics_report_schedules to authenticated;
grant select on table public.analytics_report_deliveries to authenticated;
grant select, insert, update, delete
  on table public.analytics_report_schedules to service_role;
grant select, insert, update, delete
  on table public.analytics_report_deliveries to service_role;

insert into public.analytics_report_schedules (organization_id)
select organization.id
from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function private.initialize_analytics_report_schedule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.analytics_report_schedules (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function private.initialize_analytics_report_schedule()
  from public, anon, authenticated;

create trigger organizations_initialize_analytics_report_schedule
  after insert on public.organizations
  for each row execute function private.initialize_analytics_report_schedule();

create or replace function public.upsert_analytics_report_schedule(
  target_organization_id uuid,
  target_is_enabled boolean,
  target_cadence text,
  target_period_days smallint,
  target_forecast_horizon_days smallint,
  target_next_run_at timestamptz
)
returns setof public.analytics_report_schedules
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  changed_at timestamptz := statement_timestamp();
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to configure management reports.'
      using errcode = '42501';
  end if;

  if target_cadence not in ('weekly', 'monthly')
    or target_period_days not in (30, 90, 365)
    or target_forecast_horizon_days not in (30, 90, 365)
    or target_next_run_at is null
    or target_next_run_at < changed_at - interval '5 minutes'
    or target_next_run_at > changed_at + interval '366 days'
  then
    raise exception 'The management report schedule is outside its safe bounds.'
      using errcode = '22023';
  end if;

  insert into public.analytics_report_schedules (
    organization_id,
    is_enabled,
    cadence,
    period_days,
    forecast_horizon_days,
    next_run_at,
    updated_by
  )
  values (
    target_organization_id,
    target_is_enabled,
    target_cadence,
    target_period_days,
    target_forecast_horizon_days,
    target_next_run_at,
    actor_id
  )
  on conflict (organization_id)
  do update set
    is_enabled = excluded.is_enabled,
    cadence = excluded.cadence,
    period_days = excluded.period_days,
    forecast_horizon_days = excluded.forecast_horizon_days,
    next_run_at = excluded.next_run_at,
    updated_by = actor_id;

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
    'analytics_report_schedule',
    target_organization_id,
    jsonb_build_object(
      'event', 'analytics.report_schedule_updated',
      'is_enabled', target_is_enabled,
      'cadence', target_cadence,
      'period_days', target_period_days,
      'forecast_horizon_days', target_forecast_horizon_days,
      'next_run_at', target_next_run_at
    ),
    changed_at
  );

  return query
  select schedule.*
  from public.analytics_report_schedules schedule
  where schedule.organization_id = target_organization_id;
end;
$$;

revoke all on function public.upsert_analytics_report_schedule(
  uuid, boolean, text, smallint, smallint, timestamptz
) from public, anon;
grant execute on function public.upsert_analytics_report_schedule(
  uuid, boolean, text, smallint, smallint, timestamptz
) to authenticated;

create or replace function public.claim_analytics_report_runs(
  target_worker_id text,
  target_limit integer default 10,
  target_organization_id uuid default null,
  target_force boolean default false
)
returns table (
  run_id uuid,
  organization_id uuid,
  report_period_days smallint,
  report_forecast_horizon_days smallint,
  trigger_type text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  schedule_record public.analytics_report_schedules%rowtype;
  claimed_run_id uuid;
  claim_time timestamptz := statement_timestamp();
  bounded_limit integer := least(greatest(target_limit, 1), 25);
  claimed_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Management report schedules are server-only.'
      using errcode = '42501';
  end if;
  if target_worker_id is null
    or char_length(target_worker_id) not between 16 and 128
  then
    raise exception 'A bounded worker identity is required.'
      using errcode = '22023';
  end if;
  if target_force and target_organization_id is null then
    raise exception 'Forced execution must target one workspace.'
      using errcode = '22023';
  end if;

  update public.analytics_report_deliveries delivery
  set
    status = 'failed',
    finished_at = claim_time,
    error_code = 'lease_expired'
  where delivery.status = 'running'
    and delivery.started_at < claim_time - interval '15 minutes';

  for schedule_record in
    select schedule.*
    from public.analytics_report_schedules schedule
    where (schedule.is_enabled or target_force)
      and (
        target_organization_id is null
        or schedule.organization_id = target_organization_id
      )
      and (target_force or schedule.next_run_at <= claim_time)
      and not exists (
        select 1
        from public.analytics_report_deliveries active_delivery
        where active_delivery.organization_id = schedule.organization_id
          and active_delivery.status = 'running'
      )
    order by schedule.next_run_at, schedule.organization_id
    for update skip locked
    limit bounded_limit
  loop
    insert into public.analytics_report_deliveries (
      organization_id,
      trigger_type,
      scheduled_for,
      worker_id,
      schedule_snapshot
    )
    values (
      schedule_record.organization_id,
      case when target_force then 'operator' else 'scheduled' end,
      case when target_force then claim_time else schedule_record.next_run_at end,
      target_worker_id,
      jsonb_build_object(
        'schema_version', 1,
        'cadence', schedule_record.cadence,
        'period_days', schedule_record.period_days,
        'forecast_horizon_days', schedule_record.forecast_horizon_days,
        'delivery_channel', 'in_app'
      )
    )
    returning id into claimed_run_id;

    if not target_force then
      update public.analytics_report_schedules schedule
      set next_run_at =
        case schedule_record.cadence
          when 'weekly' then schedule_record.next_run_at + interval '7 days'
          else schedule_record.next_run_at + interval '1 month'
        end
      where schedule.organization_id = schedule_record.organization_id;
    end if;

    run_id := claimed_run_id;
    organization_id := schedule_record.organization_id;
    report_period_days := schedule_record.period_days;
    report_forecast_horizon_days := schedule_record.forecast_horizon_days;
    trigger_type := case when target_force then 'operator' else 'scheduled' end;
    return next;

    claimed_count := claimed_count + 1;
    exit when claimed_count >= bounded_limit;
  end loop;
end;
$$;

revoke all on function public.claim_analytics_report_runs(
  text, integer, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.claim_analytics_report_runs(
  text, integer, uuid, boolean
) to service_role;

create or replace function public.settle_analytics_report_run(
  target_run_id uuid,
  target_worker_id text,
  target_status text,
  target_report_filename text default null,
  target_report_csv text default null,
  target_report_row_count integer default null,
  target_report_sha256 text default null,
  target_error_code text default null
)
returns setof public.analytics_report_deliveries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_delivery public.analytics_report_deliveries%rowtype;
  settled_at timestamptz := statement_timestamp();
  normalized_error text := nullif(
    lower(regexp_replace(coalesce(target_error_code, ''), '[^a-z0-9_]', '_', 'g')),
    ''
  );
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Management report settlement is server-only.'
      using errcode = '42501';
  end if;

  select delivery.*
  into current_delivery
  from public.analytics_report_deliveries delivery
  where delivery.id = target_run_id
  for update;

  if current_delivery.id is null
    or current_delivery.status <> 'running'
    or current_delivery.worker_id <> target_worker_id
  then
    raise exception 'This management report lease is not available.'
      using errcode = '55000';
  end if;

  if target_status = 'ready' then
    if target_report_filename is null
      or target_report_filename
        !~ '^aios-management-report-[0-9]{4}-[0-9]{2}-[0-9]{2}\.csv$'
      or target_report_csv is null
      or octet_length(target_report_csv) not between 1 and 2097152
      or target_report_row_count not between 1 and 20000
      or target_report_sha256 !~ '^[a-f0-9]{64}$'
      or target_error_code is not null
    then
      raise exception 'A ready report needs bounded immutable evidence.'
        using errcode = '22023';
    end if;

    update public.analytics_report_deliveries delivery
    set
      status = 'ready',
      finished_at = settled_at,
      report_filename = target_report_filename,
      report_csv = target_report_csv,
      report_row_count = target_report_row_count,
      report_sha256 = target_report_sha256
    where delivery.id = target_run_id;
  elsif target_status = 'failed' then
    if normalized_error is null
      or char_length(normalized_error) not between 3 and 80
      or target_report_filename is not null
      or target_report_csv is not null
      or target_report_row_count is not null
      or target_report_sha256 is not null
    then
      raise exception 'A failed report needs one bounded error code.'
        using errcode = '22023';
    end if;

    update public.analytics_report_deliveries delivery
    set
      status = 'failed',
      finished_at = settled_at,
      error_code = normalized_error
    where delivery.id = target_run_id;
  else
    raise exception 'Unsupported management report settlement.'
      using errcode = '22023';
  end if;

  update public.analytics_report_schedules schedule
  set
    last_delivery_at = settled_at,
    last_delivery_status = target_status
  where schedule.organization_id = current_delivery.organization_id;

  return query
  select delivery.*
  from public.analytics_report_deliveries delivery
  where delivery.id = target_run_id;
end;
$$;

revoke all on function public.settle_analytics_report_run(
  uuid, text, text, text, text, integer, text, text
) from public, anon, authenticated;
grant execute on function public.settle_analytics_report_run(
  uuid, text, text, text, text, integer, text, text
) to service_role;
