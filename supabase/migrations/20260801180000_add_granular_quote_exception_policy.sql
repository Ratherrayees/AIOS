-- Granular quote-review exceptions. Discount exposure is calculated from the
-- immutable current sell lines, while non-standard terms are compared against
-- a bounded tenant-owned standard set. Approval and audit metadata retain only
-- counts, hashes, thresholds, and risk codes—not customer or policy wording.

alter table public.quote_approval_policies
  add column maximum_discount_percent numeric(5, 2) not null default 100.00
    check (maximum_discount_percent between 0 and 100),
  add column enforce_standard_terms boolean not null default false,
  add column standard_terms jsonb not null default '[]'::jsonb;

create or replace function private.quote_standard_terms_are_valid(
  target_terms jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  term_value text;
begin
  if jsonb_typeof(target_terms) is distinct from 'array'
    or jsonb_array_length(target_terms) > 30
    or exists (
      select 1
      from jsonb_array_elements(target_terms) term(value)
      where jsonb_typeof(term.value) <> 'string'
    )
  then
    return false;
  end if;

  for term_value in
    select term.value
    from jsonb_array_elements_text(target_terms) term(value)
  loop
    if term_value <> btrim(term_value)
      or char_length(term_value) not between 1 and 300
    then
      return false;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements_text(target_terms) term(value)
    group by lower(btrim(term.value))
    having count(*) > 1
  ) then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function private.quote_standard_terms_are_valid(jsonb)
  from public, anon, authenticated;

alter table public.quote_approval_policies
  add constraint quote_approval_policies_standard_terms_valid
    check (private.quote_standard_terms_are_valid(standard_terms)),
  add constraint quote_approval_policies_enforced_terms_present
    check (
      not enforce_standard_terms
      or jsonb_array_length(standard_terms) > 0
    );

drop function public.upsert_quote_approval_policy(
  uuid,
  numeric,
  boolean,
  boolean,
  smallint
);

