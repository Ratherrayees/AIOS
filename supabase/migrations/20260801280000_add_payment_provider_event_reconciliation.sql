-- Normalize provider events into immutable reconciliation evidence. The first
-- producer is a local sandbox simulator: it receives no webhook, verifies no
-- provider signature, and cannot write a settlement or move money.

-- Service clients should consume the guarded RPC instead of mutating immutable
-- payment execution evidence directly.
revoke insert, update, delete on public.payment_link_executions
  from service_role;

create table public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  payment_link_execution_id uuid not null,
  payment_id uuid not null,
  provider_key text not null
    check (provider_key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  provider_environment text not null
    check (provider_environment in ('sandbox', 'production')),
  provider_event_id text not null
    check (
      provider_event_id = btrim(provider_event_id)
      and char_length(provider_event_id) between 8 and 180
    ),
  provider_event_type text not null
    check (
      provider_event_type in (
        'checkout.completed',
        'payment.succeeded',
        'payment.failed',
        'payment.expired'
      )
    ),
  provider_reference text not null
    check (
      provider_reference = btrim(provider_reference)
      and char_length(provider_reference) between 8 and 180
    ),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reported_amount numeric(14, 2) not null check (reported_amount > 0),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_kind text not null
    check (source_kind in ('sandbox_simulator', 'signed_webhook')),
  signature_verified boolean not null,
  reconciliation_status text not null
    check (
      reconciliation_status in (
        'matched_unposted',
        'review_required',
        'ignored'
      )
    ),
  reconciliation_reason text not null
    check (
      reconciliation_reason in (
        'exact_match',
        'execution_not_active',
        'currency_mismatch',
        'amount_mismatch',
        'unsupported_event'
      )
    ),
  occurred_at timestamptz not null,
  received_at timestamptz not null default statement_timestamp(),
  recorded_by uuid references public.profiles(id) on delete restrict,
  constraint payment_provider_events_organization_id_id_key
    unique (organization_id, id),
  constraint payment_provider_events_provider_event_key
    unique (provider_key, provider_environment, provider_event_id),
  constraint payment_provider_events_execution_same_organization_fkey
    foreign key (organization_id, payment_link_execution_id)
    references public.payment_link_executions (organization_id, id)
    on delete cascade,
  constraint payment_provider_events_payment_same_organization_fkey
    foreign key (organization_id, payment_id)
    references public.payments (organization_id, id)
    on delete cascade,
  constraint payment_provider_events_integrity_mode
    check (
      (source_kind = 'sandbox_simulator' and signature_verified = false)
      or (source_kind = 'signed_webhook' and signature_verified = true)
    ),
  constraint payment_provider_events_reconciliation_contract
    check (
      (reconciliation_status = 'matched_unposted'
        and reconciliation_reason = 'exact_match')
      or (reconciliation_status = 'review_required'
        and reconciliation_reason in (
          'execution_not_active',
          'currency_mismatch',
          'amount_mismatch'
        ))
      or (reconciliation_status = 'ignored'
        and reconciliation_reason = 'unsupported_event')
    ),
  constraint payment_provider_events_sandbox_contract
    check (
      source_kind <> 'sandbox_simulator'
      or (
        provider_key = 'sandbox'
        and provider_environment = 'sandbox'
        and provider_event_id ~ '^sbxevt_[0-9a-f]{32}$'
        and provider_event_type in ('checkout.completed', 'payment.succeeded')
        and provider_reference ~ '^sbx_[0-9a-f]{32}$'
      )
    )
);

create index payment_provider_events_org_received_idx
  on public.payment_provider_events (organization_id, received_at desc);
create index payment_provider_events_execution_idx
  on public.payment_provider_events (
    organization_id,
    payment_link_execution_id,
    occurred_at desc
  );
create index payment_provider_events_review_idx
  on public.payment_provider_events (organization_id, received_at desc)
  where reconciliation_status = 'review_required';

alter table public.payment_provider_events enable row level security;

create policy payment_provider_events_finance_select
  on public.payment_provider_events
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  );

revoke all on table public.payment_provider_events
  from public, anon, authenticated, service_role;
