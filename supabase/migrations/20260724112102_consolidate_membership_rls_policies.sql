-- One permissive policy per membership mutation action keeps the authorization
-- model explicit while avoiding per-row evaluation of overlapping policies.

drop policy "owners may add memberships" on public.memberships;
drop policy "admins may add non-owner memberships" on public.memberships;
drop policy "owners may update memberships" on public.memberships;
drop policy "admins may update non-owner memberships" on public.memberships;
drop policy "owners may remove memberships" on public.memberships;
drop policy "admins may remove non-owner memberships" on public.memberships;

create policy "authorized roles may add memberships" on public.memberships
  for insert to authenticated
  with check (
    public.has_organization_role(organization_id, array['owner']::public.app_role[])
    or (
      role <> 'owner'
      and public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[])
    )
  );

create policy "authorized roles may update memberships" on public.memberships
  for update to authenticated
  using (
    public.has_organization_role(organization_id, array['owner']::public.app_role[])
    or (
      role <> 'owner'
      and public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[])
    )
  )
  with check (
    public.has_organization_role(organization_id, array['owner']::public.app_role[])
    or (
      role <> 'owner'
      and public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[])
    )
  );

create policy "authorized roles may remove memberships" on public.memberships
  for delete to authenticated
  using (
    public.has_organization_role(organization_id, array['owner']::public.app_role[])
    or (
      role <> 'owner'
      and public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[])
    )
  );
