-- Provider-neutral platform plans, subscriptions, and entitlement snapshots.
-- Provider webhooks remain unreleased: canonical product authorization reads
-- entitlement evidence, never Stripe/Razorpay product names.

create type public.platform_plan_status as enum ('draft', 'active', 'retired');
create type public.billing_interval as enum ('month', 'year');
create type public.organization_subscription_status as enum (
  'trialing', 'active', 'past_due', 'grace', 'canceled'
);

create table public.platform_plans (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null check (plan_code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  version integer not null check (version > 0),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null check (char_length(btrim(description)) between 12 and 500),
  status public.platform_plan_status not null default 'draft',
  created_by uuid not null references public.profiles(id) on delete restrict,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (plan_code, version),
  constraint platform_plans_status_timestamps check (
    (status = 'draft' and activated_at is null and retired_at is null)
    or (status = 'active' and activated_at is not null and retired_at is null)
    or (status = 'retired' and activated_at is not null and retired_at is not null)
  )
);

create table public.platform_plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.platform_plans(id) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  interval public.billing_interval not null,
  amount_minor bigint not null check (amount_minor >= 0),
  created_at timestamptz not null default statement_timestamp(),
  unique (plan_id, currency, interval)
);

create table public.platform_entitlement_definitions (
  entitlement_key text primary key check (entitlement_key ~ '^[a-z][a-z0-9_.]{2,79}$'),
  label text not null check (char_length(btrim(label)) between 2 and 100),
  value_type text not null check (value_type in ('boolean', 'integer')),
  description text not null check (char_length(btrim(description)) between 12 and 300),
  created_at timestamptz not null default statement_timestamp()
);

insert into public.platform_entitlement_definitions (
  entitlement_key, label, value_type, description
) values
  ('users.max', 'Maximum active users', 'integer', 'Maximum active agency memberships included in the plan.'),
  ('ai.runs.monthly', 'Monthly AI runs', 'integer', 'Maximum governed model runs available during one month.'),
  ('storage.gb', 'Storage allowance', 'integer', 'Private document storage allowance measured in gigabytes.'),
  ('ai.assisted', 'Assisted AI', 'boolean', 'Allows review-first AI drafting and recommendations.'),
  ('ai.autopilot', 'AIOS Autopilot', 'boolean', 'Allows policy-bounded internal automatic actions.'),
  ('automation.email', 'Email automation', 'boolean', 'Allows approved email delivery workflows.'),
  ('automation.whatsapp', 'WhatsApp automation', 'boolean', 'Allows approved WhatsApp delivery workflows.'),
  ('analytics.exports', 'Analytics exports', 'boolean', 'Allows formula-safe management and accounting exports.');

create table public.platform_plan_entitlements (
  plan_id uuid not null references public.platform_plans(id) on delete restrict,
  entitlement_key text not null references public.platform_entitlement_definitions(entitlement_key) on delete restrict,
  boolean_value boolean,
  integer_value bigint,
  created_at timestamptz not null default statement_timestamp(),
  primary key (plan_id, entitlement_key),
  constraint platform_plan_entitlements_one_value check (
    (boolean_value is not null and integer_value is null)
    or (boolean_value is null and integer_value is not null and integer_value >= 0)
  )
);

create table public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.platform_plans(id) on delete restrict,
  status public.organization_subscription_status not null,
  source text not null default 'manual' check (source in ('manual', 'provider')),
  provider text,
  provider_customer_ref text,
  provider_subscription_ref text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  reason text not null check (char_length(btrim(reason)) between 12 and 500),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint organization_subscriptions_provider_refs check (
    (source = 'manual' and provider is null and provider_customer_ref is null and provider_subscription_ref is null)
    or (source = 'provider' and char_length(btrim(provider)) between 2 and 40 and provider_subscription_ref is not null)
  ),
  constraint organization_subscriptions_period check (
    current_period_start is null or current_period_end is null or current_period_end > current_period_start
  )
);

create table public.organization_subscription_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.organization_subscriptions(id) on delete cascade,
  previous_status public.organization_subscription_status,
  next_status public.organization_subscription_status not null,
  previous_plan_id uuid references public.platform_plans(id) on delete restrict,
  next_plan_id uuid not null references public.platform_plans(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 12 and 500),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  version bigint not null check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  unique (subscription_id, version)
);