grant select on table public.payment_provider_events to authenticated;
grant select on table public.payment_provider_events to service_role;

create or replace function public.record_sandbox_payment_provider_event(
  target_organization_id uuid,
  target_payment_link_execution_id uuid,
  target_provider_event_id text,
  target_provider_event_type text,
  target_provider_reference text,
  target_currency text,
  target_reported_amount numeric,
  target_occurred_at_epoch_ms bigint,
  target_payload_sha256 text,
  target_recorded_by uuid
)
returns table (
  payment_provider_event_id uuid,
  reconciliation_status text,
  reconciliation_reason text,
  provider_event_id text,
  provider_event_type text,
  occurred_at timestamptz,
  received_at timestamptz,
  already_recorded boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  execution_record public.payment_link_executions%rowtype;
  existing_event public.payment_provider_events%rowtype;
  created_event public.payment_provider_events%rowtype;
  normalized_event_id text := btrim(target_provider_event_id);
  normalized_event_type text := lower(btrim(target_provider_event_type));
  normalized_reference text := btrim(target_provider_reference);
  normalized_currency text := upper(btrim(target_currency));
  normalized_payload_hash text := lower(btrim(target_payload_sha256));
  normalized_occurred_at timestamptz;
  expected_event_id text;
  expected_payload_hash text;
  next_reconciliation_status text;
  next_reconciliation_reason text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the trusted provider-event adapter may record evidence.'
      using errcode = '42501';
  end if;
  if target_reported_amount is null
    or target_reported_amount <= 0
    or target_reported_amount > 999999999999.99
    or normalized_currency !~ '^[A-Z]{3}$'
    or normalized_payload_hash !~ '^[0-9a-f]{64}$'
    or normalized_event_type not in ('checkout.completed', 'payment.succeeded')
    or normalized_event_id !~ '^sbxevt_[0-9a-f]{32}$'
    or normalized_reference !~ '^sbx_[0-9a-f]{32}$'
    or target_occurred_at_epoch_ms is null
    or target_occurred_at_epoch_ms <= 0
  then
    raise exception 'The sandbox provider-event evidence is invalid.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_recorded_by
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'finance')
  ) then
    raise exception 'The provider-event actor lacks current finance authority.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' || normalized_event_id,
      0
    )
  );

  select execution.* into execution_record
  from public.payment_link_executions execution
  where execution.organization_id = target_organization_id
    and execution.id = target_payment_link_execution_id
  for update;
  if not found
    or execution_record.provider_key <> 'sandbox'
    or execution_record.provider_environment <> 'sandbox'
    or execution_record.adapter_version <> 'sandbox-v1'
    or execution_record.provider_reference <> normalized_reference
  then
    raise exception 'A matching sandbox execution is required.'
      using errcode = '23514';
  end if;

  normalized_occurred_at := to_timestamp(
    target_occurred_at_epoch_ms::numeric / 1000
  );
  if normalized_occurred_at < execution_record.created_at - interval '5 minutes'
    or normalized_occurred_at > statement_timestamp() + interval '5 minutes'
  then
    raise exception 'The provider event time is outside the accepted window.'
      using errcode = '22023';
  end if;

  expected_event_id := 'sbxevt_' || substring(
    encode(
      extensions.digest(
        convert_to(
          concat_ws(
            E'\n',
            'sandbox-payment-event-v1',
            execution_record.id::text,
            execution_record.idempotency_key,
            normalized_event_type
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    1,
    32
  );
  if normalized_event_id <> expected_event_id then
    raise exception 'The sandbox provider event id is invalid.'
      using errcode = '22023';
  end if;

  expected_payload_hash := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\n',
          'payment-provider-event-v1',
          target_organization_id::text,
          execution_record.id::text,
          normalized_event_id,
          normalized_event_type,
          execution_record.provider_key,
          execution_record.provider_environment,
          normalized_reference,
          normalized_currency,
          to_char(target_reported_amount, 'FM999999999999990.00'),
          target_occurred_at_epoch_ms::text
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if normalized_payload_hash <> expected_payload_hash then
    raise exception 'The provider event payload hash is invalid.'
      using errcode = '22023';
  end if;

  select event.* into existing_event
  from public.payment_provider_events event
  where event.provider_key = execution_record.provider_key
    and event.provider_environment = execution_record.provider_environment
    and event.provider_event_id = normalized_event_id;
  if found then
    if existing_event.organization_id <> target_organization_id
      or existing_event.payment_link_execution_id <> execution_record.id
      or existing_event.payment_id <> execution_record.payment_id
      or existing_event.provider_event_type <> normalized_event_type
      or existing_event.provider_reference <> normalized_reference
      or existing_event.currency <> normalized_currency
      or existing_event.reported_amount <> target_reported_amount
      or existing_event.payload_sha256 <> expected_payload_hash
      or existing_event.occurred_at <> normalized_occurred_at
    then
      raise exception 'This provider event already has different evidence.'
        using errcode = '23505';
    end if;
    return query select
      existing_event.id,
      existing_event.reconciliation_status,
      existing_event.reconciliation_reason,
      existing_event.provider_event_id,
      existing_event.provider_event_type,
      existing_event.occurred_at,
      existing_event.received_at,
      true;
    return;
  end if;

  if execution_record.status <> 'active'
    or execution_record.checkout_expires_at <= statement_timestamp()
  then
    next_reconciliation_status := 'review_required';
    next_reconciliation_reason := 'execution_not_active';
  elsif execution_record.currency <> normalized_currency then
    next_reconciliation_status := 'review_required';
    next_reconciliation_reason := 'currency_mismatch';
  elsif execution_record.requested_amount <> target_reported_amount then
    next_reconciliation_status := 'review_required';
    next_reconciliation_reason := 'amount_mismatch';
  else
    next_reconciliation_status := 'matched_unposted';
    next_reconciliation_reason := 'exact_match';
  end if;

  insert into public.payment_provider_events (
    organization_id,
    payment_link_execution_id,
    payment_id,
    provider_key,
    provider_environment,
    provider_event_id,
    provider_event_type,
    provider_reference,
    currency,
    reported_amount,
    payload_sha256,
    source_kind,
    signature_verified,
    reconciliation_status,
    reconciliation_reason,
    occurred_at,
    recorded_by
  ) values (
    target_organization_id,
    execution_record.id,
    execution_record.payment_id,
    execution_record.provider_key,
    execution_record.provider_environment,
    normalized_event_id,
    normalized_event_type,
    normalized_reference,
    normalized_currency,
    target_reported_amount,
    expected_payload_hash,
    'sandbox_simulator',
    false,
    next_reconciliation_status,
    next_reconciliation_reason,
    normalized_occurred_at,
    target_recorded_by
  ) returning * into created_event;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_organization_id,
    target_recorded_by,
    'integration.event_recorded',
    'payment_provider_event',
    created_event.id,
    jsonb_build_object(
      'event', 'finance.sandbox_provider_event_recorded',
      'payment_link_execution_id', execution_record.id,
      'payment_id', execution_record.payment_id,
      'provider_key', execution_record.provider_key,
      'provider_environment', execution_record.provider_environment,
      'provider_event_type', normalized_event_type,
      'payload_sha256', expected_payload_hash,
      'source_kind', 'sandbox_simulator',
      'signature_verified', false,
      'reconciliation_status', next_reconciliation_status,
      'reconciliation_reason', next_reconciliation_reason,
      'external_network_call_performed', false,
      'provider_webhook_received', false,
      'payment_collected', false,
      'settlement_recorded', false,
      'human_settlement_required', true,
      'external_action_performed', false
    )
  );

  return query select
    created_event.id,
    created_event.reconciliation_status,
    created_event.reconciliation_reason,
    created_event.provider_event_id,
    created_event.provider_event_type,
    created_event.occurred_at,
    created_event.received_at,
    false;
end;
$$;

revoke all on function public.record_sandbox_payment_provider_event(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  bigint,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.record_sandbox_payment_provider_event(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  bigint,
  text,
  uuid
) to service_role;
