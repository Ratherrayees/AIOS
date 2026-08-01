-- Structured quote composition. Customer-facing sell lines stay readable to
-- members, while unit costs remain in a separate commercial-only relation.

alter table public.quote_versions
  add column net_amount numeric(14, 2),
  add column tax_amount numeric(14, 2);

update public.quote_versions
set
  net_amount = total_amount,
  tax_amount = 0;

alter table public.quote_versions
  alter column net_amount set not null,
  alter column net_amount set default 0,
  alter column tax_amount set not null,
  alter column tax_amount set default 0,
  add constraint quote_versions_net_amount_nonnegative
    check (net_amount >= 0),
  add constraint quote_versions_tax_amount_nonnegative
    check (tax_amount >= 0),
  add constraint quote_versions_total_reconciles
    check (total_amount = net_amount + tax_amount),
  add constraint quote_versions_legacy_cost_lines_empty
    check (cost_lines = '[]'::jsonb);

create or replace function private.default_quote_version_commercial_totals()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.net_amount = 0 and new.tax_amount = 0 and new.total_amount > 0 then
    new.net_amount := new.total_amount;
  end if;
  return new;
end;
$$;

revoke all on function private.default_quote_version_commercial_totals()
  from public, anon, authenticated;

create trigger quote_versions_default_commercial_totals
  before insert on public.quote_versions
  for each row execute function private.default_quote_version_commercial_totals();

create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  quote_version_id uuid not null
    references public.quote_versions(id) on delete cascade,
  position smallint not null check (position between 0 and 49),
  category text not null check (
    category in (
      'accommodation',
      'transport',
      'activity',
      'service',
      'fee',
      'other'
    )
  ),
  description text not null check (char_length(description) between 1 and 180),
  quantity numeric(12, 2) not null check (quantity > 0 and quantity <= 100000),
  unit_price_amount numeric(14, 2) not null check (unit_price_amount >= 0),
  discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  tax_percent numeric(5, 2) not null default 0 check (tax_percent between 0 and 100),
  net_amount numeric(14, 2) not null check (net_amount >= 0),
  tax_amount numeric(14, 2) not null check (tax_amount >= 0),
  total_amount numeric(14, 2) not null check (total_amount >= 0),
  created_at timestamptz not null default statement_timestamp(),
  constraint quote_line_items_version_position_key
    unique (quote_version_id, position),
  constraint quote_line_items_organization_id_id_key
    unique (organization_id, id),
  constraint quote_line_items_version_same_organization_fkey
    foreign key (organization_id, quote_version_id)
    references public.quote_versions(organization_id, id)
    on delete cascade,
  constraint quote_line_items_discount_bounded
    check (discount_amount <= round(quantity * unit_price_amount, 2)),
  constraint quote_line_items_net_reconciles
    check (
      net_amount = round(quantity * unit_price_amount, 2) - discount_amount
    ),
  constraint quote_line_items_tax_reconciles
    check (tax_amount = round(net_amount * tax_percent / 100, 2)),
  constraint quote_line_items_total_reconciles
    check (total_amount = net_amount + tax_amount)
);

create table public.quote_line_costs (
  quote_line_item_id uuid primary key,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  unit_cost_amount numeric(14, 2) not null check (unit_cost_amount >= 0),
  cost_amount numeric(14, 2) not null check (cost_amount >= 0),
  created_at timestamptz not null default statement_timestamp(),
  constraint quote_line_costs_same_organization_fkey
    foreign key (organization_id, quote_line_item_id)
    references public.quote_line_items(organization_id, id)
    on delete cascade
);

create index quote_line_items_organization_version_idx
  on public.quote_line_items (organization_id, quote_version_id, position);
create index quote_line_costs_organization_idx
  on public.quote_line_costs (organization_id);

create trigger quote_line_items_prevent_organization_move
  before update on public.quote_line_items
  for each row execute function private.prevent_organization_id_change();
create trigger quote_line_costs_prevent_organization_move
  before update on public.quote_line_costs
  for each row execute function private.prevent_organization_id_change();

alter table public.quote_line_items enable row level security;
alter table public.quote_line_costs enable row level security;

create policy quote_line_items_member_select
  on public.quote_line_items
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

create policy quote_line_costs_commercial_select
  on public.quote_line_costs
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array[
        'owner',
        'admin',
        'sales',
        'trip_designer',
        'finance'
      ]::public.app_role[]
    )
  );

revoke all on table public.quote_line_items
  from public, anon, authenticated;
revoke all on table public.quote_line_costs
  from public, anon, authenticated;
