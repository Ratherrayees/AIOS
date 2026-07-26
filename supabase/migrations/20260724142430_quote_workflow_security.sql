-- Quotes are visible to active workspace members, but only commercial roles
-- may create or edit draft metadata. Quote versions are append-only.
drop policy "members may access quotes" on public.quotes;
drop policy "members may access quote versions" on public.quote_versions;

create policy "members may read quotes" on public.quotes
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "commercial roles may create quotes" on public.quotes
  for insert to authenticated
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]));

create policy "commercial roles may update quotes" on public.quotes
  for update to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]));

create policy "members may read quote versions" on public.quote_versions
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "commercial roles may append quote versions" on public.quote_versions
  for insert to authenticated
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]));

create or replace function public.create_quote_draft(
  target_organization_id uuid,
  target_deal_id uuid,
  quote_title text,
  quote_currency char(3),
  quote_valid_until date,
  quote_total_amount numeric
)
returns table (quote_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  created_quote_id uuid;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
  ) then
    raise exception 'You do not have permission to create quote drafts.';
  end if;

  if not exists (
    select 1 from public.deals
    where id = target_deal_id and organization_id = target_organization_id
  ) then
    raise exception 'The selected opportunity is not available in this workspace.';
  end if;

  insert into public.quotes (
    organization_id, deal_id, owner_id, title, status, currency, valid_until
  ) values (
    target_organization_id, target_deal_id, auth.uid(), quote_title, 'draft', quote_currency, quote_valid_until
  ) returning id into created_quote_id;

  insert into public.quote_versions (
    organization_id, quote_id, version, total_amount, created_by
  ) values (
    target_organization_id, created_quote_id, 1, quote_total_amount, auth.uid()
  );

  return query select created_quote_id;
end;
$$;

revoke all on function public.create_quote_draft(uuid, uuid, text, char(3), date, numeric) from public;
grant execute on function public.create_quote_draft(uuid, uuid, text, char(3), date, numeric) to authenticated;
