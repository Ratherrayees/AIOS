-- Resolve Supabase advisor warnings without weakening authorization.

drop policy "profile owner may read profile" on public.profiles;
create policy "profile owner may read profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy "profile owner may update profile" on public.profiles;
create policy "profile owner may update profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy "members may append audit events" on public.audit_events;
create policy "members may append audit events" on public.audit_events for insert to authenticated
  with check (public.is_active_member(organization_id) and actor_id = (select auth.uid()));

drop policy "members may request approvals" on public.approval_requests;
create policy "members may request approvals" on public.approval_requests for insert to authenticated
  with check (public.is_active_member(organization_id) and requester_id = (select auth.uid()));

drop policy "admins may manage memberships" on public.memberships;
create policy "admins may add memberships" on public.memberships for insert to authenticated
  with check (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "admins may update memberships" on public.memberships for update to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "admins may remove memberships" on public.memberships for delete to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "finance may manage payments" on public.payments;
create policy "finance may add payments" on public.payments for insert to authenticated
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.app_role[]));
create policy "finance may update payments" on public.payments for update to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.app_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.app_role[]));
create policy "finance may remove payments" on public.payments for delete to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.app_role[]));
