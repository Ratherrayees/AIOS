-- Replace prototype-era "any active member may mutate" policies with explicit
-- role/action policies. Viewers remain read-only, finance access stays scoped
-- to finance-relevant records, and append-only records cannot be rewritten.

drop policy if exists "members may access contacts" on public.contacts;
create policy "members may read contacts" on public.contacts
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "crm roles may create contacts" on public.contacts
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );
create policy "crm roles may update contacts" on public.contacts
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );

drop policy if exists "members may access companies" on public.companies;
create policy "members may read companies" on public.companies
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "crm roles may create companies" on public.companies
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );
create policy "crm roles may update companies" on public.companies
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );

drop policy if exists "members may access deals" on public.deals;
create policy "members may read deals" on public.deals
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "commercial roles may create deals" on public.deals
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'agent']::public.app_role[]
    )
  );
create policy "commercial roles may update deals" on public.deals
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'agent']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'agent']::public.app_role[]
    )
  );

drop policy if exists "members may access tasks" on public.tasks;
create policy "members may read tasks" on public.tasks
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "working roles may create tasks" on public.tasks
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'finance', 'agent']::public.app_role[]
    )
  );
create policy "working roles may update tasks" on public.tasks
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'finance', 'agent']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'finance', 'agent']::public.app_role[]
    )
  );

drop policy if exists "members may access activity events"
  on public.activity_events;
create policy "members may read activity events" on public.activity_events
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "working roles may append activity events"
  on public.activity_events
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'finance', 'agent']::public.app_role[]
    )
    and (actor_id is null or actor_id = (select auth.uid()))
  );

drop policy if exists "members may access conversations"
  on public.conversations;
create policy "members may read conversations" on public.conversations
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "inbox roles may create manual conversations"
  on public.conversations
  for insert to authenticated
  with check (
    channel = 'manual'
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );
create policy "inbox roles may update conversations"
  on public.conversations
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );

drop policy if exists "members may access messages" on public.messages;
create policy "members may read messages" on public.messages
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "inbox roles may append internal messages" on public.messages
  for insert to authenticated
  with check (
    direction = 'internal'
    and (author_id is null or author_id = (select auth.uid()))
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );

drop policy if exists "members may access suppliers" on public.suppliers;
create policy "members may read suppliers" on public.suppliers
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "supplier roles may create suppliers" on public.suppliers
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'trip_designer', 'operations', 'finance']::public.app_role[]
    )
  );
create policy "supplier roles may update suppliers" on public.suppliers
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'trip_designer', 'operations', 'finance']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'trip_designer', 'operations', 'finance']::public.app_role[]
    )
  );

drop policy if exists "members may access travelers" on public.travelers;
create policy "members may read travelers" on public.travelers
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "traveler roles may create travelers" on public.travelers
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );
create policy "traveler roles may update travelers" on public.travelers
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'agent']::public.app_role[]
    )
  );

drop policy if exists "members may access bookings" on public.bookings;
create policy "members may read bookings" on public.bookings
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "operations roles may create bookings" on public.bookings
  for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'trip_designer', 'operations', 'finance']::public.app_role[]
    )
  );
create policy "operations roles may update bookings" on public.bookings
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'trip_designer', 'operations', 'finance']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'trip_designer', 'operations', 'finance']::public.app_role[]
    )
  );

drop policy if exists "members may add normal documents" on public.documents;
drop policy if exists "authorized users may update documents"
  on public.documents;
create policy "document roles may add documents" on public.documents
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'finance', 'agent']::public.app_role[]
    )
    and (
      sensitivity = 'normal'
      or public.has_organization_role(
        organization_id,
        array['owner', 'admin', 'operations', 'finance']::public.app_role[]
      )
    )
  );
create policy "document roles may update documents" on public.documents
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'operations', 'finance']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'operations', 'finance']::public.app_role[]
    )
  );

drop policy if exists "members may add their own itinerary comments"
  on public.itinerary_comments;
create policy "working roles may add their own itinerary comments"
  on public.itinerary_comments
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations', 'finance', 'agent']::public.app_role[]
    )
  );

-- Tenant identity is immutable after insertion. This closes the subtle case
-- where a user who belongs to two organizations could move an existing row
-- between them through an otherwise valid update policy.
create or replace function private.prevent_organization_id_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.organization_id <> new.organization_id then
    raise exception 'A record cannot be moved between organizations.';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_organization_id_change() from public;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'memberships',
    'contacts',
    'companies',
    'deals',
    'tasks',
    'activity_events',
    'audit_events',
    'conversations',
    'messages',
    'approval_requests',
    'ai_runs',
    'ai_tool_calls',
    'ai_autonomy_policies',
    'ai_field_reviews',
    'suppliers',
    'quotes',
    'quote_versions',
    'quote_cost_estimates',
    'trips',
    'travelers',
    'itinerary_items',
    'itinerary_templates',
    'itinerary_template_items',
    'itinerary_comments',
    'bookings',
    'payments',
    'documents'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.prevent_organization_id_change()',
      target_table || '_prevent_organization_move',
      target_table
    );
  end loop;
end;
$$;
