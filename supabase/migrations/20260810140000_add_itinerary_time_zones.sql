-- Make travel-planning times explicit. Existing timed rows remain nullable so
-- their historical workstation time zone is not guessed; new timed writes are
-- guarded by a trigger and the append RPC converts local wall time in Postgres.

alter table public.trips
  add column time_zone text;

alter table public.trips
  add constraint trips_time_zone_shape_check
  check (
    time_zone is null
    or (
      time_zone = btrim(time_zone)
      and char_length(time_zone) between 1 and 80
    )
  ) not valid;

alter table public.trips
  validate constraint trips_time_zone_shape_check;

alter table public.itinerary_items
  add column time_zone text;

alter table public.itinerary_items
  add constraint itinerary_items_time_zone_shape_check
  check (
    time_zone is null
    or (
      time_zone = btrim(time_zone)
      and char_length(time_zone) between 1 and 80
    )
  ) not valid;

alter table public.itinerary_items
  validate constraint itinerary_items_time_zone_shape_check;

create function public.validate_iana_time_zone()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.time_zone is not null
    and not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = new.time_zone
    ) then
    raise exception 'Use a valid IANA time zone.';
  end if;

  return new;
end;
$$;

create trigger trips_validate_iana_time_zone
before insert or update of time_zone on public.trips
for each row execute function public.validate_iana_time_zone();

create trigger itinerary_items_validate_iana_time_zone
before insert or update of time_zone on public.itinerary_items
for each row execute function public.validate_iana_time_zone();

create function public.require_new_timed_itinerary_zone()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.starts_at is not null and new.time_zone is null then
    if tg_op = 'INSERT' then
      raise exception 'A timed itinerary item requires an IANA time zone.';
    elsif new.starts_at is distinct from old.starts_at
      or new.time_zone is distinct from old.time_zone then
      raise exception 'A timed itinerary item requires an IANA time zone.';
    end if;
  end if;

  return new;
end;
$$;

create trigger itinerary_items_require_new_timed_zone
before insert or update of starts_at, time_zone on public.itinerary_items
for each row execute function public.require_new_timed_itinerary_zone();

revoke all on function public.validate_iana_time_zone() from public;
revoke all on function public.require_new_timed_itinerary_zone() from public;

drop function public.append_itinerary_item(
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz
);

create function public.append_itinerary_item(
  target_organization_id uuid,
  target_trip_id uuid,
  target_day_number integer,
  target_item_type text,
  target_title text,
  target_location_name text,
  target_notes text,
  target_starts_at_local timestamp without time zone,
  target_ends_at_local timestamp without time zone,
  target_time_zone text
)
returns table (itinerary_item_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_position integer;
  created_item_id uuid;
  trip_time_zone text;
  effective_time_zone text;
  converted_starts_at timestamptz;
  converted_ends_at timestamptz;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
  ) then
    raise exception 'You do not have permission to plan this trip.';
  end if;

  select trip.time_zone
  into trip_time_zone
  from public.trips trip
  where trip.id = target_trip_id
    and trip.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'This trip is not available in this workspace.';
  end if;

  effective_time_zone := coalesce(
    nullif(btrim(target_time_zone), ''),
    trip_time_zone
  );

  if effective_time_zone is not null
    and not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = effective_time_zone
    ) then
    raise exception 'Use a valid IANA time zone.';
  end if;

  if target_ends_at_local is not null and target_starts_at_local is null then
    raise exception 'An itinerary end time requires a start time.';
  end if;

  if target_starts_at_local is not null and effective_time_zone is null then
    raise exception 'A timed itinerary item requires an IANA time zone.';
  end if;

  if target_starts_at_local is not null then
    converted_starts_at := target_starts_at_local at time zone effective_time_zone;
    if converted_starts_at at time zone effective_time_zone
      <> target_starts_at_local then
      raise exception 'The itinerary start time does not exist in that time zone.';
    end if;
  end if;

  if target_ends_at_local is not null then
    converted_ends_at := target_ends_at_local at time zone effective_time_zone;
    if converted_ends_at at time zone effective_time_zone
      <> target_ends_at_local then
      raise exception 'The itinerary end time does not exist in that time zone.';
    end if;
  end if;

  if converted_starts_at is not null
    and converted_ends_at is not null
    and converted_ends_at <= converted_starts_at then
    raise exception 'The itinerary end time must be after its start time.';
  end if;

  select coalesce(max(item.position) + 1, 0)
  into next_position
  from public.itinerary_items item
  where item.trip_id = target_trip_id
    and item.day_number = target_day_number;

  insert into public.itinerary_items (
    organization_id,
    trip_id,
    day_number,
    position,
    item_type,
    title,
    starts_at,
    ends_at,
    time_zone,
    location,
    content
  ) values (
    target_organization_id,
    target_trip_id,
    target_day_number,
    next_position,
    target_item_type,
    target_title,
    converted_starts_at,
    converted_ends_at,
    effective_time_zone,
    case
      when target_location_name is null then '{}'::jsonb
      else jsonb_build_object('name', target_location_name)
    end,
    case
      when target_notes is null then '{}'::jsonb
      else jsonb_build_object('notes', target_notes)
    end
  )
  returning id into created_item_id;

  return query select created_item_id;
end;
$$;

revoke all on function public.append_itinerary_item(
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  timestamp without time zone,
  timestamp without time zone,
  text
) from public;

grant execute on function public.append_itinerary_item(
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  timestamp without time zone,
  timestamp without time zone,
  text
) to authenticated;