create table public.organization_entitlement_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.organization_subscriptions(id) on delete cascade,
  subscription_version bigint not null check (subscription_version > 0),
  plan_id uuid not null references public.platform_plans(id) on delete restrict,
  entitlements jsonb not null check (jsonb_typeof(entitlements) = 'object'),
  effective_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (subscription_id, subscription_version),
  constraint organization_entitlement_snapshots_expiry check (
    expires_at is null or expires_at > effective_at
  )
);

create index platform_plans_status_code_idx on public.platform_plans (status, plan_code, version desc);
create index organization_subscriptions_status_idx on public.organization_subscriptions (status, updated_at desc);
create index organization_subscription_events_org_created_idx on public.organization_subscription_events (organization_id, created_at desc);
create index organization_entitlement_snapshots_org_effective_idx on public.organization_entitlement_snapshots (organization_id, effective_at desc);

create trigger platform_plans_set_updated_at
  before update on public.platform_plans
  for each row execute function public.set_updated_at();
create trigger organization_subscriptions_set_updated_at
  before update on public.organization_subscriptions
  for each row execute function public.set_updated_at();

create or replace function private.protect_platform_plan_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status <> 'draft' and (
    old.plan_code <> new.plan_code
    or old.version <> new.version
    or old.name <> new.name
    or old.description <> new.description
    or old.created_by <> new.created_by
    or old.created_at <> new.created_at
  ) then
    raise exception 'An activated plan version is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_platform_plan_version() from public;
create trigger platform_plans_protect_version
  before update on public.platform_plans
  for each row execute function private.protect_platform_plan_version();

create or replace function private.require_commercial_superadmin(actor_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.platform_admins administrator
    where administrator.user_id = actor_id
      and administrator.role = 'superadmin'
      and administrator.status = 'active'
  ) then
    raise exception 'An active platform superadmin is required.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_commercial_superadmin(uuid) from public;

create or replace function private.plan_entitlement_snapshot(target_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    jsonb_object_agg(
      entitlement.entitlement_key,
      case
        when entitlement.boolean_value is not null then to_jsonb(entitlement.boolean_value)
        else to_jsonb(entitlement.integer_value)
      end
    ),
    '{}'::jsonb
  )
  from public.platform_plan_entitlements entitlement
  where entitlement.plan_id = target_plan_id;
$$;
revoke all on function private.plan_entitlement_snapshot(uuid) from public;

create or replace function public.create_platform_plan_service(
  target_plan_code text,
  target_name text,
  target_description text,
  target_currency text,
  target_interval public.billing_interval,
  target_amount_minor bigint,
  target_user_limit bigint,
  target_monthly_ai_runs bigint,
  target_storage_gb bigint,
  target_assisted_ai boolean,
  target_autopilot_ai boolean,
  target_email_automation boolean,
  target_whatsapp_automation boolean,
  target_analytics_exports boolean,
  actor_id uuid,
  creation_reason text
)
returns public.platform_plans
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_code text := lower(btrim(coalesce(target_plan_code, '')));
  normalized_name text := btrim(coalesce(target_name, ''));
  normalized_description text := btrim(coalesce(target_description, ''));
  normalized_currency text := upper(btrim(coalesce(target_currency, '')));
  normalized_reason text := btrim(coalesce(creation_reason, ''));
  next_version integer;
  created_plan public.platform_plans;
begin
  perform private.require_commercial_superadmin(actor_id);
  if normalized_code !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$' or char_length(normalized_code) > 60 then
    raise exception 'Plan code is invalid.' using errcode = '22023';
  end if;
  if char_length(normalized_name) < 2 or char_length(normalized_name) > 80 then
    raise exception 'Plan name is invalid.' using errcode = '22023';
  end if;
  if char_length(normalized_description) < 12 or char_length(normalized_description) > 500 then
    raise exception 'Plan description is invalid.' using errcode = '22023';
  end if;
  if normalized_currency !~ '^[A-Z]{3}$' or target_amount_minor < 0 then
    raise exception 'Plan price is invalid.' using errcode = '22023';
  end if;
  if target_user_limit < 1 or target_monthly_ai_runs < 0 or target_storage_gb < 0 then
    raise exception 'Plan limits are invalid.' using errcode = '22023';
  end if;
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A creation reason between 12 and 500 characters is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('aios:plan:' || normalized_code));
  select coalesce(max(plan.version), 0) + 1 into next_version
  from public.platform_plans plan where plan.plan_code = normalized_code;

  insert into public.platform_plans (
    plan_code, version, name, description, created_by
  ) values (
    normalized_code, next_version, normalized_name, normalized_description, actor_id
  ) returning * into created_plan;

  insert into public.platform_plan_prices (plan_id, currency, interval, amount_minor)
  values (created_plan.id, normalized_currency, target_interval, target_amount_minor);

  insert into public.platform_plan_entitlements (
    plan_id, entitlement_key, integer_value, boolean_value
  ) values
    (created_plan.id, 'users.max', target_user_limit, null),
    (created_plan.id, 'ai.runs.monthly', target_monthly_ai_runs, null),
    (created_plan.id, 'storage.gb', target_storage_gb, null),
    (created_plan.id, 'ai.assisted', null, target_assisted_ai),
    (created_plan.id, 'ai.autopilot', null, target_autopilot_ai),
    (created_plan.id, 'automation.email', null, target_email_automation),
    (created_plan.id, 'automation.whatsapp', null, target_whatsapp_automation),
    (created_plan.id, 'analytics.exports', null, target_analytics_exports);

  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id, 'billing.plan_created', 'platform_plan', created_plan.id,
    jsonb_build_object('planCode', normalized_code, 'version', next_version, 'reason', normalized_reason)
  );
  return created_plan;
end;
$$;

create or replace function public.set_platform_plan_status_service(
  target_plan_id uuid,
  target_status public.platform_plan_status,
  actor_id uuid,
  change_reason text
)
returns public.platform_plans
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_plan public.platform_plans;
  updated_plan public.platform_plans;
  normalized_reason text := btrim(coalesce(change_reason, ''));
begin
  perform private.require_commercial_superadmin(actor_id);
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A plan status reason between 12 and 500 characters is required.' using errcode = '22023';
  end if;
  select plan.* into current_plan from public.platform_plans plan
  where plan.id = target_plan_id for update;
  if not found then raise exception 'Plan version was not found.' using errcode = 'P0002'; end if;
  if not (
    (current_plan.status = 'draft' and target_status = 'active')
    or (current_plan.status = 'active' and target_status = 'retired')
  ) then
    raise exception 'The requested plan transition is not allowed.' using errcode = '22023';
  end if;
  if target_status = 'active' and (
    not exists (select 1 from public.platform_plan_prices price where price.plan_id = target_plan_id)
    or (select count(*) from public.platform_plan_entitlements entitlement where entitlement.plan_id = target_plan_id) <> 8
  ) then
    raise exception 'A complete price and entitlement set is required before activation.' using errcode = '22023';
  end if;

  update public.platform_plans plan
  set status = target_status,
      activated_at = case when target_status = 'active' then statement_timestamp() else plan.activated_at end,
      retired_at = case when target_status = 'retired' then statement_timestamp() else null end
  where plan.id = target_plan_id returning * into updated_plan;

  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id, 'billing.plan_status_changed', 'platform_plan', target_plan_id,
    jsonb_build_object('previousStatus', current_plan.status, 'nextStatus', target_status, 'reason', normalized_reason)
  );
  return updated_plan;
end;
$$;

create or replace function public.set_organization_subscription_service(
  target_organization_id uuid,
  target_plan_id uuid,
  target_status public.organization_subscription_status,
  target_trial_ends_at timestamptz,
  target_period_start timestamptz,
  target_period_end timestamptz,
  target_grace_ends_at timestamptz,
  target_cancel_at_period_end boolean,
  actor_id uuid,
  change_reason text,
  expected_version bigint
)
returns public.organization_subscriptions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_subscription public.organization_subscriptions;
  updated_subscription public.organization_subscriptions;
  selected_plan public.platform_plans;
  normalized_reason text := btrim(coalesce(change_reason, ''));
  next_version bigint := 1;
  previous_status public.organization_subscription_status;
  previous_plan_id uuid;
  transition_allowed boolean := false;
  snapshot_expiry timestamptz;
begin
  perform private.require_commercial_superadmin(actor_id);
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A subscription reason between 12 and 500 characters is required.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations organization where organization.id = target_organization_id) then
    raise exception 'Organization was not found.' using errcode = 'P0002';
  end if;
  select plan.* into selected_plan from public.platform_plans plan where plan.id = target_plan_id;
  if not found or selected_plan.status <> 'active' then
    raise exception 'An active plan version is required.' using errcode = '22023';
  end if;
  if target_status = 'trialing' and (target_trial_ends_at is null or target_trial_ends_at <= statement_timestamp()) then
    raise exception 'A future trial end is required.' using errcode = '22023';
  end if;
  if target_status = 'grace' and (target_grace_ends_at is null or target_grace_ends_at <= statement_timestamp()) then
    raise exception 'A future grace end is required.' using errcode = '22023';
  end if;
  if target_period_start is not null and target_period_end is not null and target_period_end <= target_period_start then
    raise exception 'Subscription period is invalid.' using errcode = '22023';
  end if;

  select subscription.* into current_subscription
  from public.organization_subscriptions subscription
  where subscription.organization_id = target_organization_id
  for update;

  if found then
    if expected_version is null or current_subscription.version <> expected_version then
      raise exception 'Subscription changed. Refresh and try again.' using errcode = '40001';
    end if;
    previous_status := current_subscription.status;
    previous_plan_id := current_subscription.plan_id;
    transition_allowed := case current_subscription.status
      when 'trialing' then target_status in ('trialing', 'active', 'canceled')
      when 'active' then target_status in ('active', 'past_due', 'grace', 'canceled')
      when 'past_due' then target_status in ('active', 'past_due', 'grace', 'canceled')
      when 'grace' then target_status in ('active', 'grace', 'canceled')
      when 'canceled' then target_status in ('trialing', 'active', 'canceled')
      else false
    end;
    if not transition_allowed then
      raise exception 'The requested subscription transition is not allowed.' using errcode = '22023';
    end if;
    next_version := current_subscription.version + 1;
    update public.organization_subscriptions subscription
    set plan_id = target_plan_id,
        status = target_status,
        trial_ends_at = case when target_status = 'trialing' then target_trial_ends_at else null end,
        current_period_start = target_period_start,
        current_period_end = target_period_end,
        grace_ends_at = case when target_status = 'grace' then target_grace_ends_at else null end,
        cancel_at_period_end = target_cancel_at_period_end,
        reason = normalized_reason,
        changed_by = actor_id,
        version = next_version
    where subscription.id = current_subscription.id
    returning * into updated_subscription;
  else
    if expected_version is not null then
      raise exception 'No subscription exists at the expected version.' using errcode = '40001';
    end if;
    if target_status not in ('trialing', 'active') then
      raise exception 'A new subscription must begin as trialing or active.' using errcode = '22023';
    end if;
    insert into public.organization_subscriptions (
      organization_id, plan_id, status, trial_ends_at, current_period_start,
      current_period_end, grace_ends_at, cancel_at_period_end, reason, changed_by
    ) values (
      target_organization_id, target_plan_id, target_status,
      case when target_status = 'trialing' then target_trial_ends_at else null end,
      target_period_start, target_period_end,
      case when target_status = 'grace' then target_grace_ends_at else null end,
      target_cancel_at_period_end, normalized_reason, actor_id
    ) returning * into updated_subscription;
  end if;

  snapshot_expiry := case
    when target_status = 'trialing' then target_trial_ends_at
    when target_status = 'grace' then target_grace_ends_at
    when target_status = 'canceled' then statement_timestamp() + interval '1 microsecond'
    else target_period_end
  end;
  insert into public.organization_entitlement_snapshots (
    organization_id, subscription_id, subscription_version, plan_id,
    entitlements, expires_at
  ) values (
    target_organization_id, updated_subscription.id, next_version, target_plan_id,
    case when target_status = 'canceled' then '{}'::jsonb else private.plan_entitlement_snapshot(target_plan_id) end,
    snapshot_expiry
  );
  insert into public.organization_subscription_events (
    organization_id, subscription_id, previous_status, next_status,
    previous_plan_id, next_plan_id, reason, actor_id, version
  ) values (
    target_organization_id, updated_subscription.id, previous_status, target_status,
    previous_plan_id, target_plan_id, normalized_reason, actor_id, next_version
  );
  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id, 'billing.subscription_changed', 'organization', target_organization_id,
    jsonb_build_object(
      'subscriptionId', updated_subscription.id,
      'previousStatus', previous_status,
      'nextStatus', target_status,
      'planId', target_plan_id,
      'version', next_version,
      'reason', normalized_reason
    )
  );
  return updated_subscription;
