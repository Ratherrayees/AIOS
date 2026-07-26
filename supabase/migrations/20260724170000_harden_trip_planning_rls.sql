-- Trip planning is internal workspace work, but it is not an all-member write
-- surface. Preserve read visibility while limiting edits to operating roles.
drop policy "members may access trips" on public.trips;
drop policy "members may access itinerary items" on public.itinerary_items;

create policy "members may read trips" on public.trips
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "planning roles may manage trips" on public.trips
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );

create policy "planning roles may update trips" on public.trips
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );

create policy "members may read itinerary items" on public.itinerary_items
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "planning roles may add itinerary items" on public.itinerary_items
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );

create policy "planning roles may update itinerary items" on public.itinerary_items
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );
