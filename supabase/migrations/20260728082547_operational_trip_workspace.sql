-- Phase 14: turn won opportunities into governed operational trips.
-- This migration deliberately reuses the existing trip-planning records so
-- itinerary and operations teams share one tenant-scoped source of truth.

alter table public.trips
  add column destination text
    check (destination is null or char_length(destination) between 1 and 180),
  add column operations_notes text
    check (operations_notes is null or char_length(operations_notes) <= 5_000),
  add column converted_at timestamptz,
  add column converted_by uuid;

alter table public.trips
  add constraint trips_converted_by_same_organization_fkey
    foreign key (organization_id, converted_by)
    references public.memberships (organization_id, user_id)
    on delete set null (converted_by);

create unique index trips_one_per_deal_idx
  on public.trips (deal_id)
  where deal_id is not null;
create index trips_converted_by_idx
  on public.trips (converted_by)
  where converted_by is not null;

create unique index travelers_trip_contact_unique_idx
  on public.travelers (trip_id, contact_id)
  where contact_id is not null;

alter table public.bookings
  add column title text not null default 'Travel service'
    check (char_length(title) between 1 and 180);

alter table public.tasks
  add column trip_id uuid;
alter table public.tasks
  add constraint tasks_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade;
create index tasks_trip_status_due_idx
  on public.tasks (trip_id, status, due_at)
  where trip_id is not null;

alter table public.activity_events
  add column trip_id uuid;
alter table public.activity_events
  add constraint activity_events_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade;
create index activity_events_trip_created_idx
  on public.activity_events (trip_id, created_at desc)
  where trip_id is not null;

alter table public.activity_events
  drop constraint activity_events_activity_type_check,
  add constraint activity_events_activity_type_check
  check (
    activity_type in (
      'note',
      'contact_created',
      'contact_preferences_updated',
      'contact_owner_changed',
      'contact_merged',
      'company_created',
      'deal_created',
      'deal_stage_changed',
      'deal_commercial_plan_updated',
      'deal_response_recorded',
      'deal_sla_escalated',
      'lead_captured',
      'document_uploaded',
      'qualification_checklist_applied',
      'qualification_check_updated',
      'follow_up_sequence_applied',
      'task_created',
      'task_status_changed',
      'conversation_sla_updated',
      'conversation_sla_escalated',
      'message_draft_created',
      'trip_converted',
      'trip_updated',
      'trip_status_changed',
      'traveler_added',
      'booking_created',
      'booking_status_changed',
      'trip_document_uploaded',
      'ai_observation'
    )
  );

create table public.trip_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trip_id uuid not null,
  from_status public.trip_status,
  to_status public.trip_status not null,
  changed_by uuid,
  change_source text not null default 'human'
    check (change_source in ('human', 'conversion', 'aios')),
  note text check (note is null or char_length(note) <= 500),
  changed_at timestamptz not null default statement_timestamp(),
  constraint trip_status_history_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade,
  constraint trip_status_history_actor_same_organization_fkey
    foreign key (organization_id, changed_by)
    references public.memberships (organization_id, user_id)
    on delete set null (changed_by)
);

create index trip_status_history_trip_changed_idx
  on public.trip_status_history (trip_id, changed_at desc);
create index trip_status_history_actor_idx
  on public.trip_status_history (changed_by)
  where changed_by is not null;

alter table public.trip_status_history enable row level security;

create policy "members may read trip status history"
  on public.trip_status_history
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

-- Status history is append-only and can only be written by the guarded
-- lifecycle functions below.
revoke all on table public.trip_status_history from public, anon;
grant select on table public.trip_status_history to authenticated;
grant select, insert, update, delete on table public.trip_status_history
  to service_role;

create trigger trip_status_history_prevent_organization_move
  before update on public.trip_status_history
  for each row execute function private.prevent_organization_id_change();