grant select on table public.quote_line_items to authenticated;
grant select on table public.quote_line_costs to authenticated;
grant select, insert, update, delete
  on table public.quote_line_items to service_role;
grant select, insert, update, delete
  on table public.quote_line_costs to service_role;

create or replace function public.append_structured_quote_version(
  target_organization_id uuid,
  target_quote_id uuid,
  target_items jsonb
)
returns table (
  quote_version integer,
  quote_version_id uuid,
  customer_total_amount numeric,
  net_sell_amount numeric,
  tax_total_amount numeric,
  estimated_cost_amount numeric,
  gross_margin_amount numeric,
  gross_margin_percent numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  quote_record record;
  item_record record;
  item_value jsonb;
  item_category text;
  item_description text;
  item_quantity numeric;
  item_unit_price numeric;
  item_unit_cost numeric;
  item_discount numeric;
  item_tax_percent numeric;
  item_base numeric;
  item_net numeric;
  item_tax numeric;
  item_total numeric;
  item_cost numeric;
  created_item_id uuid;
  created_version_id uuid := gen_random_uuid();
  next_version integer;
  total_net numeric := 0;
  total_tax numeric := 0;
  total_customer numeric := 0;
  total_cost numeric := 0;
  total_margin numeric := 0;
  total_margin_percent numeric := null;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to compose quote pricing.'
      using errcode = '42501';
  end if;

  if target_items is null
    or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 50
  then
    raise exception 'A quote version requires between 1 and 50 line items.'
      using errcode = '22023';
  end if;

  select
    quote.current_version,
    version.itinerary_snapshot,
    version.terms_snapshot
  into quote_record
  from public.quotes quote
  join public.quote_versions version
    on version.organization_id = quote.organization_id
    and version.quote_id = quote.id
    and version.version = quote.current_version
  where quote.organization_id = target_organization_id
    and quote.id = target_quote_id
    and quote.status = 'draft'
  for update of quote;
  if not found then
    raise exception 'Only an available draft quote can be composed.'
      using errcode = 'P0002';
  end if;
  next_version := quote_record.current_version + 1;

  for item_record in
    select item.value, item.ordinality
    from jsonb_array_elements(target_items) with ordinality item(value, ordinality)
  loop
    item_value := item_record.value;
    if jsonb_typeof(item_value) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(item_value) item_key
        where item_key not in (
          'category',
          'description',
          'quantity',
          'unit_price_amount',
          'unit_cost_amount',
          'discount_amount',
          'tax_percent'
        )
      )
      or jsonb_typeof(item_value -> 'category') is distinct from 'string'
      or jsonb_typeof(item_value -> 'description') is distinct from 'string'
      or jsonb_typeof(item_value -> 'quantity') is distinct from 'number'
      or jsonb_typeof(item_value -> 'unit_price_amount') is distinct from 'number'
      or jsonb_typeof(item_value -> 'unit_cost_amount') is distinct from 'number'
      or (
        item_value ? 'discount_amount'
        and jsonb_typeof(item_value -> 'discount_amount') is distinct from 'number'
      )
      or (
        item_value ? 'tax_percent'
        and jsonb_typeof(item_value -> 'tax_percent') is distinct from 'number'
      )
    then
      raise exception 'Quote line items contain unsupported fields or types.'
        using errcode = '22023';
    end if;

    begin
      item_category := item_value ->> 'category';
      item_description := btrim(item_value ->> 'description');
      item_quantity := (item_value ->> 'quantity')::numeric;
      item_unit_price := (item_value ->> 'unit_price_amount')::numeric;
      item_unit_cost := (item_value ->> 'unit_cost_amount')::numeric;
      item_discount := coalesce(
        (item_value ->> 'discount_amount')::numeric,
        0
      );
      item_tax_percent := coalesce(
        (item_value ->> 'tax_percent')::numeric,
        0
      );
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Quote line item amounts must be bounded numbers.'
        using errcode = '22023';
    end;

    if item_category not in (
      'accommodation',
      'transport',
      'activity',
      'service',
      'fee',
      'other'
    )
      or item_description is null
      or char_length(item_description) not between 1 and 180
      or item_quantity is null
      or item_quantity <= 0
      or item_quantity > 100000
      or item_unit_price is null
      or item_unit_price < 0
      or item_unit_price > 999999999999.99
      or item_unit_cost is null
      or item_unit_cost < 0
      or item_unit_cost > 999999999999.99
      or item_discount < 0
      or item_tax_percent not between 0 and 100
    then
      raise exception 'Choose valid bounded quote line details.'
        using errcode = '22023';
    end if;

    item_base := round(item_quantity * item_unit_price, 2);
    item_cost := round(item_quantity * item_unit_cost, 2);
    if item_base > 999999999999.99 or item_cost > 999999999999.99 then
      raise exception 'A calculated quote line amount exceeds the supported limit.'
        using errcode = '22003';
    end if;
    if item_discount > item_base then
      raise exception 'A line discount cannot exceed its sell amount.'
        using errcode = '22023';
    end if;
    item_net := item_base - item_discount;
    item_tax := round(item_net * item_tax_percent / 100, 2);
    item_total := item_net + item_tax;
    if item_total > 999999999999.99 then
      raise exception 'A calculated quote line total exceeds the supported limit.'
        using errcode = '22003';
    end if;
    total_net := total_net + item_net;
    total_tax := total_tax + item_tax;
    total_customer := total_customer + item_total;
    total_cost := total_cost + item_cost;
    if total_net > 999999999999.99
      or total_customer > 999999999999.99
      or total_cost > 999999999999.99
    then
      raise exception 'The quote aggregate exceeds the supported currency limit.'
        using errcode = '22003';
    end if;
  end loop;

  if total_customer <= 0 then
    raise exception 'The structured quote total must be positive.'
      using errcode = '22023';
  end if;
  total_margin := total_net - total_cost;
  if total_net > 0 then
    total_margin_percent := round(total_margin / total_net * 100, 4);
  end if;

  insert into public.quote_versions (
    id,
    organization_id,
    quote_id,
    version,
    itinerary_snapshot,
    total_amount,
    net_amount,
    tax_amount,
    margin_amount,
    margin_percent,
    terms_snapshot,
    created_by
  )
  values (
    created_version_id,
    target_organization_id,
    target_quote_id,
    next_version,
    quote_record.itinerary_snapshot,
    total_customer,
    total_net,
    total_tax,
    total_margin,
    total_margin_percent,
    quote_record.terms_snapshot,
    actor_id
  );

  for item_record in
    select item.value, item.ordinality
    from jsonb_array_elements(target_items) with ordinality item(value, ordinality)
  loop
    item_value := item_record.value;
    item_category := item_value ->> 'category';
    item_description := btrim(item_value ->> 'description');
    item_quantity := (item_value ->> 'quantity')::numeric;
    item_unit_price := (item_value ->> 'unit_price_amount')::numeric;
    item_unit_cost := (item_value ->> 'unit_cost_amount')::numeric;
    item_discount := coalesce((item_value ->> 'discount_amount')::numeric, 0);
    item_tax_percent := coalesce((item_value ->> 'tax_percent')::numeric, 0);
    item_base := round(item_quantity * item_unit_price, 2);
    item_net := item_base - item_discount;
    item_tax := round(item_net * item_tax_percent / 100, 2);
    item_total := item_net + item_tax;
    item_cost := round(item_quantity * item_unit_cost, 2);

    insert into public.quote_line_items (
      organization_id,
      quote_version_id,
      position,
      category,
      description,
      quantity,
      unit_price_amount,
      discount_amount,
      tax_percent,
      net_amount,
      tax_amount,
      total_amount
    )
    values (
      target_organization_id,
      created_version_id,
      item_record.ordinality - 1,
      item_category,
      item_description,
      item_quantity,
      item_unit_price,
      item_discount,
      item_tax_percent,
      item_net,
      item_tax,
      item_total
    )
    returning id into created_item_id;

    insert into public.quote_line_costs (
      quote_line_item_id,
      organization_id,
      unit_cost_amount,
      cost_amount
    )
    values (
      created_item_id,
      target_organization_id,
      item_unit_cost,
      item_cost
    );
  end loop;

  insert into public.quote_cost_estimates (
    organization_id,
    quote_version_id,
    estimated_cost_amount,
    created_by
  )
  values (
    target_organization_id,
    created_version_id,
    total_cost,
    actor_id
  );

  update public.quotes
  set current_version = next_version
  where organization_id = target_organization_id
    and id = target_quote_id;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_organization_id,
    actor_id,
    'pricing.changed',
    'quote',
    target_quote_id,
    jsonb_build_object(
      'event', 'quote.structured_version_created',
      'version', next_version,
      'line_count', jsonb_array_length(target_items),
      'includes_internal_costs', true,
      'includes_tax_breakdown', total_tax > 0,
      'external_share_performed', false
    )
  );

  return query
  select
    next_version,
    created_version_id,
    total_customer,
    total_net,
    total_tax,
    total_cost,
    total_margin,
    total_margin_percent;
end;
$$;

revoke all on function public.append_structured_quote_version(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.append_structured_quote_version(uuid, uuid, jsonb)
  to authenticated;

-- Rebind the existing approval boundary to net sell after tax-aware versions
-- become available. The trigger is already installed by the guardrails
-- migration and automatically uses this replacement.
create or replace function private.enforce_quote_share_guardrails()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quote_record record;
  policy_record public.quote_approval_policies%rowtype;
  cost_amount numeric;
  margin_percent numeric;
  risk_codes jsonb := '[]'::jsonb;
  guardrail_status text := 'ready';
begin
  if new.action <> 'quote.share' then
    return new;
  end if;

  if (select auth.uid()) is null
    or new.requester_id <> (select auth.uid())
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      new.organization_id,
      array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to request quote sharing review.'
      using errcode = '42501';
  end if;

  if new.entity_type <> 'quote' or new.entity_id is null then
    raise exception 'Quote sharing review requires an exact quote.'
      using errcode = '22023';
  end if;

  select
    quote.id,
    quote.status,
    quote.current_version,
    quote.valid_until,
    version.id as version_id,
    version.total_amount,
    version.net_amount
  into quote_record
  from public.quotes quote
  join public.quote_versions version
    on version.organization_id = quote.organization_id
    and version.quote_id = quote.id
    and version.version = quote.current_version
  where quote.organization_id = new.organization_id
    and quote.id = new.entity_id
  for share of quote;

  if not found then
    raise exception 'This quote is not available in this workspace.'
      using errcode = 'P0002';
  end if;
  if quote_record.status <> 'draft' then
    raise exception 'Only an internal draft can enter sharing review.'
      using errcode = '22023';
  end if;
  if quote_record.total_amount is null or quote_record.total_amount <= 0 then
    raise exception 'A positive current quote total is required.'
      using errcode = '22023';
  end if;
  if quote_record.net_amount is null or quote_record.net_amount <= 0 then
    raise exception 'A positive net sell amount is required.'
      using errcode = '22023';
  end if;

  select * into policy_record
  from public.quote_approval_policies policy
  where policy.organization_id = new.organization_id
  for share;
  if not found then
    policy_record.organization_id := new.organization_id;
    policy_record.minimum_margin_percent := 15;
    policy_record.require_cost_estimate := true;
    policy_record.require_valid_until := true;
    policy_record.maximum_validity_days := 45;
  end if;

  select estimate.estimated_cost_amount
  into cost_amount
  from public.quote_cost_estimates estimate
  where estimate.organization_id = new.organization_id
    and estimate.quote_version_id = quote_record.version_id;

  if policy_record.require_cost_estimate and cost_amount is null then
    raise exception 'A current internal cost estimate is required.'
      using errcode = '22023';
  end if;
  if policy_record.require_valid_until and quote_record.valid_until is null then
    raise exception 'A quote validity date is required.'
      using errcode = '22023';
  end if;
  if quote_record.valid_until is not null
    and quote_record.valid_until < current_date
  then
    raise exception 'The quote validity date has expired.'
      using errcode = '22023';
  end if;

  if quote_record.valid_until is not null
    and quote_record.valid_until - current_date >
      policy_record.maximum_validity_days
  then
    risk_codes := risk_codes || jsonb_build_array('validity_above_policy');
  end if;

  if cost_amount is not null then
    margin_percent := round(
      ((quote_record.net_amount - cost_amount) /
        quote_record.net_amount) * 100,
      1
    );
    if margin_percent < policy_record.minimum_margin_percent then
      risk_codes := risk_codes || jsonb_build_array('margin_below_floor');
    end if;
  end if;

  if jsonb_array_length(risk_codes) > 0 then
    guardrail_status := 'exception_review';
  end if;

  new.payload := jsonb_build_object(
    'quote_id', quote_record.id,
    'quote_version', quote_record.current_version,
    'guardrail_status', guardrail_status,
    'risk_codes', risk_codes,
    'guardrail_policy', jsonb_build_object(
      'minimum_margin_percent', policy_record.minimum_margin_percent,
      'require_cost_estimate', policy_record.require_cost_estimate,
      'require_valid_until', policy_record.require_valid_until,
      'maximum_validity_days', policy_record.maximum_validity_days
    ),
    'external_share_performed', false
  );

  return new;
end;
$$;

revoke all on function private.enforce_quote_share_guardrails()
  from public, anon, authenticated;
