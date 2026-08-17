-- Let the guarded itinerary append path persist optional planning times while
-- preserving tenant authorization and concurrency-safe day positioning.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'itinerary_items_time_order_check'
      and conrelid = 'public.itinerary_items'::regclass
  ) then
    alter table public.itinerary_items
      add constraint itinerary_items_time_order_check
      check (
        (starts_at is null and ends_at is null)
        or (starts_at is not null and (ends_at is null or ends_at > starts_at))
      ) not valid;
  end if;
end
$$;

alter table public.itinerary_items
  validate constraint itinerary_items_time_order_check;

drop function if exists public.append_itinerary_item(
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  text
);

create function public.append_itinerary_item(
  target_organization_id uuid,
  target_trip_id uuid,
  target_day_number integer,
  target_item_type text,
  target_title text,
  target_location_name text,
  target_notes text,
  target_starts_at timestamptz,
  target_ends_at timestamptz
)
returns table (itinerary_item_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_position integer;
  created_item_id uuid;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
  ) then
    raise exception 'You do not have permission to plan this trip.';
  end if;

  if target_ends_at is not null and target_starts_at is null then
    raise exception 'An itinerary end time requires a start time.';
  end if;

  if target_starts_at is not null
    and target_ends_at is not null
    and target_ends_at <= target_starts_at then
    raise exception 'The itinerary end time must be after its start time.';
  end if;

  perform 1
  from public.trips
  where id = target_trip_id
    and organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'This trip is not available in this workspace.';
  end if;

  select coalesce(max(position) + 1, 0)
  into next_position
  from public.itinerary_items
  where trip_id = target_trip_id
    and day_number = target_day_number;

  insert into public.itinerary_items (
    organization_id,
    trip_id,
    day_number,
    position,
    item_type,
    title,
    starts_at,
    ends_at,
    location,
    content
  ) values (
    target_organization_id,
    target_trip_id,
    target_day_number,
    next_position,
    target_item_type,
    target_title,
    target_starts_at,
    target_ends_at,
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
  timestamptz,
  timestamptz
) from public;

grant execute on function public.append_itinerary_item(
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) to authenticated;