create or replace function private.enforce_trip_status_transition_path()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status is distinct from old.status
    and coalesce(
      current_setting('aios.allowed_trip_status_transition', true),
      'false'
    ) <> 'true'
  then
    raise exception 'Use the governed trip status workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_trip_status_transition_path()
  from public, anon;

create trigger trips_enforce_status_transition
  before update of status on public.trips
  for each row execute function private.enforce_trip_status_transition_path();

create or replace function public.convert_won_deal_to_trip(
  target_organization_id uuid,
  target_deal_id uuid
)
returns setof public.trips
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_deal public.deals%rowtype;
  current_contact public.contacts%rowtype;
  current_trip public.trips%rowtype;
  accepted_quote_id uuid;
  previous_status public.trip_status;
  conversion_time timestamptz := statement_timestamp();
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to convert this opportunity.'
      using errcode = '42501';
  end if;

  select deal.*
  into current_deal
  from public.deals deal
  where deal.organization_id = target_organization_id
    and deal.id = target_deal_id
    and deal.archived_at is null
  for update;
  if not found then
    raise exception 'That opportunity is not available.'
      using errcode = 'P0002';
  end if;
  if current_deal.stage <> 'won' then
    raise exception 'Only a won opportunity can become an operational trip.'
      using errcode = '23514';
  end if;
  if current_deal.contact_id is null then
    raise exception 'A won opportunity must have a lead traveller.'
      using errcode = '23514';
  end if;

  select contact.*
  into current_contact
  from public.contacts contact
  where contact.organization_id = target_organization_id
    and contact.id = current_deal.contact_id
    and contact.archived_at is null;
  if not found then
    raise exception 'The lead traveller is not available.'
      using errcode = 'P0002';
  end if;

  select quote.id
  into accepted_quote_id
  from public.quotes quote
  where quote.organization_id = target_organization_id
    and quote.deal_id = target_deal_id
    and quote.status = 'accepted'
  order by quote.accepted_at desc nulls last, quote.updated_at desc
  limit 1;

  select trip.*
  into current_trip
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.deal_id = target_deal_id
  for update;

  if not found then
    insert into public.trips (
      organization_id,
      deal_id,
      quote_id,
      owner_id,
      name,
      status,
      currency,
      destination,
      converted_at,
      converted_by
    )
    values (
      target_organization_id,
      current_deal.id,
      accepted_quote_id,
      current_deal.owner_id,
      current_deal.title,
      'confirmed',
      current_deal.currency,
      current_deal.destination,
      conversion_time,
      actor_id
    )
    returning * into current_trip;
    previous_status := null;
  else
    previous_status := current_trip.status;
    if current_trip.status = 'draft' then
      perform set_config('aios.allowed_trip_status_transition', 'true', true);
      update public.trips
      set
        status = 'confirmed',
        quote_id = coalesce(quote_id, accepted_quote_id),
        owner_id = coalesce(owner_id, current_deal.owner_id),
        destination = coalesce(destination, current_deal.destination),
        converted_at = coalesce(converted_at, conversion_time),
        converted_by = coalesce(converted_by, actor_id)
      where id = current_trip.id
      returning * into current_trip;
    elsif current_trip.converted_at is null then
      update public.trips
      set
        quote_id = coalesce(quote_id, accepted_quote_id),
        owner_id = coalesce(owner_id, current_deal.owner_id),
        destination = coalesce(destination, current_deal.destination),
        converted_at = conversion_time,
        converted_by = actor_id
      where id = current_trip.id
      returning * into current_trip;
    end if;
  end if;

  insert into public.travelers (
    organization_id,
    trip_id,
    contact_id,
    first_name,
    last_name,
    email,
    phone,
    role
  )
  values (
    target_organization_id,
    current_trip.id,
    current_contact.id,
    current_contact.first_name,
    current_contact.last_name,
    current_contact.email,
    current_contact.phone,
    'lead_traveler'
  )
  on conflict (trip_id, contact_id) where contact_id is not null do nothing;

  if previous_status is null or previous_status = 'draft' then
    insert into public.trip_status_history (
      organization_id,
      trip_id,
      from_status,
      to_status,
      changed_by,
      change_source,
      note
    )
    values (
      target_organization_id,
      current_trip.id,
      previous_status,
      'confirmed',
      actor_id,
      'conversion',
      'Created from won opportunity'
    );
  end if;

  if current_trip.converted_at = conversion_time then
    insert into public.activity_events (
      organization_id,
      contact_id,
      deal_id,
      trip_id,
      actor_id,
      activity_type,
      body,
      metadata
    )
    values (
      target_organization_id,
      current_deal.contact_id,
      current_deal.id,
      current_trip.id,
      actor_id,
      'trip_converted',
      format('Won opportunity converted to operational trip: %s', current_trip.name),
      jsonb_build_object('status', current_trip.status)
    );

    insert into public.audit_events (
      organization_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    )
    values (
      target_organization_id,
      actor_id,
      'record.created',
      'trip',
      current_trip.id,
      jsonb_build_object(
        'event',
        'trip.converted_from_won_deal',
        'deal_id',
        current_deal.id
      )
    );
  end if;

  return query
  select trip.*
  from public.trips trip
  where trip.id = current_trip.id;
