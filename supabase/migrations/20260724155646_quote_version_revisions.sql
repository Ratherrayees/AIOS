-- Quote revisions are append-only. A row lock keeps concurrent revisions from
-- claiming the same version number.
create or replace function public.append_quote_version(
  target_organization_id uuid,
  target_quote_id uuid,
  quote_total_amount numeric
)
returns table (quote_version integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_version integer;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
  ) then
    raise exception 'You do not have permission to revise quote drafts.';
  end if;

  select current_version + 1 into next_version
  from public.quotes
  where id = target_quote_id
    and organization_id = target_organization_id
    and status = 'draft'
  for update;

  if not found then
    raise exception 'Only an available draft quote can be revised.';
  end if;

  insert into public.quote_versions (
    organization_id, quote_id, version, total_amount, created_by
  ) values (
    target_organization_id, target_quote_id, next_version, quote_total_amount, auth.uid()
  );

  update public.quotes
  set current_version = next_version
  where id = target_quote_id and organization_id = target_organization_id;

  return query select next_version;
end;
$$;

revoke all on function public.append_quote_version(uuid, uuid, numeric) from public;
grant execute on function public.append_quote_version(uuid, uuid, numeric) to authenticated;
