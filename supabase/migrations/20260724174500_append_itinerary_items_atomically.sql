-- Serialize additions per trip so concurrent planners cannot claim the same
-- day position. The function obeys RLS and runs as the calling user.
create or replace function public.append_itinerary_item(
  target_organization_id uuid,
  target_trip_id uuid,
  target_day_number integer,
  target_item_type text,
  target_title text,
  target_location_name text,
  target_notes text
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

  perform 1 from public.trips
  where id = target_trip_id and organization_id = target_organization_id
  for update;
  if not found then
    raise exception 'This trip is not available in this workspace.';
  end if;

  select coalesce(max(position) + 1, 0) into next_position
  from public.itinerary_items
  where trip_id = target_trip_id and day_number = target_day_number;

  insert into public.itinerary_items (
    organization_id, trip_id, day_number, position, item_type, title, location, content
  ) values (
    target_organization_id, target_trip_id, target_day_number, next_position,
    target_item_type, target_title,
    case when target_location_name is null then '{}'::jsonb else jsonb_build_object('name', target_location_name) end,
    case when target_notes is null then '{}'::jsonb else jsonb_build_object('notes', target_notes) end
  ) returning id into created_item_id;

  return query select created_item_id;
end;
$$;

revoke all on function public.append_itinerary_item(uuid, uuid, integer, text, text, text, text) from public;
grant execute on function public.append_itinerary_item(uuid, uuid, integer, text, text, text, text) to authenticated;