end;
$$;

revoke all on function public.convert_won_deal_to_trip(uuid, uuid)
  from public, anon;
grant execute on function public.convert_won_deal_to_trip(uuid, uuid)
  to authenticated;

create or replace function public.transition_trip_status(
  target_organization_id uuid,
  target_trip_id uuid,
  target_status public.trip_status,
  target_note text default null
)
returns setof public.trips
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_trip public.trips%rowtype;
  current_contact_id uuid;
  changed_at timestamptz := statement_timestamp();
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'trip_designer', 'operations']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to move this trip.'
      using errcode = '42501';
  end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then
    raise exception 'Trip status notes must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  select trip.*
  into current_trip
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.id = target_trip_id
  for update;
  if not found then
    raise exception 'That trip is not available.'
      using errcode = 'P0002';
  end if;
  if current_trip.status = target_status then
    return query
    select trip.* from public.trips trip where trip.id = current_trip.id;
    return;
  end if;

  if not (
    (current_trip.status = 'draft' and target_status in ('confirmed', 'cancelled'))
    or (current_trip.status = 'confirmed' and target_status in ('in_travel', 'cancelled'))
    or (current_trip.status = 'in_travel' and target_status in ('completed', 'cancelled'))
  ) then
    raise exception 'That trip status transition is not allowed.'
      using errcode = '23514';
  end if;
  if target_status = 'in_travel'
    and current_trip.start_date is null
  then
    raise exception 'Set the trip start date before travel begins.'
      using errcode = '23514';
  end if;

  perform set_config('aios.allowed_trip_status_transition', 'true', true);
  update public.trips
  set status = target_status
  where id = current_trip.id;

  insert into public.trip_status_history (
    organization_id,
    trip_id,
    from_status,
    to_status,
    changed_by,
    change_source,
    note,
    changed_at
  )
  values (
    target_organization_id,
    current_trip.id,
    current_trip.status,
    target_status,
    actor_id,
    'human',
    nullif(btrim(target_note), ''),
    changed_at
  );

  select deal.contact_id
  into current_contact_id
  from public.deals deal
  where deal.organization_id = target_organization_id
    and deal.id = current_trip.deal_id;

  insert into public.activity_events (
    organization_id,
    contact_id,
    deal_id,
    trip_id,
    actor_id,
    activity_type,
    body,
    metadata,
    created_at
  )
  values (
    target_organization_id,
    current_contact_id,
    current_trip.deal_id,
    current_trip.id,
    actor_id,
    'trip_status_changed',
    format('Trip moved from %s to %s.', current_trip.status, target_status),
    jsonb_build_object(
      'from_status',
      current_trip.status,
      'to_status',
      target_status,
      'note',
      nullif(btrim(target_note), '')
    ),
    changed_at
  );

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
    'trip',
    current_trip.id,
    jsonb_build_object(
      'event',
      'trip.status_changed',
      'from_status',
      current_trip.status,
      'to_status',
      target_status
    ),
    changed_at
  );

  return query
  select trip.* from public.trips trip where trip.id = current_trip.id;
