-- Keep member reads and planner writes as non-overlapping RLS policies.
drop policy "planning roles may manage itinerary template items"
  on public.itinerary_template_items;

create policy "planning roles may add itinerary template items"
  on public.itinerary_template_items
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );

create policy "planning roles may update itinerary template items"
  on public.itinerary_template_items
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

create policy "planning roles may delete itinerary template items"
  on public.itinerary_template_items
  for delete to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );
