-- Reusable quote products and immutable supplier-rate history. Catalog values
-- can seed a quote, but every quote keeps its own immutable copied snapshot.

create table public.quote_catalog_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_id uuid,
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
  name text not null check (char_length(name) between 1 and 120),
  description text not null check (char_length(description) between 1 and 180),
  unit_label text not null default 'unit'
    check (char_length(unit_label) between 1 and 40),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_by uuid not null,
  archived_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint quote_catalog_products_organization_id_id_key
    unique (organization_id, id),
  constraint quote_catalog_products_supplier_same_organization_fkey
    foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id),
  constraint quote_catalog_products_creator_same_organization_fkey
    foreign key (organization_id, created_by)
    references public.memberships(organization_id, user_id),
  constraint quote_catalog_products_archiver_same_organization_fkey
    foreign key (organization_id, archived_by)
    references public.memberships(organization_id, user_id),
  constraint quote_catalog_products_archive_state_coherent
    check (
      (status = 'active' and archived_by is null and archived_at is null)
      or
      (status = 'archived' and archived_by is not null and archived_at is not null)
    )
);

create table public.quote_catalog_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  product_id uuid not null,
  version integer not null check (version > 0),
  unit_sell_amount numeric(14, 2) not null
    check (unit_sell_amount >= 0),
  unit_cost_amount numeric(14, 2) not null
    check (unit_cost_amount >= 0),
  tax_percent numeric(5, 2) not null default 0
    check (tax_percent between 0 and 100),
  valid_from date not null,
  valid_until date,
  published_by uuid not null,
  published_at timestamptz not null default statement_timestamp(),
  constraint quote_catalog_rates_product_version_key
    unique (product_id, version),
  constraint quote_catalog_rates_organization_id_id_key
    unique (organization_id, id),
  constraint quote_catalog_rates_valid_window
    check (valid_until is null or valid_until >= valid_from),
  constraint quote_catalog_rates_product_same_organization_fkey
    foreign key (organization_id, product_id)
    references public.quote_catalog_products(organization_id, id),
  constraint quote_catalog_rates_publisher_same_organization_fkey
    foreign key (organization_id, published_by)
    references public.memberships(organization_id, user_id)
);

create index quote_catalog_products_supplier_idx
  on public.quote_catalog_products (organization_id, supplier_id)
  where supplier_id is not null;
create index quote_catalog_products_creator_idx
  on public.quote_catalog_products (organization_id, created_by);
create index quote_catalog_products_archiver_idx
  on public.quote_catalog_products (organization_id, archived_by)
  where archived_by is not null;
create index quote_catalog_products_active_idx
  on public.quote_catalog_products (organization_id, currency, category, name)
  where status = 'active';
create index quote_catalog_rates_effective_idx
  on public.quote_catalog_rates (
    organization_id,
    product_id,
    valid_from desc,
    version desc
  );
create index quote_catalog_rates_publisher_idx
  on public.quote_catalog_rates (organization_id, published_by);

alter table public.quote_catalog_products enable row level security;
alter table public.quote_catalog_rates enable row level security;

create policy quote_catalog_products_member_select
  on public.quote_catalog_products
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

create policy quote_catalog_rates_commercial_select
  on public.quote_catalog_rates
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
        'operations',
        'finance'
      ]::public.app_role[]
    )
  );

revoke all on table public.quote_catalog_products
  from public, anon, authenticated;
revoke all on table public.quote_catalog_rates
  from public, anon, authenticated;
grant select on table public.quote_catalog_products to authenticated;
grant select on table public.quote_catalog_rates to authenticated;
grant select, insert, update, delete
  on table public.quote_catalog_products to service_role;
grant select, insert, update, delete
  on table public.quote_catalog_rates to service_role;

create or replace function private.validate_quote_catalog_rate_values(
  target_unit_sell_amount numeric,
  target_unit_cost_amount numeric,
  target_tax_percent numeric,
  target_valid_from date,
  target_valid_until date
)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if target_unit_sell_amount is null
    or target_unit_sell_amount < 0
    or target_unit_sell_amount > 999999999999.99
    or target_unit_cost_amount is null
    or target_unit_cost_amount < 0
    or target_unit_cost_amount > 999999999999.99
    or target_tax_percent is null
    or target_tax_percent not between 0 and 100
    or target_valid_from is null
    or (
      target_valid_until is not null
      and target_valid_until < target_valid_from
    )
  then
    raise exception 'Choose valid bounded catalog pricing and dates.'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.validate_quote_catalog_rate_values(
  numeric, numeric, numeric, date, date
) from public, anon, authenticated;

create or replace function public.create_quote_catalog_product(
  target_organization_id uuid,
  target_supplier_id uuid,
  target_category text,
  target_name text,
  target_description text,
  target_unit_label text,
  target_currency text,
  target_unit_sell_amount numeric,
  target_unit_cost_amount numeric,
  target_tax_percent numeric,
  target_valid_from date,
  target_valid_until date
)
returns table (
  product_id uuid,
  rate_id uuid,
  rate_version integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  created_product_id uuid := gen_random_uuid();
  created_rate_id uuid := gen_random_uuid();
  normalized_name text := btrim(target_name);
  normalized_description text := btrim(target_description);
  normalized_unit_label text := btrim(target_unit_label);
  normalized_currency text := upper(btrim(target_currency));
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  then
    raise exception 'You do not have permission to manage quote catalog pricing.'
      using errcode = '42501';
  end if;

  if target_category not in (
    'accommodation',
    'transport',
    'activity',
    'service',
    'fee',
    'other'
  )
    or normalized_name is null
    or char_length(normalized_name) not between 1 and 120
    or normalized_description is null
    or char_length(normalized_description) not between 1 and 180
    or normalized_unit_label is null
    or char_length(normalized_unit_label) not between 1 and 40
    or normalized_currency !~ '^[A-Z]{3}$'
  then
    raise exception 'Choose valid bounded catalog product details.'
      using errcode = '22023';
  end if;

  perform private.validate_quote_catalog_rate_values(
    target_unit_sell_amount,
    target_unit_cost_amount,
    target_tax_percent,
    target_valid_from,
    target_valid_until
  );

  if target_supplier_id is not null
    and not exists (
      select 1
      from public.suppliers supplier
      where supplier.organization_id = target_organization_id
        and supplier.id = target_supplier_id
        and supplier.archived_at is null
        and supplier.status = 'active'
    )
  then
    raise exception 'Choose an active supplier in this workspace.'
      using errcode = '23503';
  end if;

  insert into public.quote_catalog_products (
    id,
    organization_id,
    supplier_id,
    category,
    name,
    description,
    unit_label,
    currency,
    created_by
  )
  values (
    created_product_id,
    target_organization_id,
    target_supplier_id,
    target_category,
    normalized_name,
    normalized_description,
    normalized_unit_label,
    normalized_currency,
    actor_id
  );

  insert into public.quote_catalog_rates (
    id,
    organization_id,
    product_id,
    version,
    unit_sell_amount,
    unit_cost_amount,
    tax_percent,
    valid_from,
    valid_until,
    published_by
  )
  values (
    created_rate_id,
    target_organization_id,
    created_product_id,
    1,
    round(target_unit_sell_amount, 2),
    round(target_unit_cost_amount, 2),
    round(target_tax_percent, 2),
    target_valid_from,
    target_valid_until,
    actor_id
  );

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
    'quote_catalog_product',
    created_product_id,
    jsonb_build_object(
      'event', 'quote_catalog.product_created',
      'category', target_category,
      'currency', normalized_currency,
      'has_supplier', target_supplier_id is not null,
      'rate_version', 1,
      'external_action_performed', false
    )
  );

  return query select created_product_id, created_rate_id, 1;
end;
$$;

revoke all on function public.create_quote_catalog_product(
  uuid, uuid, text, text, text, text, text, numeric, numeric, numeric, date, date
) from public, anon;
grant execute on function public.create_quote_catalog_product(
  uuid, uuid, text, text, text, text, text, numeric, numeric, numeric, date, date
) to authenticated;

create or replace function public.publish_quote_catalog_rate(
  target_organization_id uuid,
  target_product_id uuid,
  target_unit_sell_amount numeric,
  target_unit_cost_amount numeric,
  target_tax_percent numeric,
  target_valid_from date,
  target_valid_until date
)
returns table (
  rate_id uuid,
  rate_version integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  product_record record;
  created_rate_id uuid := gen_random_uuid();
  next_version integer;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  then
    raise exception 'You do not have permission to manage quote catalog pricing.'
      using errcode = '42501';
  end if;

  perform private.validate_quote_catalog_rate_values(
    target_unit_sell_amount,
    target_unit_cost_amount,
    target_tax_percent,
    target_valid_from,
    target_valid_until
  );

  select product.id, product.status
  into product_record
  from public.quote_catalog_products product
  where product.organization_id = target_organization_id
    and product.id = target_product_id
  for update;
  if not found then
    raise exception 'This catalog product is not available in this workspace.'
      using errcode = 'P0002';
  end if;
  if product_record.status <> 'active' then
    raise exception 'Archived catalog products cannot receive a new rate.'
      using errcode = '22023';
  end if;

  select coalesce(max(rate.version), 0) + 1
  into next_version
  from public.quote_catalog_rates rate
  where rate.organization_id = target_organization_id
    and rate.product_id = target_product_id;

  insert into public.quote_catalog_rates (
    id,
    organization_id,
    product_id,
    version,
    unit_sell_amount,
    unit_cost_amount,
    tax_percent,
    valid_from,
    valid_until,
    published_by
  )
  values (
    created_rate_id,
    target_organization_id,
    target_product_id,
    next_version,
    round(target_unit_sell_amount, 2),
    round(target_unit_cost_amount, 2),
    round(target_tax_percent, 2),
    target_valid_from,
    target_valid_until,
    actor_id
  );

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
    'quote_catalog_product',
    target_product_id,
    jsonb_build_object(
      'event', 'quote_catalog.rate_published',
      'rate_version', next_version,
      'has_expiry', target_valid_until is not null,
      'external_action_performed', false
    )
  );

  return query select created_rate_id, next_version;
end;
$$;

revoke all on function public.publish_quote_catalog_rate(
  uuid, uuid, numeric, numeric, numeric, date, date
) from public, anon;
grant execute on function public.publish_quote_catalog_rate(
  uuid, uuid, numeric, numeric, numeric, date, date
) to authenticated;

create or replace function public.set_quote_catalog_product_status(
  target_organization_id uuid,
  target_product_id uuid,
  target_status text,
  target_reason text
)
returns setof public.quote_catalog_products
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text := btrim(target_reason);
  product_record public.quote_catalog_products%rowtype;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  then
    raise exception 'You do not have permission to manage quote catalog pricing.'
      using errcode = '42501';
  end if;
  if target_status not in ('active', 'archived')
    or normalized_reason is null
    or char_length(normalized_reason) not between 10 and 500
  then
    raise exception 'A valid status and accountable reason are required.'
      using errcode = '22023';
  end if;

  select * into product_record
  from public.quote_catalog_products product
  where product.organization_id = target_organization_id
    and product.id = target_product_id
  for update;
  if not found then
    raise exception 'This catalog product is not available in this workspace.'
      using errcode = 'P0002';
  end if;

  if product_record.status <> target_status then
    update public.quote_catalog_products
    set
      status = target_status,
      archived_by = case when target_status = 'archived' then actor_id end,
      archived_at = case
        when target_status = 'archived' then statement_timestamp()
      end
    where organization_id = target_organization_id
      and id = target_product_id
    returning * into product_record;

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
      'quote_catalog_product',
      target_product_id,
      jsonb_build_object(
        'event', 'quote_catalog.status_changed',
        'status', target_status,
        'reason_length', char_length(normalized_reason),
        'external_action_performed', false
      )
    );
  end if;

  return next product_record;
end;
$$;

revoke all on function public.set_quote_catalog_product_status(
  uuid, uuid, text, text
) from public, anon;
grant execute on function public.set_quote_catalog_product_status(
  uuid, uuid, text, text
) to authenticated;

alter table public.quote_line_items
  add column catalog_product_id uuid,
  add column catalog_rate_id uuid,
  add column supplier_id uuid,
  add constraint quote_line_items_catalog_product_same_organization_fkey
    foreign key (organization_id, catalog_product_id)
    references public.quote_catalog_products(organization_id, id),
  add constraint quote_line_items_catalog_rate_same_organization_fkey
    foreign key (organization_id, catalog_rate_id)
    references public.quote_catalog_rates(organization_id, id),
  add constraint quote_line_items_supplier_same_organization_fkey
    foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id),
  add constraint quote_line_items_catalog_provenance_coherent
    check (
      (catalog_product_id is null and catalog_rate_id is null)
      or
      (catalog_product_id is not null and catalog_rate_id is not null)
    );

