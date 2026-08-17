-- Reorder one itinerary day without deleting customer-planning evidence.
-- The trip row is the serialization lock shared with item appends.

create function public.reorder_itinerary_item(
  target_organization_id uuid,
  target_trip_id uuid,
  target_itinerary_item_id uuid,
  target_direction text
)
returns table (
  itinerary_item_id uuid,
  day_number integer,
  item_position integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_item public.itinerary_items%rowtype;
  adjacent_item public.itinerary_items%rowtype;
  temporary_position integer;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
  ) then
    raise exception 'You do not have permission to plan this trip.';
  end if;

  if target_direction not in ('up', 'down') then
    raise exception 'The itinerary move direction is invalid.';
  end if;

  perform 1
  from public.trips
  where id = target_trip_id
    and organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'This trip is not available in this workspace.';
  end if;

  select item.*
  into current_item
  from public.itinerary_items item
  where item.id = target_itinerary_item_id
    and item.trip_id = target_trip_id
    and item.organization_id = target_organization_id;

  if not found then
    raise exception 'This itinerary item is not available in this trip.';
  end if;

  if target_direction = 'up' then
    select item.*
    into adjacent_item
    from public.itinerary_items item
    where item.trip_id = current_item.trip_id
      and item.day_number = current_item.day_number
      and item.position < current_item.position
    order by item.position desc
    limit 1;
  else
    select item.*
    into adjacent_item
    from public.itinerary_items item
    where item.trip_id = current_item.trip_id
      and item.day_number = current_item.day_number
      and item.position > current_item.position
    order by item.position
    limit 1;
  end if;

  if adjacent_item.id is not null then
    select coalesce(max(item.position), 0) + 1
    into temporary_position
    from public.itinerary_items item
    where item.trip_id = current_item.trip_id
      and item.day_number = current_item.day_number;

    update public.itinerary_items
    set position = temporary_position,
        updated_at = now()
    where id = current_item.id;

    update public.itinerary_items
    set position = current_item.position,
        updated_at = now()
    where id = adjacent_item.id;

    update public.itinerary_items
    set position = adjacent_item.position,
        updated_at = now()
    where id = current_item.id;
  end if;

  return query
  select item.id, item.day_number, item.position
  from public.itinerary_items item
  where item.trip_id = current_item.trip_id
    and item.day_number = current_item.day_number
  order by item.position, item.id;
end;
$$;

revoke all on function public.reorder_itinerary_item(
  uuid,
  uuid,
  uuid,
  text
) from public;

grant execute on function public.reorder_itinerary_item(
  uuid,
  uuid,
  uuid,
  text
) to authenticated;
