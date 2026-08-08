-- Explicit quote markup and commission governance. These values are protected
-- internal estimates only: they never create a payable, pay a team member,
-- change the customer price, or authorize proposal delivery.

alter table public.quote_approval_policies
  add column minimum_markup_percent numeric(7, 2) not null default 0
    check (minimum_markup_percent between 0 and 1000),
  add column commission_basis text not null default 'gross_margin'
    check (commission_basis in ('net_sell', 'gross_margin')),
  add column commission_percent numeric(5, 2) not null default 0
    check (commission_percent between 0 and 100),
  add column minimum_post_commission_margin_percent numeric(5, 2) not null default 0
    check (minimum_post_commission_margin_percent between 0 and 100);

create table public.quote_version_commercial_terms (
  quote_version_id uuid primary key,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  estimated_cost_amount numeric(14, 2) not null
    check (estimated_cost_amount >= 0),
  net_sell_amount numeric(14, 2) not null
    check (net_sell_amount >= 0),
  gross_markup_amount numeric(14, 2) not null,
  gross_markup_percent numeric(9, 4),
  commission_basis text not null
    check (commission_basis in ('net_sell', 'gross_margin')),
  commission_percent numeric(5, 2) not null
    check (commission_percent between 0 and 100),
  commission_base_amount numeric(14, 2) not null
    check (commission_base_amount >= 0),
  estimated_commission_amount numeric(14, 2) not null
    check (estimated_commission_amount >= 0),
  post_commission_margin_amount numeric(14, 2) not null,
  post_commission_margin_percent numeric(9, 4),
  policy_updated_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint quote_version_commercial_terms_org_version_key
    unique (organization_id, quote_version_id),
  constraint quote_version_commercial_terms_version_same_org_fkey
    foreign key (organization_id, quote_version_id)
    references public.quote_versions(organization_id, id)
    on delete cascade,
  constraint quote_version_commercial_terms_markup_reconciles
    check (gross_markup_amount = net_sell_amount - estimated_cost_amount),
  constraint quote_version_commercial_terms_markup_percent_reconciles
    check (
      (estimated_cost_amount = 0 and gross_markup_percent is null)
      or (
        estimated_cost_amount > 0
        and gross_markup_percent = round(
          gross_markup_amount / estimated_cost_amount * 100,
          4
        )
      )
    ),
  constraint quote_version_commercial_terms_commission_base_reconciles
    check (
      commission_base_amount = case
        when commission_basis = 'net_sell' then net_sell_amount
        else greatest(gross_markup_amount, 0)
      end
    ),
  constraint quote_version_commercial_terms_commission_reconciles
    check (
      estimated_commission_amount = round(
        commission_base_amount * commission_percent / 100,
        2
      )
    ),
  constraint quote_version_commercial_terms_post_margin_reconciles
    check (
      post_commission_margin_amount =
        gross_markup_amount - estimated_commission_amount
    ),
  constraint quote_version_commercial_terms_post_margin_percent_reconciles
    check (
      (net_sell_amount = 0 and post_commission_margin_percent is null)
      or (
        net_sell_amount > 0
        and post_commission_margin_percent = round(
          post_commission_margin_amount / net_sell_amount * 100,
          4
        )
      )
    )
);

create index quote_version_commercial_terms_org_created_idx
  on public.quote_version_commercial_terms (
    organization_id,
    created_at desc
  );

create trigger quote_version_commercial_terms_prevent_org_move
  before update on public.quote_version_commercial_terms
  for each row execute function private.prevent_organization_id_change();

create or replace function private.reject_quote_commercial_terms_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Quote commercial terms are immutable.'
    using errcode = '42501';
end;
$$;

revoke all on function private.reject_quote_commercial_terms_change()
  from public, anon, authenticated;

create trigger quote_version_commercial_terms_immutable
  before update on public.quote_version_commercial_terms
  for each row execute function private.reject_quote_commercial_terms_change();

alter table public.quote_version_commercial_terms enable row level security;

create policy quote_version_commercial_terms_commercial_select
  on public.quote_version_commercial_terms
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

revoke all on table public.quote_version_commercial_terms
  from public, anon, authenticated;
grant select on table public.quote_version_commercial_terms to authenticated;
grant select, insert, update, delete
  on table public.quote_version_commercial_terms to service_role;

create or replace function private.capture_quote_version_commercial_terms()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  version_record record;
  policy_record public.quote_approval_policies%rowtype;
  markup_amount numeric;
  markup_percent numeric;
  commission_base numeric;
  commission_amount numeric;
  post_margin_amount numeric;
  post_margin_percent numeric;
begin
  select version.net_amount, version.created_by
  into version_record
  from public.quote_versions version
  where version.organization_id = new.organization_id
    and version.id = new.quote_version_id
  for share;
  if not found then
    raise exception 'Quote commercial terms require an exact quote version.'
      using errcode = '23503';
  end if;

  select * into policy_record
  from public.quote_approval_policies policy
  where policy.organization_id = new.organization_id
  for share;
  if not found then
    raise exception 'Quote commercial terms require an organization policy.'
      using errcode = 'P0002';
  end if;

  markup_amount := version_record.net_amount - new.estimated_cost_amount;
  markup_percent := case
    when new.estimated_cost_amount > 0 then round(
      markup_amount / new.estimated_cost_amount * 100,
      4
    )
    else null
  end;
  commission_base := case
    when policy_record.commission_basis = 'net_sell'
      then version_record.net_amount
    else greatest(markup_amount, 0)
  end;
  commission_amount := round(
    commission_base * policy_record.commission_percent / 100,
    2
  );
  post_margin_amount := markup_amount - commission_amount;
  post_margin_percent := case
    when version_record.net_amount > 0 then round(
      post_margin_amount / version_record.net_amount * 100,
      4
    )
    else null
  end;

  insert into public.quote_version_commercial_terms (
    quote_version_id,
    organization_id,
    estimated_cost_amount,
    net_sell_amount,
    gross_markup_amount,
    gross_markup_percent,
    commission_basis,
    commission_percent,
    commission_base_amount,
    estimated_commission_amount,
    post_commission_margin_amount,
    post_commission_margin_percent,
    policy_updated_at,
    created_by
  )
  values (
    new.quote_version_id,
    new.organization_id,
    new.estimated_cost_amount,
    version_record.net_amount,
    markup_amount,
    markup_percent,
    policy_record.commission_basis,
    policy_record.commission_percent,
    commission_base,
    commission_amount,
    post_margin_amount,
    post_margin_percent,
    policy_record.updated_at,
    coalesce(new.created_by, version_record.created_by)
  );

  return new;
end;
$$;

revoke all on function private.capture_quote_version_commercial_terms()
  from public, anon, authenticated;

create trigger quote_cost_estimates_capture_commercial_terms
  after insert on public.quote_cost_estimates
  for each row execute function private.capture_quote_version_commercial_terms();

-- Existing immutable costed versions receive a snapshot of the current policy.
insert into public.quote_version_commercial_terms (
  quote_version_id,
  organization_id,
  estimated_cost_amount,
  net_sell_amount,
  gross_markup_amount,
  gross_markup_percent,
  commission_basis,
  commission_percent,
  commission_base_amount,
  estimated_commission_amount,
  post_commission_margin_amount,
  post_commission_margin_percent,
  policy_updated_at,
  created_by,
  created_at
)
select
  estimate.quote_version_id,
  estimate.organization_id,
  estimate.estimated_cost_amount,
  version.net_amount,
  version.net_amount - estimate.estimated_cost_amount,
  case
    when estimate.estimated_cost_amount > 0 then round(
      (version.net_amount - estimate.estimated_cost_amount) /
        estimate.estimated_cost_amount * 100,
      4
    )
    else null
  end,
  policy.commission_basis,
  policy.commission_percent,
  case
    when policy.commission_basis = 'net_sell' then version.net_amount
    else greatest(version.net_amount - estimate.estimated_cost_amount, 0)
  end,
  round(
    (
      case
        when policy.commission_basis = 'net_sell' then version.net_amount
        else greatest(version.net_amount - estimate.estimated_cost_amount, 0)
      end
    ) * policy.commission_percent / 100,
    2
  ),
  (version.net_amount - estimate.estimated_cost_amount) - round(
    (
      case
        when policy.commission_basis = 'net_sell' then version.net_amount
        else greatest(version.net_amount - estimate.estimated_cost_amount, 0)
      end
    ) * policy.commission_percent / 100,
    2
  ),
  case
    when version.net_amount > 0 then round(
      (
        (version.net_amount - estimate.estimated_cost_amount) - round(
          (
            case
              when policy.commission_basis = 'net_sell' then version.net_amount
              else greatest(version.net_amount - estimate.estimated_cost_amount, 0)
            end
          ) * policy.commission_percent / 100,
          2
        )
      ) / version.net_amount * 100,
      4
    )
    else null
  end,
  policy.updated_at,
  estimate.created_by,
  estimate.created_at