create index quote_line_items_catalog_product_idx
  on public.quote_line_items (organization_id, catalog_product_id)
  where catalog_product_id is not null;
create index quote_line_items_catalog_rate_idx
  on public.quote_line_items (organization_id, catalog_rate_id)
  where catalog_rate_id is not null;
create index quote_line_items_supplier_idx
  on public.quote_line_items (organization_id, supplier_id)
  where supplier_id is not null;

-- Preserve the structured-quote contract while accepting an optional exact
-- catalog-rate reference. Catalog-backed amounts must equal the effective
-- immutable rate; quantity, description, and line discount remain quote-local.
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
  rate_record record;
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
  item_catalog_rate_id uuid;
  item_catalog_product_id uuid;
  item_supplier_id uuid;
  created_item_id uuid;
  created_version_id uuid := gen_random_uuid();
  next_version integer;
  total_net numeric := 0;
  total_tax numeric := 0;
  total_customer numeric := 0;
  total_cost numeric := 0;
  total_margin numeric := 0;
  total_margin_percent numeric := null;
  catalog_line_count integer := 0;
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
    quote.currency,
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
          'tax_percent',
          'catalog_rate_id'
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
      or (
        item_value ? 'catalog_rate_id'
        and jsonb_typeof(item_value -> 'catalog_rate_id') is distinct from 'string'
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
      item_catalog_rate_id := nullif(
        item_value ->> 'catalog_rate_id',
        ''
      )::uuid;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Quote line item values must use their declared types.'
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

    if item_catalog_rate_id is not null then
      select
        rate.product_id,
        product.supplier_id,
        product.category,
        rate.unit_sell_amount,
        rate.unit_cost_amount,
        rate.tax_percent
      into rate_record
      from public.quote_catalog_rates rate
      join public.quote_catalog_products product
        on product.organization_id = rate.organization_id
        and product.id = rate.product_id
      where rate.organization_id = target_organization_id
        and rate.id = item_catalog_rate_id
        and product.status = 'active'
        and product.currency = quote_record.currency
        and rate.valid_from <= current_date
        and (rate.valid_until is null or rate.valid_until >= current_date)
        and not exists (
          select 1
          from public.quote_catalog_rates newer
          where newer.organization_id = rate.organization_id
            and newer.product_id = rate.product_id
            and newer.valid_from <= current_date
            and (
              newer.valid_until is null
              or newer.valid_until >= current_date
            )
            and (
              newer.valid_from > rate.valid_from
              or (
                newer.valid_from = rate.valid_from
                and newer.version > rate.version
              )
            )
        )
      for share of product;
      if not found then
        raise exception 'Choose the current effective catalog rate for this quote currency.'
          using errcode = '22023';
      end if;
      if item_category <> rate_record.category
        or item_unit_price <> rate_record.unit_sell_amount
        or item_unit_cost <> rate_record.unit_cost_amount
        or item_tax_percent <> rate_record.tax_percent
      then
        raise exception 'Catalog-backed sell, cost, tax, and category values cannot be forged.'
          using errcode = '22023';
      end if;
      catalog_line_count := catalog_line_count + 1;
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
    item_catalog_rate_id := nullif(
      item_value ->> 'catalog_rate_id',
      ''
    )::uuid;
    item_catalog_product_id := null;
    item_supplier_id := null;
    if item_catalog_rate_id is not null then
      select rate.product_id, product.supplier_id
      into item_catalog_product_id, item_supplier_id
      from public.quote_catalog_rates rate
      join public.quote_catalog_products product
        on product.organization_id = rate.organization_id
        and product.id = rate.product_id
      where rate.organization_id = target_organization_id
        and rate.id = item_catalog_rate_id;
    end if;
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
      total_amount,
      catalog_product_id,
      catalog_rate_id,
      supplier_id
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
      item_total,
      item_catalog_product_id,
      item_catalog_rate_id,
      item_supplier_id
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
      'catalog_line_count', catalog_line_count,
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
