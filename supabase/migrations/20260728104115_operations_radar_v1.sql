-- Phase 16 v1: a tenant-scoped operations radar for objective trip risks.
-- Detection only changes internal exception records. Supplier communication,
-- booking commitments, payments, and document sharing remain approval-gated.

create table public.operational_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trip_id uuid not null,
  dedupe_key text not null
    check (char_length(dedupe_key) between 8 and 240),
  exception_type text not null
    check (
      exception_type in (
        'trip_dates_missing',
        'traveler_roster_empty',
        'booking_plan_empty',
        'booking_schedule_missing',
        'booking_confirmation_at_risk',
        'document_expiring',
        'operational_task_overdue'
      )
    ),
  severity text not null
    check (severity in ('medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved')),
  source_entity_type text not null
    check (source_entity_type in ('trip', 'booking', 'document', 'task')),
  source_entity_id uuid not null,
  title text not null
    check (char_length(title) between 1 and 180),
  summary text not null
    check (char_length(summary) between 1 and 1_000),
  evidence jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  assigned_to uuid,
  detected_by text not null default 'rules_engine'
    check (detected_by in ('rules_engine', 'aios_agent', 'human')),
  detected_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  operator_note text
    check (operator_note is null or char_length(operator_note) <= 500),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint operational_exceptions_organization_id_id_key
    unique (organization_id, id),
  constraint operational_exceptions_organization_dedupe_key_key
    unique (organization_id, dedupe_key),
  constraint operational_exceptions_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade,
  constraint operational_exceptions_assignee_same_organization_fkey
    foreign key (organization_id, assigned_to)
    references public.memberships (organization_id, user_id)
    on delete set null (assigned_to),
  constraint operational_exceptions_acknowledger_same_organization_fkey
    foreign key (organization_id, acknowledged_by)
    references public.memberships (organization_id, user_id)
    on delete set null (acknowledged_by),
  constraint operational_exceptions_resolver_same_organization_fkey
    foreign key (organization_id, resolved_by)
    references public.memberships (organization_id, user_id)
    on delete set null (resolved_by),
  constraint operational_exceptions_acknowledgement_contract_check
    check (
      (status <> 'acknowledged')
      or (acknowledged_at is not null and acknowledged_by is not null)
    ),
  constraint operational_exceptions_resolution_contract_check
    check (
      (status <> 'resolved')
      or resolved_at is not null
    )
);

create index operational_exceptions_active_queue_idx
  on public.operational_exceptions (
    organization_id,
    severity,
    due_at,
    last_seen_at desc
  )
  where status in ('open', 'acknowledged');
create index operational_exceptions_trip_status_idx
  on public.operational_exceptions (trip_id, status, last_seen_at desc);
create index operational_exceptions_assignee_active_idx
  on public.operational_exceptions (assigned_to, due_at)
  where assigned_to is not null
    and status in ('open', 'acknowledged');

create trigger operational_exceptions_set_updated_at
  before update on public.operational_exceptions
  for each row execute function public.set_updated_at();
create trigger operational_exceptions_prevent_organization_move
  before update on public.operational_exceptions
  for each row execute function private.prevent_organization_id_change();

alter table public.operational_exceptions enable row level security;

create policy "members may read operational exceptions"
  on public.operational_exceptions
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

