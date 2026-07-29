-- Phase 16 v2: durable, tenant-scoped Operations Radar schedules.
--
-- The database owns policy, claiming, idempotency, run history, and bounded
-- thresholds. A deployment scheduler only wakes the server-only worker. The
-- worker can refresh internal exception records; it has no external-effect
-- tool for messages, bookings, documents, pricing, or money movement.

create table public.operations_radar_policies (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  is_enabled boolean not null default true,
  scan_interval_minutes integer not null default 60
    check (scan_interval_minutes in (15, 30, 60, 180, 360, 720, 1440)),
  confirmation_watch_days smallint not null default 14
    check (confirmation_watch_days between 1 and 14),
  confirmation_critical_hours smallint not null default 48
    check (confirmation_critical_hours between 1 and 168),
  confirmation_high_days smallint not null default 7
    check (confirmation_high_days between 1 and 14),
  document_expiry_days smallint not null default 30
    check (document_expiry_days between 1 and 30),
  document_high_days smallint not null default 7
    check (document_high_days between 1 and 30),
  payment_due_days smallint not null default 7
    check (payment_due_days between 1 and 7),
  payment_high_days smallint not null default 2
    check (payment_high_days between 1 and 7),
  task_critical_hours smallint not null default 24
    check (task_critical_hours between 1 and 168),
  default_assignee_id uuid,
  next_run_at timestamptz not null default statement_timestamp(),
  last_run_at timestamptz,
  last_run_status text
    check (last_run_status in ('succeeded', 'failed')),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint operations_radar_policy_confirmation_threshold_check
    check (
      confirmation_critical_hours
        <= confirmation_watch_days * 24
      and confirmation_high_days <= confirmation_watch_days
      and confirmation_critical_hours
        <= confirmation_high_days * 24
    ),
  constraint operations_radar_policy_document_threshold_check
    check (document_high_days <= document_expiry_days),
  constraint operations_radar_policy_payment_threshold_check
    check (payment_high_days <= payment_due_days),
  constraint operations_radar_policy_assignee_same_organization_fkey
    foreign key (organization_id, default_assignee_id)
    references public.memberships(organization_id, user_id)
    on delete set null (default_assignee_id)
);

create table public.operations_radar_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  trigger_type text not null
    check (trigger_type in ('scheduled', 'operator')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  scheduled_for timestamptz not null,
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  worker_id text not null
    check (char_length(worker_id) between 16 and 128),
  active_count bigint
    check (active_count is null or active_count >= 0),
  critical_count bigint
    check (critical_count is null or critical_count >= 0),
  resolved_count integer
    check (resolved_count is null or resolved_count >= 0),
  error_code text
    check (
      error_code is null
      or error_code ~ '^[a-z0-9_]{3,80}$'
    ),
  policy_snapshot jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint operations_radar_runs_terminal_state_check
    check (
      (status = 'running'
        and finished_at is null
        and active_count is null
        and critical_count is null
        and resolved_count is null
        and error_code is null)
      or
      (status = 'succeeded'
        and finished_at is not null
        and active_count is not null
        and critical_count is not null
        and resolved_count is not null
        and error_code is null)
      or
      (status = 'failed'
        and finished_at is not null
        and active_count is null
        and critical_count is null
        and resolved_count is null
        and error_code is not null)
    )
);

create unique index operations_radar_runs_one_active_per_org_idx
  on public.operations_radar_runs (organization_id)
  where status = 'running';
create index operations_radar_runs_history_idx
  on public.operations_radar_runs (
    organization_id,
    started_at desc
  );
create index operations_radar_policies_due_idx
  on public.operations_radar_policies (next_run_at, organization_id)
  where is_enabled;
create index operations_radar_policies_assignee_idx
  on public.operations_radar_policies (default_assignee_id)
  where default_assignee_id is not null;

create trigger operations_radar_policies_set_updated_at
  before update on public.operations_radar_policies
  for each row execute function public.set_updated_at();
