-- Customer-facing quote content is part of the immutable commercial revision.
-- Editing it creates a new version that copies the exact pricing/cost snapshot;
-- sharing review requires bounded inclusions and terms on the current version.

create or replace function private.quote_proposal_content_is_ready(
  target_content jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  section_name text;
  section_value jsonb;
  item_value text;
begin
  if target_content is null
    or jsonb_typeof(target_content) <> 'object'
    or exists (
      select 1
      from jsonb_object_keys(target_content) content_key
      where content_key not in (
        'schema_version',
        'inclusions',
        'exclusions',
        'terms'
      )
    )
    or jsonb_typeof(target_content -> 'schema_version') is distinct from 'number'
    or (target_content ->> 'schema_version')::integer <> 1
  then
    return false;
  end if;

  foreach section_name in array array['inclusions', 'exclusions', 'terms']
  loop
    section_value := target_content -> section_name;
    if jsonb_typeof(section_value) is distinct from 'array'
      or jsonb_array_length(section_value) > 30
      or (
        section_name in ('inclusions', 'terms')
        and jsonb_array_length(section_value) < 1
      )
    then
      return false;
    end if;

    if exists (
      select 1
      from jsonb_array_elements(section_value) item(value)
      where jsonb_typeof(item.value) <> 'string'
    )
    then
      return false;
    end if;

    for item_value in
      select item.value
      from jsonb_array_elements_text(section_value) item(value)
    loop
      if item_value <> btrim(item_value)
        or char_length(item_value) not between 1 and 300
      then
        return false;
      end if;
    end loop;

    if exists (
      select 1
      from jsonb_array_elements_text(section_value) item(value)
      group by lower(btrim(item.value))
      having count(*) > 1
    )
    then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function private.quote_proposal_content_is_ready(jsonb)
  from public, anon, authenticated;

create or replace function public.append_quote_proposal_content_version(
  target_organization_id uuid,
  target_quote_id uuid,
  target_content jsonb
)
returns table (
  quote_version integer,
  quote_version_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  quote_record record;
  line_record record;
  created_line_id uuid;
  created_version_id uuid := gen_random_uuid();
  next_version integer;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to revise quote proposal content.'
      using errcode = '42501';
  end if;

  if not private.quote_proposal_content_is_ready(target_content) then
    raise exception 'Add bounded, unique proposal inclusions and terms.'
      using errcode = '22023';
  end if;

  select
    quote.current_version,
    version.id as source_version_id,
    version.itinerary_snapshot,
    version.cost_lines,
    version.total_amount,
    version.net_amount,
    version.tax_amount,
    version.margin_amount,
    version.margin_percent
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
    raise exception 'Only an available draft quote can be revised.'
      using errcode = 'P0002';
  end if;

  next_version := quote_record.current_version + 1;
  insert into public.quote_versions (
    id,
    organization_id,
    quote_id,
    version,
    itinerary_snapshot,
    cost_lines,
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
    quote_record.cost_lines,
    quote_record.total_amount,
    quote_record.net_amount,
    quote_record.tax_amount,
    quote_record.margin_amount,
    quote_record.margin_percent,
    target_content,
    actor_id
  );

  for line_record in
    select
      line.position,
      line.category,
      line.description,
      line.quantity,
      line.unit_price_amount,
      line.discount_amount,
      line.tax_percent,
      line.net_amount,
      line.tax_amount,
      line.total_amount,
      line.catalog_product_id,
      line.catalog_rate_id,
      line.supplier_id,
      cost.unit_cost_amount,
      cost.cost_amount
    from public.quote_line_items line
    left join public.quote_line_costs cost
      on cost.organization_id = line.organization_id
      and cost.quote_line_item_id = line.id
    where line.organization_id = target_organization_id
      and line.quote_version_id = quote_record.source_version_id
    order by line.position
  loop
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
      line_record.position,
      line_record.category,
      line_record.description,
      line_record.quantity,
      line_record.unit_price_amount,
      line_record.discount_amount,
      line_record.tax_percent,
      line_record.net_amount,
      line_record.tax_amount,
      line_record.total_amount,
      line_record.catalog_product_id,
      line_record.catalog_rate_id,
      line_record.supplier_id
    )
    returning id into created_line_id;

    if line_record.unit_cost_amount is not null then
      insert into public.quote_line_costs (
        quote_line_item_id,
        organization_id,
        unit_cost_amount,
        cost_amount
      )
      values (
        created_line_id,
        target_organization_id,
        line_record.unit_cost_amount,
        line_record.cost_amount
      );
    end if;
  end loop;

  insert into public.quote_cost_estimates (
    organization_id,
    quote_version_id,
    estimated_cost_amount,
    created_by
  )
  select
    target_organization_id,
    created_version_id,
    estimate.estimated_cost_amount,
    actor_id
  from public.quote_cost_estimates estimate
  where estimate.organization_id = target_organization_id
    and estimate.quote_version_id = quote_record.source_version_id;

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
    'record.updated',
    'quote',
    target_quote_id,
    jsonb_build_object(
      'event', 'quote.proposal_content_version_created',
      'version', next_version,
      'inclusion_count', jsonb_array_length(target_content -> 'inclusions'),
      'exclusion_count', jsonb_array_length(target_content -> 'exclusions'),
      'term_count', jsonb_array_length(target_content -> 'terms'),
      'content_sha256', encode(
        extensions.digest(
          convert_to(target_content::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      'pricing_snapshot_copied', true,
      'external_share_performed', false
    )
  );

  return query select next_version, created_version_id;
end;
$$;

revoke all on function public.append_quote_proposal_content_version(
  uuid, uuid, jsonb
) from public, anon;
grant execute on function public.append_quote_proposal_content_version(
  uuid, uuid, jsonb
) to authenticated;

-- A quick total/cost revision preserves the current proposal content instead
-- of silently returning the draft to an empty customer-facing state.
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
  current_version_record record;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
  ) then
    raise exception 'You do not have permission to revise quote drafts.';
  end if;

  select
    quote.current_version + 1 as next_version,
    version.itinerary_snapshot,
    version.terms_snapshot
  into current_version_record
  from public.quotes quote
  join public.quote_versions version
    on version.organization_id = quote.organization_id
    and version.quote_id = quote.id
    and version.version = quote.current_version
  where quote.id = target_quote_id
    and quote.organization_id = target_organization_id
    and quote.status = 'draft'
  for update of quote;

  if not found then
    raise exception 'Only an available draft quote can be revised.';
  end if;
  next_version := current_version_record.next_version;

  insert into public.quote_versions (
    organization_id,
    quote_id,
    version,
    itinerary_snapshot,
    total_amount,
    margin_amount,
    margin_percent,
    terms_snapshot,
    created_by
  ) values (
    target_organization_id,
    target_quote_id,
    next_version,
    current_version_record.itinerary_snapshot,
    quote_total_amount,
    quote_total_amount - quote_estimated_cost_amount,
    round(
      ((quote_total_amount - quote_estimated_cost_amount) /
        nullif(quote_total_amount, 0)) * 100,
      4
    ),
    current_version_record.terms_snapshot,
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

revoke all on function public.append_quote_version_with_cost(
  uuid, uuid, numeric, numeric
) from public;
grant execute on function public.append_quote_version_with_cost(
  uuid, uuid, numeric, numeric
) to authenticated;

-- The application mirrors this check for feedback, while this trigger remains
-- the non-bypassable boundary for the exact current commercial revision.
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
    version.net_amount,
    version.terms_snapshot
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
  if not private.quote_proposal_content_is_ready(
    quote_record.terms_snapshot
  ) then
    raise exception 'Current proposal inclusions and terms are required.'
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
    'proposal_content', jsonb_build_object(
      'schema_version', 1,
      'inclusion_count', jsonb_array_length(
        quote_record.terms_snapshot -> 'inclusions'
      ),
      'exclusion_count', jsonb_array_length(
        quote_record.terms_snapshot -> 'exclusions'
      ),
      'term_count', jsonb_array_length(
        quote_record.terms_snapshot -> 'terms'
      ),
      'sha256', encode(
        extensions.digest(
          convert_to(quote_record.terms_snapshot::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    ),
    'external_share_performed', false
  );

  return new;
end;
$$;

revoke all on function private.enforce_quote_share_guardrails()
  from public, anon, authenticated;