-- The browser may inspect the queue but all state changes go through guarded
-- functions so actor evidence and lifecycle invariants cannot be bypassed.
revoke all on table public.operational_exceptions from public, anon;
grant select on table public.operational_exceptions to authenticated;
grant select, insert, update, delete
  on table public.operational_exceptions to service_role;

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
set search_path = pg_catalog, public
as $$
  select
    format('trip:%s:dates', trip.id),
    trip.id,
    'trip_dates_missing',
    case
      when trip.status = 'in_travel' then 'critical'
      when trip.status = 'confirmed' then 'high'
      else 'medium'
    end,
    'trip',
    trip.id,
    'Trip dates are incomplete',
    format(
      '%s needs both a start and end date before operations can sequence services safely.',
      trip.name
    ),
    jsonb_build_object(
      'status', trip.status,
      'start_date', trip.start_date,
      'end_date', trip.end_date
    ),
    coalesce(
      trip.start_date::timestamp at time zone 'UTC',
      case
        when trip.status = 'in_travel' then statement_timestamp()
        else null
      end
    ),
    trip.owner_id
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.status in ('draft', 'confirmed', 'in_travel')
    and (trip.start_date is null or trip.end_date is null)

  union all

  select
    format('trip:%s:traveler-roster', trip.id),
    trip.id,
    'traveler_roster_empty',
    case
      when trip.status = 'in_travel' then 'critical'
      when trip.status = 'confirmed' then 'high'
      else 'medium'
    end,
    'trip',
    trip.id,
    'Traveller roster is empty',
    format(
      '%s has no traveller record, so identity, preferences, and document readiness cannot be verified.',
      trip.name
    ),
    jsonb_build_object('status', trip.status),
    trip.start_date::timestamp at time zone 'UTC',
    trip.owner_id
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.status in ('draft', 'confirmed', 'in_travel')
    and not exists (
      select 1
      from public.travelers traveler
      where traveler.organization_id = trip.organization_id
        and traveler.trip_id = trip.id
    )

  union all

  select
    format('trip:%s:booking-plan', trip.id),
    trip.id,
    'booking_plan_empty',
    case
      when trip.status = 'in_travel' then 'critical'
      else 'high'
    end,
    'trip',
    trip.id,
    'No active booking plan',
    format(
      '%s is %s but has no active internal service booking records.',
      trip.name,
      replace(trip.status::text, '_', ' ')
    ),
    jsonb_build_object('status', trip.status),
    trip.start_date::timestamp at time zone 'UTC',
    trip.owner_id
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.status in ('confirmed', 'in_travel')
    and not exists (
      select 1
      from public.bookings booking
      where booking.organization_id = trip.organization_id
        and booking.trip_id = trip.id
        and booking.status <> 'cancelled'
    )

  union all

  select
    format('booking:%s:schedule', booking.id),
    trip.id,
    'booking_schedule_missing',
    case
      when trip.status = 'in_travel' then 'critical'
      when trip.status = 'confirmed' then 'high'
      else 'medium'
    end,
    'booking',
    booking.id,
    'Booking service time is missing',
    format(
      '%s has no service start time, so AIOS cannot place it on the operational timeline.',
      booking.title
    ),
    jsonb_build_object(
      'booking_id', booking.id,
      'booking_status', booking.status,
      'booking_type', booking.booking_type
    ),
    trip.start_date::timestamp at time zone 'UTC',
    trip.owner_id
  from public.bookings booking
  join public.trips trip
    on trip.organization_id = booking.organization_id
   and trip.id = booking.trip_id
  where booking.organization_id = target_organization_id
    and trip.status in ('draft', 'confirmed', 'in_travel')
    and booking.status <> 'cancelled'
    and booking.service_start_at is null

  union all

  select
    format('booking:%s:confirmation', booking.id),
    trip.id,
    'booking_confirmation_at_risk',
    case
      when booking.service_start_at <= statement_timestamp() + interval '48 hours'
        then 'critical'
      when booking.service_start_at <= statement_timestamp() + interval '7 days'
        then 'high'
      else 'medium'
    end,
    'booking',
    booking.id,
    'Supplier confirmation is at risk',
    format(
      '%s is not confirmed and service begins %s.',
      booking.title,
      to_char(booking.service_start_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
    ),
    jsonb_build_object(
      'booking_id', booking.id,
      'booking_status', booking.status,
      'booking_type', booking.booking_type,
      'service_start_at', booking.service_start_at
    ),
    booking.service_start_at,
    trip.owner_id
  from public.bookings booking
  join public.trips trip
    on trip.organization_id = booking.organization_id
   and trip.id = booking.trip_id
  where booking.organization_id = target_organization_id
    and trip.status in ('draft', 'confirmed', 'in_travel')
    and booking.status in ('draft', 'requested', 'failed')
    and booking.service_start_at is not null
    and booking.service_start_at <= statement_timestamp() + interval '14 days'

  union all

  select
    format('document:%s:expiry', document.id),
    trip.id,
    'document_expiring',
    case
      when document.expires_at < current_date then 'critical'
      when document.expires_at <= current_date + 7 then 'high'
      else 'medium'
    end,
    'document',
    document.id,
    case
      when document.expires_at < current_date then 'Travel document has expired'
      else 'Travel document expires soon'
    end,
    format(
      '%s %s on %s.',
      document.file_name,
      case
        when document.expires_at < current_date then 'expired'
        else 'expires'
      end,
      document.expires_at
    ),
    jsonb_build_object(
      'document_id', document.id,
      'expires_at', document.expires_at,
      'days_until_expiry', document.expires_at - current_date
    ),
    document.expires_at::timestamp at time zone 'UTC',
    trip.owner_id
  from public.documents document
  join public.trips trip
    on trip.organization_id = document.organization_id
   and trip.id = document.trip_id
  where document.organization_id = target_organization_id
    and trip.status in ('draft', 'confirmed', 'in_travel')
    and document.expires_at is not null
    and document.expires_at <= current_date + 30

  union all

  select
    format('task:%s:overdue', task.id),
    trip.id,
    'operational_task_overdue',
    case
      when task.due_at < statement_timestamp() - interval '24 hours'
        then 'critical'
      else 'high'
    end,
    'task',
    task.id,
    'Operational task is overdue',
    format('%s passed its internal deadline.', task.title),
    jsonb_build_object(
      'task_id', task.id,
      'task_status', task.status,
      'due_at', task.due_at
    ),
    task.due_at,
    coalesce(task.assignee_id, trip.owner_id)
  from public.tasks task
  join public.trips trip
    on trip.organization_id = task.organization_id
   and trip.id = task.trip_id
  where task.organization_id = target_organization_id
    and trip.status in ('draft', 'confirmed', 'in_travel')
    and task.status in ('open', 'in_progress')
    and task.due_at < statement_timestamp();
$$;

revoke all on function private.find_operational_exceptions(uuid)
  from public, anon, authenticated;

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
  scan_time timestamptz := statement_timestamp();
  cleared_count integer := 0;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'trip_designer', 'operations']::public.app_role[]
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
  from private.find_operational_exceptions(target_organization_id) finding
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
      from private.find_operational_exceptions(target_organization_id) finding
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
      'resolved_count', cleared_count,
      'detector_version', '2026.07.28.1'
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
  to authenticated;