create trigger operations_radar_policies_prevent_organization_move
  before update on public.operations_radar_policies
  for each row execute function private.prevent_organization_id_change();
create trigger operations_radar_runs_prevent_organization_move
  before update on public.operations_radar_runs
  for each row execute function private.prevent_organization_id_change();

alter table public.operations_radar_policies enable row level security;
alter table public.operations_radar_runs enable row level security;

create policy operations_radar_policies_member_select
  on public.operations_radar_policies
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

create policy operations_radar_runs_member_select
  on public.operations_radar_runs
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

revoke all on table public.operations_radar_policies
  from public, anon, authenticated;
revoke all on table public.operations_radar_runs
  from public, anon, authenticated;
grant select on table public.operations_radar_policies to authenticated;
grant select on table public.operations_radar_runs to authenticated;
grant select, insert, update, delete
  on table public.operations_radar_policies to service_role;
grant select, insert, update, delete
  on table public.operations_radar_runs to service_role;

-- Every existing and future workspace receives a safe default schedule.
insert into public.operations_radar_policies (organization_id)
select organization.id
from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function private.initialize_operations_radar_policy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.operations_radar_policies (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function private.initialize_operations_radar_policy()
  from public, anon, authenticated;

create trigger organizations_initialize_operations_radar_policy
  after insert on public.organizations
  for each row execute function private.initialize_operations_radar_policy();

-- Preserve the proven eight-signal detector as the maximum safety envelope.
-- The new wrapper may tighten its existing windows, recalculate severity, and
-- add a reviewed default owner. It cannot widen beyond the tested 14/30/7-day
-- confirmation/document/payment boundaries.
alter function private.find_operational_exceptions(uuid)
  rename to find_operational_exceptions_v2;

create or replace function private.find_operational_exceptions(
  target_organization_id uuid
)
returns table (
  finding_dedupe_key text,
  finding_trip_id uuid,
  finding_exception_type text,
  finding_severity text,
  finding_source_entity_type text,
  finding_source_entity_id uuid,
  finding_title text,
  finding_summary text,
  finding_evidence jsonb,
  finding_due_at timestamptz,
  finding_assigned_to uuid
)
language sql
stable
set search_path = pg_catalog, public, private
as $$
  with policy as (
    select
      coalesce(config.confirmation_watch_days, 14) as confirmation_watch_days,
      coalesce(config.confirmation_critical_hours, 48)
        as confirmation_critical_hours,
      coalesce(config.confirmation_high_days, 7)
        as confirmation_high_days,
      coalesce(config.document_expiry_days, 30) as document_expiry_days,
      coalesce(config.document_high_days, 7) as document_high_days,
      coalesce(config.payment_due_days, 7) as payment_due_days,
      coalesce(config.payment_high_days, 2) as payment_high_days,
      coalesce(config.task_critical_hours, 24) as task_critical_hours,
      case
        when exists (
          select 1
          from public.memberships membership
          where membership.organization_id = target_organization_id
            and membership.user_id = config.default_assignee_id
            and membership.status = 'active'
        )
        then config.default_assignee_id
        else null
      end as default_assignee_id
    from (values (1)) singleton(value)
    left join public.operations_radar_policies config
      on config.organization_id = target_organization_id
  )
  select
    finding.finding_dedupe_key,
    finding.finding_trip_id,
    finding.finding_exception_type,
    case finding.finding_exception_type
      when 'booking_confirmation_at_risk' then
        case
          when finding.finding_due_at
            <= statement_timestamp()
              + make_interval(hours => policy.confirmation_critical_hours)
            then 'critical'
          when finding.finding_due_at
            <= statement_timestamp()
              + make_interval(days => policy.confirmation_high_days)
            then 'high'
          else 'medium'
        end
      when 'document_expiring' then
        case
          when (finding.finding_evidence ->> 'days_until_expiry')::integer < 0
            then 'critical'
          when (finding.finding_evidence ->> 'days_until_expiry')::integer
            <= policy.document_high_days
            then 'high'
          else 'medium'
        end
      when 'payment_due' then
        case
          when (finding.finding_evidence ->> 'due_at')::date < current_date
            then 'critical'
          when (finding.finding_evidence ->> 'due_at')::date
            <= current_date + policy.payment_high_days
            then 'high'
          else 'medium'
        end
      when 'operational_task_overdue' then
        case
          when finding.finding_due_at
            < statement_timestamp()
              - make_interval(hours => policy.task_critical_hours)
            then 'critical'
          else 'high'
        end
      else finding.finding_severity
    end,
    finding.finding_source_entity_type,
    finding.finding_source_entity_id,
    finding.finding_title,
    finding.finding_summary,
    finding.finding_evidence,
    finding.finding_due_at,
    coalesce(finding.finding_assigned_to, policy.default_assignee_id)
  from private.find_operational_exceptions_v2(
    target_organization_id
  ) finding
  cross join policy
  where
    (
      finding.finding_exception_type <> 'booking_confirmation_at_risk'
      or finding.finding_due_at
        <= statement_timestamp()
          + make_interval(days => policy.confirmation_watch_days)
    )
    and (
      finding.finding_exception_type <> 'document_expiring'
      or (finding.finding_evidence ->> 'days_until_expiry')::integer
        <= policy.document_expiry_days
    )
    and (
      finding.finding_exception_type <> 'payment_due'
      or (finding.finding_evidence ->> 'due_at')::date
        <= current_date + policy.payment_due_days
    );
$$;

revoke all on function private.find_operational_exceptions_v2(uuid)
  from public, anon, authenticated;
revoke all on function private.find_operational_exceptions(uuid)
  from public, anon, authenticated;

create or replace function public.upsert_operations_radar_policy(
  target_organization_id uuid,
  target_is_enabled boolean,
  target_scan_interval_minutes integer,
  target_confirmation_watch_days smallint,
  target_confirmation_critical_hours smallint,
  target_confirmation_high_days smallint,
  target_document_expiry_days smallint,
  target_document_high_days smallint,
  target_payment_due_days smallint,
  target_payment_high_days smallint,
  target_task_critical_hours smallint,
  target_default_assignee_id uuid default null
)
returns setof public.operations_radar_policies
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
      array['owner', 'admin', 'operations']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to configure Operations Radar.'
      using errcode = '42501';
  end if;

  if target_default_assignee_id is not null
    and not exists (
      select 1
      from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = target_default_assignee_id
        and membership.status = 'active'
    )
  then
    raise exception 'The default owner must be an active workspace member.'
      using errcode = '22023';
  end if;

  insert into public.operations_radar_policies (
    organization_id,
    is_enabled,
    scan_interval_minutes,
    confirmation_watch_days,
    confirmation_critical_hours,
    confirmation_high_days,
    document_expiry_days,
    document_high_days,
    payment_due_days,
    payment_high_days,
    task_critical_hours,
    default_assignee_id,
    next_run_at,
    updated_by
  )
  values (
    target_organization_id,
    target_is_enabled,
    target_scan_interval_minutes,
    target_confirmation_watch_days,
    target_confirmation_critical_hours,
    target_confirmation_high_days,
    target_document_expiry_days,
    target_document_high_days,
    target_payment_due_days,
    target_payment_high_days,
    target_task_critical_hours,
    target_default_assignee_id,
    changed_at,
    actor_id
  )
  on conflict (organization_id)
  do update set
    is_enabled = excluded.is_enabled,
    scan_interval_minutes = excluded.scan_interval_minutes,
    confirmation_watch_days = excluded.confirmation_watch_days,
    confirmation_critical_hours = excluded.confirmation_critical_hours,
    confirmation_high_days = excluded.confirmation_high_days,
    document_expiry_days = excluded.document_expiry_days,
    document_high_days = excluded.document_high_days,
    payment_due_days = excluded.payment_due_days,
    payment_high_days = excluded.payment_high_days,
    task_critical_hours = excluded.task_critical_hours,
    default_assignee_id = excluded.default_assignee_id,
    next_run_at = changed_at,
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
    'operations_radar_policy',
    target_organization_id,
    jsonb_build_object(
      'event', 'trip.operations_radar_policy_updated',
      'is_enabled', target_is_enabled,
      'scan_interval_minutes', target_scan_interval_minutes,
      'confirmation_watch_days', target_confirmation_watch_days,
      'document_expiry_days', target_document_expiry_days,
      'payment_due_days', target_payment_due_days,
      'task_critical_hours', target_task_critical_hours,
      'has_default_assignee', target_default_assignee_id is not null
    ),
    changed_at
  );

  return query
  select policy.*
  from public.operations_radar_policies policy
  where policy.organization_id = target_organization_id;
