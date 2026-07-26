drop policy if exists "owners and admins may manage autonomy policies"
  on public.ai_autonomy_policies;
drop policy if exists "owners and admins may insert autonomy policies"
  on public.ai_autonomy_policies;
drop policy if exists "owners and admins may update autonomy policies"
  on public.ai_autonomy_policies;
drop policy if exists "owners and admins may delete autonomy policies"
  on public.ai_autonomy_policies;

create policy "owners and admins may insert autonomy policies" on public.ai_autonomy_policies
  for insert to authenticated
  with check (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins may update autonomy policies" on public.ai_autonomy_policies
  for update to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins may delete autonomy policies" on public.ai_autonomy_policies
  for delete to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));