create or replace function public.set_operational_exception_status(
  target_organization_id uuid,
  target_exception_id uuid,
  target_status text,
  target_note text default null
)
returns setof public.operational_exceptions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_exception public.operational_exceptions%rowtype;
  changed_at timestamptz := statement_timestamp();
  normalized_note text := nullif(btrim(target_note), '');
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'trip_designer', 'operations']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to update this exception.'
      using errcode = '42501';
  end if;
  if target_status not in ('open', 'acknowledged', 'resolved') then
    raise exception 'That exception status is not supported.'
      using errcode = '22023';
  end if;
  if target_status = 'resolved' and normalized_note is null then
    raise exception 'Add a short resolution note before resolving this exception.'
      using errcode = '23514';
  end if;
  if normalized_note is not null and char_length(normalized_note) > 500 then
    raise exception 'Exception notes must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  select exception.*
  into current_exception
  from public.operational_exceptions exception
  where exception.organization_id = target_organization_id
    and exception.id = target_exception_id
  for update;
  if not found then
    raise exception 'That operational exception is not available.'
      using errcode = 'P0002';
  end if;

  update public.operational_exceptions
  set
    status = target_status,
    acknowledged_by = case
      when target_status = 'acknowledged' then actor_id
      when target_status = 'open' then null
      else acknowledged_by
    end,
    acknowledged_at = case
      when target_status = 'acknowledged' then changed_at
      when target_status = 'open' then null
      else acknowledged_at
    end,
    resolved_by = case
      when target_status = 'resolved' then actor_id
      else null
    end,
    resolved_at = case
      when target_status = 'resolved' then changed_at
      else null
    end,
    operator_note = normalized_note
  where id = current_exception.id;

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
    'operational_exception',
    current_exception.id,
    jsonb_build_object(
      'event', 'trip.operational_exception_status_changed',
      'from_status', current_exception.status,
      'to_status', target_status,
      'trip_id', current_exception.trip_id,
      'note', normalized_note
    ),
    changed_at
  );

  return query
  select exception.*
  from public.operational_exceptions exception
  where exception.id = current_exception.id;
end;
$$;

revoke all on function public.set_operational_exception_status(
  uuid,
  uuid,
  text,
  text
) from public, anon;
grant execute on function public.set_operational_exception_status(
  uuid,
  uuid,
  text,
  text
) to authenticated;