create or replace function public.upsert_quote_approval_policy(
  target_organization_id uuid,
  target_minimum_margin_percent numeric,
  target_require_cost_estimate boolean,
  target_require_valid_until boolean,
  target_maximum_validity_days smallint,
  target_maximum_discount_percent numeric,
  target_enforce_standard_terms boolean,
  target_standard_terms jsonb
)
returns setof public.quote_approval_policies
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  policy_record public.quote_approval_policies%rowtype;
  previous_policy public.quote_approval_policies%rowtype;
  policy_changed boolean := false;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to configure quote guardrails.'
      using errcode = '42501';
  end if;

  if target_minimum_margin_percent is null
    or target_minimum_margin_percent not between 0 and 100
    or target_require_cost_estimate is null
    or target_require_valid_until is null
    or target_maximum_validity_days is null
    or target_maximum_validity_days not between 1 and 365
    or target_maximum_discount_percent is null
    or target_maximum_discount_percent not between 0 and 100
    or target_enforce_standard_terms is null
    or not private.quote_standard_terms_are_valid(target_standard_terms)
    or (
      target_enforce_standard_terms
      and jsonb_array_length(target_standard_terms) = 0
    )
  then
    raise exception 'Choose valid bounded quote guardrails.'
      using errcode = '22023';
  end if;

  select * into previous_policy
  from public.quote_approval_policies policy
  where policy.organization_id = target_organization_id;

  insert into public.quote_approval_policies (
    organization_id,
    minimum_margin_percent,
    require_cost_estimate,
    require_valid_until,
    maximum_validity_days,
    maximum_discount_percent,
    enforce_standard_terms,
    standard_terms,
    updated_by
  ) values (
    target_organization_id,
    target_minimum_margin_percent,
    target_require_cost_estimate,
    target_require_valid_until,
    target_maximum_validity_days,
    target_maximum_discount_percent,
    target_enforce_standard_terms,
    target_standard_terms,
    actor_id
  )
  on conflict (organization_id) do update
  set
    minimum_margin_percent = excluded.minimum_margin_percent,
    require_cost_estimate = excluded.require_cost_estimate,
    require_valid_until = excluded.require_valid_until,
    maximum_validity_days = excluded.maximum_validity_days,
    maximum_discount_percent = excluded.maximum_discount_percent,
    enforce_standard_terms = excluded.enforce_standard_terms,
    standard_terms = excluded.standard_terms,
    updated_by = excluded.updated_by
  returning * into policy_record;

  policy_changed := previous_policy.organization_id is null
    or previous_policy.minimum_margin_percent is distinct from
      policy_record.minimum_margin_percent
    or previous_policy.require_cost_estimate is distinct from
      policy_record.require_cost_estimate
    or previous_policy.require_valid_until is distinct from
      policy_record.require_valid_until
    or previous_policy.maximum_validity_days is distinct from
      policy_record.maximum_validity_days
    or previous_policy.maximum_discount_percent is distinct from
      policy_record.maximum_discount_percent
    or previous_policy.enforce_standard_terms is distinct from
      policy_record.enforce_standard_terms
    or previous_policy.standard_terms is distinct from
      policy_record.standard_terms;

  if policy_changed then
    with cancelled as (
      update public.approval_requests approval
      set
        status = 'cancelled',
        resolved_at = statement_timestamp()
      where approval.organization_id = target_organization_id
        and approval.action = 'quote.share'
        and approval.status = 'pending'
      returning approval.id
    )
    insert into public.audit_events (
      organization_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    )
    select
      target_organization_id,
      actor_id,
      'approval.cancelled',
      'approval_request',
      cancelled.id,
      jsonb_build_object(
        'action', 'quote.share',
        'reason', 'quote_policy_changed'
      )
    from cancelled;
  end if;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_organization_id,
    actor_id,
    'quote.guardrail_policy_updated',
    'organization',
    target_organization_id,
    jsonb_build_object(
      'minimum_margin_percent', policy_record.minimum_margin_percent,
      'require_cost_estimate', policy_record.require_cost_estimate,
      'require_valid_until', policy_record.require_valid_until,
      'maximum_validity_days', policy_record.maximum_validity_days,
      'maximum_discount_percent', policy_record.maximum_discount_percent,
      'enforce_standard_terms', policy_record.enforce_standard_terms,
      'standard_term_count', jsonb_array_length(policy_record.standard_terms),
      'standard_terms_sha256', encode(
        extensions.digest(
          convert_to(policy_record.standard_terms::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    )
  );

  return next policy_record;
end;
$$;

revoke all on function public.upsert_quote_approval_policy(
  uuid,
  numeric,
  boolean,
  boolean,
  smallint,
  numeric,
  boolean,
  jsonb
) from public, anon;
grant execute on function public.upsert_quote_approval_policy(
  uuid,
  numeric,
  boolean,
  boolean,
  smallint,
  numeric,
  boolean,
  jsonb
) to authenticated, service_role;

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
  list_amount numeric;
  discount_amount numeric;
  discount_percent numeric;
  standard_terms_match boolean := true;
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
    policy_record.maximum_discount_percent := 100;
    policy_record.enforce_standard_terms := false;
    policy_record.standard_terms := '[]'::jsonb;
  end if;

  select estimate.estimated_cost_amount
  into cost_amount
  from public.quote_cost_estimates estimate
  where estimate.organization_id = new.organization_id
    and estimate.quote_version_id = quote_record.version_id;

  select
    coalesce(sum(round(line.quantity * line.unit_price_amount, 2)), 0),
    coalesce(sum(line.discount_amount), 0)
  into list_amount, discount_amount
  from public.quote_line_items line
  where line.organization_id = new.organization_id
    and line.quote_version_id = quote_record.version_id;
  discount_percent := case
    when list_amount > 0
      then round(discount_amount / list_amount * 100, 1)
    else 0
  end;

  if policy_record.enforce_standard_terms then
    standard_terms_match :=
      jsonb_array_length(quote_record.terms_snapshot -> 'terms') =
        jsonb_array_length(policy_record.standard_terms)
      and not exists (
        select lower(proposal_term.value)
        from jsonb_array_elements_text(
          quote_record.terms_snapshot -> 'terms'
        ) proposal_term(value)
        except
        select lower(standard_term.value)
        from jsonb_array_elements_text(
          policy_record.standard_terms
        ) standard_term(value)
      );
  end if;

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
  if discount_percent > policy_record.maximum_discount_percent then
    risk_codes := risk_codes || jsonb_build_array('discount_above_policy');
  end if;
  if not standard_terms_match then
    risk_codes := risk_codes || jsonb_build_array('non_standard_terms');
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
      'maximum_validity_days', policy_record.maximum_validity_days,
      'maximum_discount_percent', policy_record.maximum_discount_percent,
      'enforce_standard_terms', policy_record.enforce_standard_terms,
      'standard_term_count', jsonb_array_length(policy_record.standard_terms),
      'standard_terms_sha256', encode(
        extensions.digest(
          convert_to(policy_record.standard_terms::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    ),
    'commercial_exceptions', jsonb_build_object(
      'discount_percent', discount_percent,
      'standard_terms_match', standard_terms_match
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
