-- Internal cost estimates are separated from customer-facing quote versions so
-- they can have a stricter role boundary than quote totals and titles.
create table public.quote_cost_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_version_id uuid not null unique references public.quote_versions(id) on delete cascade,
  estimated_cost_amount numeric(14, 2) not null check (estimated_cost_amount >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index quote_cost_estimates_org_version_idx
  on public.quote_cost_estimates (organization_id, quote_version_id);

alter table public.quote_cost_estimates enable row level security;

grant select, insert on table public.quote_cost_estimates to authenticated;

create policy "commercial and finance roles may read quote costs"
  on public.quote_cost_estimates for select to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'finance']::public.app_role[]
    )
  );

create policy "commercial roles may append quote costs"
  on public.quote_cost_estimates for insert to authenticated
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
    )
  );

-- A revision and its cost estimate are written together. The quote row lock
-- prevents two editors from assigning the same immutable version number.
create or replace function public.append_quote_version_with_cost(
  target_organization_id uuid,
  target_quote_id uuid,
  quote_total_amount numeric,
  quote_estimated_cost_amount numeric
)
returns table (quote_version integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_version integer;
  created_quote_version_id uuid;
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
    organization_id,
    quote_id,
    version,
    total_amount,
    margin_amount,
    margin_percent,
    created_by
  ) values (
    target_organization_id,
    target_quote_id,
    next_version,
    quote_total_amount,
    quote_total_amount - quote_estimated_cost_amount,
    round(
      ((quote_total_amount - quote_estimated_cost_amount) / nullif(quote_total_amount, 0)) * 100,
      4
    ),
    auth.uid()
  ) returning id into created_quote_version_id;

  insert into public.quote_cost_estimates (
    organization_id,
    quote_version_id,
    estimated_cost_amount,
    created_by
  ) values (
    target_organization_id,
    created_quote_version_id,
    quote_estimated_cost_amount,
    auth.uid()
  );

  update public.quotes
  set current_version = next_version
  where id = target_quote_id and organization_id = target_organization_id;

  return query select next_version;
end;
$$;

revoke all on function public.append_quote_version_with_cost(uuid, uuid, numeric, numeric) from public;
grant execute on function public.append_quote_version_with_cost(uuid, uuid, numeric, numeric) to authenticated;