end;
$$;

revoke all on function public.transition_trip_status(
  uuid,
  uuid,
  public.trip_status,
  text
) from public, anon;
grant execute on function public.transition_trip_status(
  uuid,
  uuid,
  public.trip_status,
  text
) to authenticated;

alter table public.bookings
  add constraint bookings_confirmation_contract_check
  check (
    status <> 'confirmed'
    or (
      nullif(btrim(confirmation_reference), '') is not null
      and confirmed_at is not null
    )
  );

create or replace function private.enforce_booking_status_transition_path()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status is distinct from old.status
    and coalesce(
      current_setting('aios.allowed_booking_status_transition', true),
      'false'
    ) <> 'true'
  then
    raise exception 'Use the governed booking status workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_booking_status_transition_path()
  from public, anon;

create trigger bookings_enforce_status_transition
  before update of status on public.bookings
  for each row execute function private.enforce_booking_status_transition_path();

create or replace function public.transition_booking_status(
  target_organization_id uuid,
  target_trip_id uuid,
  target_booking_id uuid,
  target_status public.booking_status,
  target_confirmation_reference text default null
)
returns setof public.bookings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_booking public.bookings%rowtype;
  current_trip public.trips%rowtype;
  effective_confirmation_reference text;
  changed_at timestamptz := statement_timestamp();
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'trip_designer', 'operations', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to move this booking.'
      using errcode = '42501';
  end if;
  if target_confirmation_reference is not null
    and char_length(btrim(target_confirmation_reference)) > 180
  then
    raise exception 'Confirmation references must be 180 characters or fewer.'
      using errcode = '22023';
  end if;

  select booking.*
  into current_booking
  from public.bookings booking
  where booking.organization_id = target_organization_id
    and booking.trip_id = target_trip_id
    and booking.id = target_booking_id
  for update;
  if not found then
    raise exception 'That booking is not available.'
      using errcode = 'P0002';
  end if;
  if current_booking.status = target_status then
    return query
    select booking.*
    from public.bookings booking
    where booking.id = current_booking.id;
    return;
  end if;

  if not (
    (current_booking.status = 'draft' and target_status in ('requested', 'cancelled'))
    or (current_booking.status = 'requested' and target_status in ('confirmed', 'cancelled', 'failed'))
    or (current_booking.status = 'confirmed' and target_status = 'cancelled')
    or (current_booking.status = 'failed' and target_status in ('draft', 'cancelled'))
  ) then
    raise exception 'That booking status transition is not allowed.'
      using errcode = '23514';
  end if;

  effective_confirmation_reference := coalesce(
    nullif(btrim(target_confirmation_reference), ''),
    current_booking.confirmation_reference
  );
  if target_status = 'confirmed'
    and effective_confirmation_reference is null
  then
    raise exception 'Add the supplier confirmation reference before confirming.'
      using errcode = '23514';
  end if;

  perform set_config('aios.allowed_booking_status_transition', 'true', true);
  update public.bookings
  set
    status = target_status,
    confirmation_reference = effective_confirmation_reference,
    confirmed_at = case
      when target_status = 'confirmed' then
        coalesce(current_booking.confirmed_at, changed_at)
      else current_booking.confirmed_at
    end
  where id = current_booking.id;

  select trip.*
  into current_trip
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.id = target_trip_id;

  insert into public.activity_events (
    organization_id,
    deal_id,
    trip_id,
    actor_id,
    activity_type,
    body,
    metadata,
    created_at
  )
  values (
    target_organization_id,
    current_trip.deal_id,
    target_trip_id,
    actor_id,
    'booking_status_changed',
    format(
      'Booking moved from %s to %s: %s',
      current_booking.status,
      target_status,
      current_booking.title
    ),
    jsonb_build_object(
      'booking_id',
      current_booking.id,
      'from_status',
      current_booking.status,
      'to_status',
      target_status
    ),
    changed_at
  );

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
    'booking',
    current_booking.id,
    jsonb_build_object(
      'event',
      'trip.booking_status_updated',
      'trip_id',
      target_trip_id,
      'from_status',
      current_booking.status,
      'to_status',
      target_status
    ),
    changed_at
  );

  return query
  select booking.*
  from public.bookings booking
  where booking.id = current_booking.id;