from public.quote_cost_estimates estimate
join public.quote_versions version
  on version.organization_id = estimate.organization_id
  and version.id = estimate.quote_version_id
join public.quote_approval_policies policy
  on policy.organization_id = estimate.organization_id;

drop function public.upsert_quote_approval_policy(
  uuid,
  numeric,
  boolean,
  boolean,
  smallint,
  numeric,
  boolean,
  jsonb
);

create function public.upsert_quote_approval_policy(
  target_organization_id uuid,
  target_minimum_margin_percent numeric,
  target_require_cost_estimate boolean,
  target_require_valid_until boolean,
  target_maximum_validity_days smallint,
  target_maximum_discount_percent numeric,
  target_enforce_standard_terms boolean,
  target_standard_terms jsonb,
  target_minimum_markup_percent numeric,
  target_commission_basis text,
  target_commission_percent numeric,
  target_minimum_post_commission_margin_percent numeric
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
    or target_minimum_markup_percent is null
    or target_minimum_markup_percent not between 0 and 1000
    or target_commission_basis not in ('net_sell', 'gross_margin')
    or target_commission_percent is null
    or target_commission_percent not between 0 and 100
    or target_minimum_post_commission_margin_percent is null
    or target_minimum_post_commission_margin_percent not between 0 and 100
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
    minimum_markup_percent,
    commission_basis,
    commission_percent,
    minimum_post_commission_margin_percent,
    updated_by
  )
  values (
    target_organization_id,
    target_minimum_margin_percent,
    target_require_cost_estimate,
    target_require_valid_until,
    target_maximum_validity_days,
    target_maximum_discount_percent,
    target_enforce_standard_terms,
    target_standard_terms,
    target_minimum_markup_percent,
    target_commission_basis,
    target_commission_percent,
    target_minimum_post_commission_margin_percent,
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
    minimum_markup_percent = excluded.minimum_markup_percent,
    commission_basis = excluded.commission_basis,
    commission_percent = excluded.commission_percent,
    minimum_post_commission_margin_percent =
      excluded.minimum_post_commission_margin_percent,
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
      policy_record.standard_terms
    or previous_policy.minimum_markup_percent is distinct from
      policy_record.minimum_markup_percent
    or previous_policy.commission_basis is distinct from
      policy_record.commission_basis
    or previous_policy.commission_percent is distinct from
      policy_record.commission_percent
    or previous_policy.minimum_post_commission_margin_percent is distinct from
      policy_record.minimum_post_commission_margin_percent;

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
  )
  values (
    target_organization_id,
    actor_id,
    'quote.guardrail_policy_updated',
    'organization',
    target_organization_id,
    jsonb_build_object(
      'minimum_margin_percent', policy_record.minimum_margin_percent,
      'minimum_markup_percent', policy_record.minimum_markup_percent,
      'require_cost_estimate', policy_record.require_cost_estimate,
      'require_valid_until', policy_record.require_valid_until,
      'maximum_validity_days', policy_record.maximum_validity_days,
      'maximum_discount_percent', policy_record.maximum_discount_percent,
      'commission_basis', policy_record.commission_basis,
      'commission_percent', policy_record.commission_percent,
      'minimum_post_commission_margin_percent',
        policy_record.minimum_post_commission_margin_percent,
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
  jsonb,
  numeric,
  text,
  numeric,
  numeric
) from public, anon;
grant execute on function public.upsert_quote_approval_policy(
  uuid,
  numeric,
  boolean,
  boolean,
  smallint,
  numeric,
  boolean,
  jsonb,
  numeric,
  text,
  numeric,
  numeric
) to authenticated, service_role;

-- PostgreSQL runs same-event triggers alphabetically, so this validator runs
-- after approval_requests_enforce_quote_share_guardrails has canonicalized the
-- base payload. It appends only content-free commercial evidence.
create or replace function private.enforce_quote_profitability_guardrails()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quote_record record;
  policy_record public.quote_approval_policies%rowtype;
  terms_record public.quote_version_commercial_terms%rowtype;
  risk_codes jsonb;
  guardrail_status text;
begin
  if new.action <> 'quote.share' then
    return new;
  end if;

  select quote.current_version, version.id as version_id
  into quote_record
  from public.quotes quote
  join public.quote_versions version
    on version.organization_id = quote.organization_id
    and version.quote_id = quote.id
    and version.version = quote.current_version
  where quote.organization_id = new.organization_id
    and quote.id = new.entity_id
  for share of quote;

  select * into policy_record
  from public.quote_approval_policies policy
  where policy.organization_id = new.organization_id
  for share;

  select * into terms_record
  from public.quote_version_commercial_terms terms
  where terms.organization_id = new.organization_id
    and terms.quote_version_id = quote_record.version_id;

  if policy_record.require_cost_estimate
    and terms_record.quote_version_id is null
  then
    raise exception 'Current immutable markup and commission evidence is required.'
      using errcode = '22023';
  end if;

  risk_codes := coalesce(new.payload -> 'risk_codes', '[]'::jsonb);
  if terms_record.quote_version_id is not null then
    if terms_record.gross_markup_percent is not null
      and terms_record.gross_markup_percent < policy_record.minimum_markup_percent
    then
      risk_codes := risk_codes || jsonb_build_array('markup_below_floor');
    end if;
    if terms_record.post_commission_margin_percent is not null
      and terms_record.post_commission_margin_percent <
        policy_record.minimum_post_commission_margin_percent
    then
      risk_codes := risk_codes ||
        jsonb_build_array('post_commission_margin_below_floor');
    end if;
    if terms_record.commission_basis <> policy_record.commission_basis
      or terms_record.commission_percent <> policy_record.commission_percent
    then
      risk_codes := risk_codes || jsonb_build_array('commission_policy_stale');
    end if;
  end if;

  risk_codes := (
    select coalesce(jsonb_agg(code order by first_position), '[]'::jsonb)
    from (
      select code, min(position) as first_position
      from jsonb_array_elements_text(risk_codes)
        with ordinality item(code, position)
      group by code
    ) distinct_codes
  );
  guardrail_status := case
    when jsonb_array_length(risk_codes) > 0 then 'exception_review'
    else 'ready'
  end;

  new.payload := jsonb_set(
    new.payload,
    '{risk_codes}',
    risk_codes,
    true
  );
  new.payload := jsonb_set(
    new.payload,
    '{guardrail_status}',
    to_jsonb(guardrail_status),
    true
  );
  new.payload := jsonb_set(
    new.payload,
    '{guardrail_policy}',
    coalesce(new.payload -> 'guardrail_policy', '{}'::jsonb) ||
      jsonb_build_object(
        'minimum_markup_percent', policy_record.minimum_markup_percent,
        'commission_basis', policy_record.commission_basis,
        'commission_percent', policy_record.commission_percent,
        'minimum_post_commission_margin_percent',
          policy_record.minimum_post_commission_margin_percent
      ),
    true
  );
  new.payload := jsonb_set(
    new.payload,
    '{commercial_exceptions}',
    coalesce(new.payload -> 'commercial_exceptions', '{}'::jsonb) ||
      jsonb_build_object(
        'gross_markup_percent', terms_record.gross_markup_percent,
        'commission_basis', terms_record.commission_basis,
        'commission_percent', terms_record.commission_percent,
        'post_commission_margin_percent',
          terms_record.post_commission_margin_percent,
        'commission_policy_current',
          terms_record.quote_version_id is not null
          and terms_record.commission_basis = policy_record.commission_basis
          and terms_record.commission_percent = policy_record.commission_percent
      ),
    true
  );

  return new;
end;
$$;

revoke all on function private.enforce_quote_profitability_guardrails()
  from public, anon, authenticated;

create trigger approval_requests_validate_quote_profitability
  before insert on public.approval_requests
  for each row execute function private.enforce_quote_profitability_guardrails();
