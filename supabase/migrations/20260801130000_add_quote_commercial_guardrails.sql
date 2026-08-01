-- Phase 12 commercial guardrails. Quote preparation remains internal and every
-- external share remains a non-bypassable human approval.

create table public.quote_approval_policies (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  minimum_margin_percent numeric(5, 2) not null default 15.00
    check (minimum_margin_percent between 0 and 100),
  require_cost_estimate boolean not null default true,
  require_valid_until boolean not null default true,
  maximum_validity_days smallint not null default 45
    check (maximum_validity_days between 1 and 365),
  updated_by uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint quote_approval_policies_updater_same_organization_fkey
    foreign key (organization_id, updated_by)
    references public.memberships(organization_id, user_id)
    on delete set null (updated_by)
);

create index quote_approval_policies_updater_idx
  on public.quote_approval_policies (updated_by)
  where updated_by is not null;

create trigger quote_approval_policies_set_updated_at
  before update on public.quote_approval_policies
  for each row execute function public.set_updated_at();
create trigger quote_approval_policies_prevent_organization_move
  before update on public.quote_approval_policies
  for each row execute function private.prevent_organization_id_change();

alter table public.quote_approval_policies enable row level security;

create policy quote_approval_policies_member_select
  on public.quote_approval_policies
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

revoke all on table public.quote_approval_policies
  from public, anon, authenticated;
grant select on table public.quote_approval_policies to authenticated;
grant select, insert, update, delete
  on table public.quote_approval_policies to service_role;

insert into public.quote_approval_policies (organization_id)
select organization.id
from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function private.initialize_quote_approval_policy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.quote_approval_policies (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function private.initialize_quote_approval_policy()
  from public, anon, authenticated;

create trigger organizations_initialize_quote_approval_policy
  after insert on public.organizations
  for each row execute function private.initialize_quote_approval_policy();

create or replace function public.upsert_quote_approval_policy(
  target_organization_id uuid,
  target_minimum_margin_percent numeric,
  target_require_cost_estimate boolean,
  target_require_valid_until boolean,
  target_maximum_validity_days smallint
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
    updated_by
  )
  values (
    target_organization_id,
    target_minimum_margin_percent,
    target_require_cost_estimate,
    target_require_valid_until,
    target_maximum_validity_days,
    actor_id
  )
  on conflict (organization_id) do update
  set
    minimum_margin_percent = excluded.minimum_margin_percent,
    require_cost_estimate = excluded.require_cost_estimate,
    require_valid_until = excluded.require_valid_until,
    maximum_validity_days = excluded.maximum_validity_days,
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
      policy_record.maximum_validity_days;

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
      'require_cost_estimate', policy_record.require_cost_estimate,
      'require_valid_until', policy_record.require_valid_until,
      'maximum_validity_days', policy_record.maximum_validity_days
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
  smallint
) from public, anon;
grant execute on function public.upsert_quote_approval_policy(
  uuid,
  numeric,
  boolean,
  boolean,
  smallint
) to authenticated, service_role;

-- The application computes the same readiness result for useful feedback, but
-- the database is the non-bypassable boundary. Direct Data API inserts cannot
-- forge a ready snapshot or submit a stale/incomplete quote version.
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
    version.total_amount
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
      ((quote_record.total_amount - cost_amount) /
        quote_record.total_amount) * 100,
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

create trigger approval_requests_enforce_quote_share_guardrails
  before insert on public.approval_requests
  for each row execute function private.enforce_quote_share_guardrails();

-- A new immutable quote version invalidates every pending review of an older
-- version. Invalid or missing version payloads are cancelled too, never cast.
create or replace function private.cancel_stale_quote_share_approvals()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  with cancelled as (
    update public.approval_requests approval
    set
      status = 'cancelled',
      resolved_at = statement_timestamp()
    where approval.organization_id = new.organization_id
      and approval.action = 'quote.share'
      and approval.entity_type = 'quote'
      and approval.entity_id = new.id
      and approval.status = 'pending'
      and not (
        approval.payload @> jsonb_build_object(
          'quote_version',
          new.current_version
        )
      )
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
    new.organization_id,
    (select auth.uid()),
    'approval.cancelled',
    'approval_request',
    cancelled.id,
    jsonb_build_object(
      'action', 'quote.share',
      'reason', 'quote_version_changed',
      'quote_id', new.id,
      'current_quote_version', new.current_version
    )
  from cancelled;

  return new;
end;
$$;

revoke all on function private.cancel_stale_quote_share_approvals()
  from public, anon, authenticated;

create trigger quotes_cancel_stale_share_approvals
  after update of current_version on public.quotes
  for each row
  when (old.current_version is distinct from new.current_version)
  execute function private.cancel_stale_quote_share_approvals();