end;
$$;

revoke all on function public.upsert_operations_radar_policy(
  uuid,
  boolean,
  integer,
  smallint,
  smallint,
  smallint,
  smallint,
  smallint,
  smallint,
  smallint,
  smallint,
  uuid
) from public, anon;
grant execute on function public.upsert_operations_radar_policy(
  uuid,
  boolean,
  integer,
  smallint,
  smallint,
  smallint,
  smallint,
  smallint,
  smallint,
  smallint,
  smallint,
  uuid
) to authenticated;

-- The claim function is the durable scheduler boundary. It reaps abandoned
-- 15-minute leases, locks due policies with SKIP LOCKED, advances next_run_at,
-- and creates at most one active run per workspace.
create or replace function public.claim_operations_radar_runs(
  target_worker_id text,
  target_limit integer default 10,
  target_organization_id uuid default null,
  target_force boolean default false
)
returns table (
  run_id uuid,
  organization_id uuid,
  trigger_type text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  policy_record public.operations_radar_policies%rowtype;
  claimed_run_id uuid;
  claim_time timestamptz := statement_timestamp();
  bounded_limit integer := least(greatest(target_limit, 1), 25);
  claimed_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Operations Radar schedules are server-only.'
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

  update public.operations_radar_runs run
  set
    status = 'failed',
    finished_at = claim_time,
    error_code = 'lease_expired'
  where run.status = 'running'
    and run.started_at < claim_time - interval '15 minutes';

  for policy_record in
    select policy.*
    from public.operations_radar_policies policy
    where policy.is_enabled
      and (
        target_organization_id is null
        or policy.organization_id = target_organization_id
      )
      and (target_force or policy.next_run_at <= claim_time)
      and not exists (
        select 1
        from public.operations_radar_runs active_run
        where active_run.organization_id = policy.organization_id
          and active_run.status = 'running'
      )
    order by policy.next_run_at, policy.organization_id
    for update skip locked
    limit bounded_limit
  loop
    insert into public.operations_radar_runs (
      organization_id,
      trigger_type,
      scheduled_for,
      worker_id,
      policy_snapshot
    )
    values (
      policy_record.organization_id,
      case when target_force then 'operator' else 'scheduled' end,
      case when target_force then claim_time else policy_record.next_run_at end,
      target_worker_id,
      jsonb_build_object(
        'schema_version', 1,
        'scan_interval_minutes', policy_record.scan_interval_minutes,
        'confirmation_watch_days', policy_record.confirmation_watch_days,
        'confirmation_critical_hours',
          policy_record.confirmation_critical_hours,
        'confirmation_high_days', policy_record.confirmation_high_days,
        'document_expiry_days', policy_record.document_expiry_days,
        'document_high_days', policy_record.document_high_days,
        'payment_due_days', policy_record.payment_due_days,
        'payment_high_days', policy_record.payment_high_days,
        'task_critical_hours', policy_record.task_critical_hours,
        'has_default_assignee',
          policy_record.default_assignee_id is not null
      )
    )
    returning id into claimed_run_id;

    update public.operations_radar_policies policy
    set next_run_at =
      claim_time + make_interval(
        mins => policy_record.scan_interval_minutes
      )
    where policy.organization_id = policy_record.organization_id;

    run_id := claimed_run_id;
    organization_id := policy_record.organization_id;
    trigger_type := case when target_force then 'operator' else 'scheduled' end;
    return next;

    claimed_count := claimed_count + 1;
    exit when claimed_count >= bounded_limit;
  end loop;
end;
$$;

revoke all on function public.claim_operations_radar_runs(
  text,
  integer,
  uuid,
  boolean
) from public, anon, authenticated;
grant execute on function public.claim_operations_radar_runs(
  text,
  integer,
  uuid,
  boolean
) to service_role;

create or replace function public.settle_operations_radar_run(
  target_run_id uuid,
  target_worker_id text,
  target_status text,
  target_active_count bigint default null,
  target_critical_count bigint default null,
  target_resolved_count integer default null,
  target_error_code text default null
)
returns setof public.operations_radar_runs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_run public.operations_radar_runs%rowtype;
  settled_at timestamptz := statement_timestamp();
  normalized_error text := nullif(
    lower(regexp_replace(coalesce(target_error_code, ''), '[^a-z0-9_]', '_', 'g')),
    ''
  );
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Operations Radar settlement is server-only.'
      using errcode = '42501';
  end if;

  select run.*
  into current_run
  from public.operations_radar_runs run
  where run.id = target_run_id
  for update;

  if current_run.id is null
    or current_run.status <> 'running'
    or current_run.worker_id <> target_worker_id
  then
    raise exception 'This Operations Radar lease is not available.'
      using errcode = '55000';
  end if;

  if target_status = 'succeeded' then
    if target_active_count is null
      or target_critical_count is null
      or target_resolved_count is null
    then
      raise exception 'Successful runs require bounded result counts.'
        using errcode = '22023';
    end if;
    update public.operations_radar_runs run
    set
      status = 'succeeded',
      finished_at = settled_at,
      active_count = target_active_count,
      critical_count = target_critical_count,
      resolved_count = target_resolved_count
    where run.id = current_run.id;
  elsif target_status = 'failed' then
    if normalized_error is null
      or char_length(normalized_error) not between 3 and 80
    then
      raise exception 'Failed runs require a bounded error code.'
        using errcode = '22023';
    end if;
    update public.operations_radar_runs run
    set
      status = 'failed',
      finished_at = settled_at,
      error_code = left(normalized_error, 80)
    where run.id = current_run.id;
  else
    raise exception 'Unknown Operations Radar settlement state.'
      using errcode = '22023';
  end if;

  update public.operations_radar_policies policy
  set
    last_run_at = settled_at,
    last_run_status = target_status,
    next_run_at = case
      when target_status = 'failed'
        then least(policy.next_run_at, settled_at + interval '5 minutes')
      else policy.next_run_at
    end
  where policy.organization_id = current_run.organization_id;

  return query
  select run.*
  from public.operations_radar_runs run
  where run.id = current_run.id;
end;
$$;

revoke all on function public.settle_operations_radar_run(
  uuid,
  text,
  text,
  bigint,
  bigint,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.settle_operations_radar_run(
  uuid,
  text,
  text,
  bigint,
  bigint,
  integer,
  text
) to service_role;

-- Existing authenticated manual scans keep their authorization contract.
-- A service-role request may execute the same deterministic internal-only
-- scanner for a claimed run. The service role cannot settle a run unless it
-- also owns the exact worker lease.
create or replace function public.refresh_operational_exceptions(
  target_organization_id uuid
)
returns table (
  active_count bigint,
  critical_count bigint,
  resolved_count integer,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select auth.uid());
  is_service_worker boolean :=
    coalesce((select auth.role()) = 'service_role', false);
  scan_time timestamptz := statement_timestamp();
  cleared_count integer := 0;
begin
  if not is_service_worker
    and (
      actor_id is null
      or not public.meets_mfa_requirement()
      or not public.has_organization_role(
        target_organization_id,
        array[
          'owner',
          'admin',
          'trip_designer',
          'operations'
        ]::public.app_role[]
      )
    )
  then
    raise exception 'You do not have permission to refresh Operations Radar.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('operations-radar:' || target_organization_id::text)
  );

  insert into public.operational_exceptions as exception (
    organization_id,
    trip_id,
    dedupe_key,
    exception_type,
    severity,
    source_entity_type,
    source_entity_id,
    title,
    summary,
    evidence,
    due_at,
    assigned_to,
    detected_by,
    detected_at,
    last_seen_at
  )
  select
    target_organization_id,
    finding.finding_trip_id,
    finding.finding_dedupe_key,
    finding.finding_exception_type,
    finding.finding_severity,
    finding.finding_source_entity_type,
    finding.finding_source_entity_id,
    finding.finding_title,
    finding.finding_summary,
    finding.finding_evidence,
    finding.finding_due_at,
    finding.finding_assigned_to,
    'rules_engine',
    scan_time,
    scan_time
  from private.find_operational_exceptions(
    target_organization_id
  ) finding
  on conflict (organization_id, dedupe_key)
  do update set
    trip_id = excluded.trip_id,
    exception_type = excluded.exception_type,
    severity = excluded.severity,
    source_entity_type = excluded.source_entity_type,
    source_entity_id = excluded.source_entity_id,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    due_at = excluded.due_at,
    assigned_to = coalesce(exception.assigned_to, excluded.assigned_to),
    status = case
      when exception.status = 'resolved' then 'open'
      else exception.status
    end,
    detected_at = case
      when exception.status = 'resolved' then scan_time
      else exception.detected_at
    end,
    last_seen_at = scan_time,
    acknowledged_by = case
      when exception.status = 'resolved' then null
      else exception.acknowledged_by
    end,
    acknowledged_at = case
      when exception.status = 'resolved' then null
      else exception.acknowledged_at
    end,
    resolved_by = null,
    resolved_at = null,
    operator_note = case
      when exception.status = 'resolved' then null
      else exception.operator_note
    end;

  update public.operational_exceptions exception
  set
    status = 'resolved',
    resolved_by = null,
    resolved_at = scan_time,
    operator_note = 'Condition cleared by Operations Radar.'
  where exception.organization_id = target_organization_id
    and exception.detected_by = 'rules_engine'
    and exception.status in ('open', 'acknowledged')
    and not exists (
      select 1
      from private.find_operational_exceptions(
        target_organization_id
      ) finding
      where finding.finding_dedupe_key = exception.dedupe_key
    );
  get diagnostics cleared_count = row_count;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    metadata,
    created_at
  )
  values (
    target_organization_id,
    actor_id,
    'ai.tool_called',
    'operations_radar',
    jsonb_build_object(
      'event', 'trip.operations_radar_refreshed',
      'trigger', case
        when is_service_worker then 'durable_worker'
        else 'operator'
      end,
      'resolved_count', cleared_count,
      'detector_version', '2026.07.29.2'
    ),
    scan_time
  );

  return query
  select
    count(*) filter (
      where exception.status in ('open', 'acknowledged')
    ),
    count(*) filter (
      where exception.status in ('open', 'acknowledged')
        and exception.severity = 'critical'
    ),
    cleared_count,
    scan_time
  from public.operational_exceptions exception
  where exception.organization_id = target_organization_id;
end;
$$;

revoke all on function public.refresh_operational_exceptions(uuid)
  from public, anon;
grant execute on function public.refresh_operational_exceptions(uuid)
  to authenticated, service_role;