end;
$$;

revoke all on function public.transition_booking_status(
  uuid,
  uuid,
  uuid,
  public.booking_status,
  text
) from public, anon;
grant execute on function public.transition_booking_status(
  uuid,
  uuid,
  uuid,
  public.booking_status,
  text
) to authenticated;

create or replace function public.record_trip_document(
  target_organization_id uuid,
  target_trip_id uuid,
  target_document_id uuid,
  target_storage_path text,
  target_file_name text,
  target_mime_type text,
  target_byte_size bigint,
  target_expires_at date default null
)
returns setof public.documents
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  actor_id uuid := (select auth.uid());
  current_trip public.trips%rowtype;
  created_document public.documents%rowtype;
  expected_prefix text;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to add trip documents.'
      using errcode = '42501';
  end if;

  select trip.*
  into current_trip
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.id = target_trip_id;
  if not found then
    raise exception 'That trip is not available.'
      using errcode = 'P0002';
  end if;

  expected_prefix := target_organization_id::text || '/' || target_document_id::text || '/';
  if target_storage_path not like expected_prefix || '%'
    or char_length(target_file_name) not between 1 and 300
    or target_byte_size < 1
    or target_byte_size > 15728640
    or target_mime_type not in (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif'
    )
  then
    raise exception 'The trip document metadata is invalid.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'travel-documents'
      and object.name = target_storage_path
      and object.owner_id = actor_id::text
  ) then
    raise exception 'The private trip document has not been uploaded.'
      using errcode = '22023';
  end if;

  insert into public.documents (
    id,
    organization_id,
    trip_id,
    uploaded_by,
    storage_path,
    file_name,
    mime_type,
    byte_size,
    sensitivity,
    expires_at
  )
  values (
    target_document_id,
    target_organization_id,
    target_trip_id,
    actor_id,
    target_storage_path,
    target_file_name,
    target_mime_type,
    target_byte_size,
    'normal',
    target_expires_at
  )
  returning * into created_document;

  insert into public.activity_events (
    organization_id,
    deal_id,
    trip_id,
    actor_id,
    activity_type,
    body,
    metadata
  )
  values (
    target_organization_id,
    current_trip.deal_id,
    current_trip.id,
    actor_id,
    'trip_document_uploaded',
    format('Private trip document uploaded: %s', target_file_name),
    jsonb_build_object(
      'document_id',
      created_document.id,
      'expires_at',
      target_expires_at
    )
  );

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_organization_id,
    actor_id,
    'record.created',
    'document',
    created_document.id,
    jsonb_build_object(
      'event',
      'trip.document_uploaded',
      'trip_id',
      current_trip.id,
      'mime_type',
      target_mime_type,
      'byte_size',
      target_byte_size
    )
  );

  return next created_document;
end;
$$;

revoke all on function public.record_trip_document(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  date
) from public, anon;
grant execute on function public.record_trip_document(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  date
) to authenticated;

-- Post-April 2026 Supabase projects do not automatically grant Data API
-- privileges for newly created public tables.
grant select on table public.trip_status_history to authenticated;