end;
$$;

create or replace function public.get_current_billing_summary(target_organization_id uuid)
returns table (
  organization_id uuid,
  plan_code text,
  plan_version integer,
  plan_name text,
  subscription_status public.organization_subscription_status,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean,
  prices jsonb,
  entitlements jsonb,
  subscription_version bigint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception 'Agency owner or admin authority is required.' using errcode = '42501';
  end if;
  return query
  select
    subscription.organization_id,
    plan.plan_code,
    plan.version,
    plan.name,
    subscription.status,
    subscription.trial_ends_at,
    subscription.current_period_end,
    subscription.grace_ends_at,
    subscription.cancel_at_period_end,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', price.currency,
        'interval', price.interval,
        'amountMinor', price.amount_minor
      ) order by price.currency, price.interval)
      from public.platform_plan_prices price where price.plan_id = plan.id
    ), '[]'::jsonb),
    coalesce(snapshot.entitlements, '{}'::jsonb),
    subscription.version,
    subscription.updated_at
  from public.organization_subscriptions subscription
  join public.platform_plans plan on plan.id = subscription.plan_id
  left join public.organization_entitlement_snapshots snapshot
    on snapshot.subscription_id = subscription.id
    and snapshot.subscription_version = subscription.version
  where subscription.organization_id = target_organization_id;
end;
$$;

alter table public.platform_plans enable row level security;
alter table public.platform_plan_prices enable row level security;
alter table public.platform_entitlement_definitions enable row level security;
alter table public.platform_plan_entitlements enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.organization_subscription_events enable row level security;
alter table public.organization_entitlement_snapshots enable row level security;

revoke all on table public.platform_plans, public.platform_plan_prices,
  public.platform_entitlement_definitions, public.platform_plan_entitlements,
  public.organization_subscriptions, public.organization_subscription_events,
  public.organization_entitlement_snapshots
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.platform_plans,
  public.organization_subscriptions to service_role;
grant select, insert on table public.platform_plan_prices,
  public.platform_entitlement_definitions, public.platform_plan_entitlements,
  public.organization_subscription_events, public.organization_entitlement_snapshots
  to service_role;

revoke all on function public.create_platform_plan_service(
  text, text, text, text, public.billing_interval, bigint, bigint, bigint,
  bigint, boolean, boolean, boolean, boolean, boolean, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_platform_plan_service(
  text, text, text, text, public.billing_interval, bigint, bigint, bigint,
  bigint, boolean, boolean, boolean, boolean, boolean, uuid, text
) to service_role;
revoke all on function public.set_platform_plan_status_service(
  uuid, public.platform_plan_status, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_platform_plan_status_service(
  uuid, public.platform_plan_status, uuid, text
) to service_role;
revoke all on function public.set_organization_subscription_service(
  uuid, uuid, public.organization_subscription_status, timestamptz,
  timestamptz, timestamptz, timestamptz, boolean, uuid, text, bigint
) from public, anon, authenticated;
grant execute on function public.set_organization_subscription_service(
  uuid, uuid, public.organization_subscription_status, timestamptz,
  timestamptz, timestamptz, timestamptz, boolean, uuid, text, bigint
) to service_role;
revoke all on function public.get_current_billing_summary(uuid) from public, anon;
grant execute on function public.get_current_billing_summary(uuid) to authenticated;

comment on table public.organization_entitlement_snapshots is
  'Canonical product-access evidence derived from one immutable plan version; provider product names are never authorization.';
