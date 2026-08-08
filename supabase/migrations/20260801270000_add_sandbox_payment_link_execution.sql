-- Execute an approved payment-link request through a provider-neutral evidence
-- contract. This first adapter is deliberately sandbox-only: it creates an
-- internal simulation URL, performs no provider network call, sends no message,
-- and cannot collect or settle real money.

create table public.payment_link_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  payment_link_draft_id uuid not null,
  approval_request_id uuid not null,
  payment_id uuid not null,
  invoice_issuance_id uuid not null,
  provider_key text not null
    check (provider_key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  provider_environment text not null
    check (provider_environment in ('sandbox', 'production')),
  adapter_version text not null
    check (adapter_version ~ '^[a-z0-9_-]+-v[0-9]+$'),
  status text not null default 'active'
    check (status in ('active', 'completed', 'expired', 'invalidated', 'failed')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  requested_amount numeric(14, 2) not null check (requested_amount > 0),
  source_evidence_sha256 text not null
    check (source_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null
    check (idempotency_key ~ '^[0-9a-f]{64}$'),
  provider_reference text not null
    check (
      provider_reference = btrim(provider_reference)
      and char_length(provider_reference) between 8 and 180
    ),
  checkout_target text not null
    check (char_length(checkout_target) between 20 and 500),
  checkout_token_sha256 text not null
    check (checkout_token_sha256 ~ '^[0-9a-f]{64}$'),
  checkout_expires_at timestamptz not null,
  executed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  invalidated_at timestamptz,
  constraint payment_link_executions_organization_id_id_key
    unique (organization_id, id),
  constraint payment_link_executions_one_approval_key
    unique (approval_request_id),
  constraint payment_link_executions_idempotency_key
    unique (idempotency_key),
  constraint payment_link_executions_token_key
    unique (checkout_token_sha256),
  constraint payment_link_executions_provider_reference_key
    unique (provider_key, provider_environment, provider_reference),
  constraint payment_link_executions_lifecycle_evidence
    check (
      (status = 'invalidated' and invalidated_at is not null)
      or (status <> 'invalidated' and invalidated_at is null)
    ),
  constraint payment_link_executions_sandbox_contract
    check (
      provider_environment <> 'sandbox'
      or (
        provider_key = 'sandbox'
        and adapter_version = 'sandbox-v1'
        and provider_reference ~ '^sbx_[0-9a-f]{32}$'
        and checkout_target ~ '^/sandbox/pay/[A-Za-z0-9_-]{43}$'
      )
    ),
  constraint payment_link_executions_draft_same_organization_fkey
    foreign key (organization_id, payment_link_draft_id)
    references public.payment_link_drafts (organization_id, id)
    on delete cascade,
  constraint payment_link_executions_approval_same_organization_fkey
    foreign key (organization_id, approval_request_id)
    references public.approval_requests (organization_id, id)
    on delete restrict,
  constraint payment_link_executions_payment_same_organization_fkey
    foreign key (organization_id, payment_id)
    references public.payments (organization_id, id)
    on delete cascade,
  constraint payment_link_executions_issuance_same_organization_fkey
    foreign key (organization_id, invoice_issuance_id)
    references public.invoice_issuances (organization_id, id)
    on delete restrict
);

create index payment_link_executions_org_created_idx
  on public.payment_link_executions (organization_id, created_at desc);
create index payment_link_executions_payment_idx
  on public.payment_link_executions (organization_id, payment_id);
create index payment_link_executions_active_expiry_idx
  on public.payment_link_executions (checkout_expires_at)
  where status = 'active';
create unique index payment_link_executions_one_active_per_draft_idx
  on public.payment_link_executions (organization_id, payment_link_draft_id)
  where status = 'active';

alter table public.payment_link_executions enable row level security;

create policy payment_link_executions_finance_select
  on public.payment_link_executions
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  );

revoke all on table public.payment_link_executions
  from public, anon, authenticated;
grant select on table public.payment_link_executions to authenticated;
grant select, insert, update, delete on table public.payment_link_executions
  to service_role;

create or replace function private.protect_payment_link_execution_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(
    old.organization_id,
    old.payment_link_draft_id,
    old.approval_request_id,
    old.payment_id,
    old.invoice_issuance_id,
    old.provider_key,
    old.provider_environment,
    old.adapter_version,
    old.currency,
    old.requested_amount,
    old.source_evidence_sha256,
    old.idempotency_key,
    old.provider_reference,
    old.checkout_target,
    old.checkout_token_sha256,
    old.checkout_expires_at,
    old.executed_by,
    old.created_at
  ) is distinct from row(
    new.organization_id,
    new.payment_link_draft_id,
    new.approval_request_id,
    new.payment_id,
    new.invoice_issuance_id,
    new.provider_key,
    new.provider_environment,
    new.adapter_version,
    new.currency,
    new.requested_amount,
    new.source_evidence_sha256,
    new.idempotency_key,
    new.provider_reference,
    new.checkout_target,
    new.checkout_token_sha256,
    new.checkout_expires_at,
    new.executed_by,
    new.created_at
  )
    or old.status <> 'active'
    or new.status <> 'invalidated'
    or old.invalidated_at is not null
    or new.invalidated_at is null
  then
    raise exception 'Payment-link execution evidence is immutable.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_payment_link_execution_evidence()
  from public, anon, authenticated;

create trigger payment_link_executions_protect_evidence
  before update on public.payment_link_executions
  for each row execute function private.protect_payment_link_execution_evidence();

create or replace function public.record_payment_link_execution(
  target_organization_id uuid,
  target_payment_link_draft_id uuid,
  target_approval_request_id uuid,
  target_provider_key text,
  target_provider_environment text,
  target_adapter_version text,
  target_idempotency_key text,
  target_provider_reference text,
  target_checkout_target text,
  target_checkout_token_sha256 text,
  target_checkout_expires_at timestamptz,
  target_executed_by uuid
)
returns table (
  payment_link_execution_id uuid,
  provider_key text,
  provider_environment text,
  adapter_version text,
  execution_status text,
  provider_reference text,
  checkout_target text,
  checkout_expires_at timestamptz,
  idempotency_key text,
  created_at timestamptz,
  already_executed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  draft_record public.payment_link_drafts%rowtype;
  approval_record public.approval_requests%rowtype;
  payment_record public.payments%rowtype;
  issuance_record public.invoice_issuances%rowtype;
  existing_execution public.payment_link_executions%rowtype;
  created_execution public.payment_link_executions%rowtype;
  normalized_provider text := lower(btrim(target_provider_key));
  normalized_environment text := lower(btrim(target_provider_environment));
  normalized_adapter text := lower(btrim(target_adapter_version));
  normalized_idempotency text := lower(btrim(target_idempotency_key));
  normalized_reference text := btrim(target_provider_reference);
  normalized_target text := btrim(target_checkout_target);
  normalized_token_hash text := lower(btrim(target_checkout_token_sha256));
  raw_checkout_token text;
  expected_idempotency text;
  current_evidence_hash text;
  replaced_execution_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the trusted payment adapter may record execution.'
      using errcode = '42501';
  end if;
  if normalized_provider <> 'sandbox'
    or normalized_environment <> 'sandbox'
    or normalized_adapter <> 'sandbox-v1'
    or normalized_idempotency !~ '^[0-9a-f]{64}$'
    or normalized_reference !~ '^sbx_[0-9a-f]{32}$'
    or normalized_target !~ '^/sandbox/pay/[A-Za-z0-9_-]{43}$'
    or normalized_token_hash !~ '^[0-9a-f]{64}$'
    or target_checkout_expires_at is null
    or target_checkout_expires_at < statement_timestamp() + interval '15 minutes'
    or target_checkout_expires_at > statement_timestamp() + interval '7 days'
  then
    raise exception 'The sandbox payment adapter evidence is invalid.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_executed_by
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'finance')
  ) then
    raise exception 'The payment adapter actor lacks current finance authority.'
      using errcode = '42501';
  end if;

  raw_checkout_token := substring(
    normalized_target
    from '^/sandbox/pay/([A-Za-z0-9_-]{43})$'
  );
  if encode(
    extensions.digest(convert_to(raw_checkout_token, 'UTF8'), 'sha256'),
    'hex'
  ) <> normalized_token_hash then
    raise exception 'The sandbox checkout token does not match its hash.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' ||
      target_payment_link_draft_id::text || ':' ||
      normalized_provider || ':' || normalized_environment,
      0
    )
  );

  select draft.* into draft_record
  from public.payment_link_drafts draft
  where draft.organization_id = target_organization_id
    and draft.id = target_payment_link_draft_id
  for update;
  if not found or draft_record.status <> 'ready' then
    raise exception 'A current payment-request draft is required.'
      using errcode = '23514';
  end if;

  select approval.* into approval_record
  from public.approval_requests approval
  where approval.organization_id = target_organization_id
    and approval.id = target_approval_request_id
  for update;
  if not found
    or approval_record.action <> 'payment.link.create'
    or approval_record.entity_type <> 'payment_link_draft'
    or approval_record.entity_id <> draft_record.id
    or approval_record.status <> 'approved'
    or approval_record.resolved_at is null
    or approval_record.expires_at is null
    or approval_record.expires_at <= statement_timestamp()
    or approval_record.payload->>'payment_link_draft_id' <> draft_record.id::text
    or approval_record.payload->>'payment_id' <> draft_record.payment_id::text
    or approval_record.payload->>'invoice_issuance_id' <>
      draft_record.invoice_issuance_id::text
    or approval_record.payload->>'evidence_sha256' <> draft_record.evidence_sha256
    or approval_record.payload->>'source_issuance_sha256' <>
      draft_record.source_issuance_sha256
    or approval_record.payload->>'provider_link_created' <> 'false'
    or approval_record.payload->>'payment_collected' <> 'false'
    or approval_record.payload->>'external_action_performed' <> 'false'
  then
    raise exception 'An approved, unexpired exact payment request is required.'
      using errcode = '42501';
  end if;

  select payment.* into payment_record
  from public.payments payment
  where payment.organization_id = target_organization_id
    and payment.id = draft_record.payment_id
  for update;
  select issuance.* into issuance_record
  from public.invoice_issuances issuance
  where issuance.organization_id = target_organization_id
    and issuance.id = draft_record.invoice_issuance_id;

  if payment_record.id is null
    or issuance_record.id is null
    or payment_record.direction <> 'receivable'
    or payment_record.status not in ('pending', 'partially_paid', 'overdue')
    or payment_record.amount <= payment_record.paid_amount
    or payment_record.invoice_issuance_id <> issuance_record.id
    or payment_record.currency <> draft_record.currency
    or payment_record.amount <> draft_record.payment_amount
    or payment_record.paid_amount <> draft_record.paid_amount
    or payment_record.amount - payment_record.paid_amount <>
      draft_record.requested_amount
    or payment_record.due_at is distinct from draft_record.due_at
    or payment_record.status <> draft_record.payment_status
    or payment_record.updated_at <> draft_record.payment_updated_at
    or issuance_record.invoice_number <> draft_record.invoice_number
    or issuance_record.issuance_sha256 <> draft_record.source_issuance_sha256
  then
    raise exception 'The approved payment request is stale.'
      using errcode = '23514';
  end if;

  current_evidence_hash := private.payment_link_evidence_sha256(
    payment_record,
    issuance_record
  );
  if current_evidence_hash <> draft_record.evidence_sha256 then
    raise exception 'The approved payment request is stale.'
      using errcode = '23514';
  end if;

  expected_idempotency := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\n',
          'payment-link-execution-v1',
          target_organization_id::text,
          draft_record.id::text,
          approval_record.id::text,
          normalized_provider,
          normalized_environment,
          draft_record.evidence_sha256
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if normalized_idempotency <> expected_idempotency
    or normalized_reference <>
      ('sbx_' || substring(expected_idempotency, 1, 32))
  then
    raise exception 'The payment adapter idempotency evidence is invalid.'
      using errcode = '22023';
  end if;

  select execution.* into existing_execution
  from public.payment_link_executions execution
  where execution.organization_id = target_organization_id
    and execution.approval_request_id = approval_record.id
    and execution.provider_key = normalized_provider
    and execution.provider_environment = normalized_environment;
  if found then
    if existing_execution.status <> 'active'
      or existing_execution.approval_request_id <> approval_record.id
      or existing_execution.adapter_version <> normalized_adapter
      or existing_execution.source_evidence_sha256 <> draft_record.evidence_sha256
      or existing_execution.idempotency_key <> expected_idempotency
      or existing_execution.provider_reference <> normalized_reference
    then
      raise exception 'This payment request already has different execution evidence.'
        using errcode = '23505';
    end if;
    return query select
      existing_execution.id,
      existing_execution.provider_key,
      existing_execution.provider_environment,
      existing_execution.adapter_version,
      existing_execution.status,
      existing_execution.provider_reference,
      existing_execution.checkout_target,
      existing_execution.checkout_expires_at,
      existing_execution.idempotency_key,
      existing_execution.created_at,
      true;
    return;
  end if;

  with invalidated as (
    update public.payment_link_executions execution
    set
      status = 'invalidated',
      invalidated_at = statement_timestamp()
    where execution.organization_id = target_organization_id
      and execution.payment_link_draft_id = draft_record.id
      and execution.status = 'active'
    returning execution.id
  )
  select count(*)::integer into replaced_execution_count
  from invalidated;

  insert into public.payment_link_executions (
    organization_id,
    payment_link_draft_id,
    approval_request_id,
    payment_id,
    invoice_issuance_id,
    provider_key,
    provider_environment,
    adapter_version,
    currency,
    requested_amount,
    source_evidence_sha256,
    idempotency_key,
    provider_reference,
    checkout_target,
    checkout_token_sha256,
    checkout_expires_at,
    executed_by
  ) values (
    target_organization_id,
    draft_record.id,
    approval_record.id,
    draft_record.payment_id,
    draft_record.invoice_issuance_id,
    normalized_provider,
    normalized_environment,
    normalized_adapter,
    draft_record.currency,
    draft_record.requested_amount,
    draft_record.evidence_sha256,
    expected_idempotency,
    normalized_reference,
    normalized_target,
    normalized_token_hash,
    target_checkout_expires_at,
    target_executed_by
  ) returning * into created_execution;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_organization_id,
    target_executed_by,
    'integration.executed',
    'payment_link_execution',
    created_execution.id,
    jsonb_build_object(
      'event', 'finance.sandbox_payment_link_created',
      'payment_link_draft_id', draft_record.id,
      'approval_request_id', approval_record.id,
      'provider_key', normalized_provider,
      'provider_environment', normalized_environment,
      'adapter_version', normalized_adapter,
      'currency', draft_record.currency,
      'requested_amount', draft_record.requested_amount,
      'source_evidence_sha256', draft_record.evidence_sha256,
      'idempotency_key', expected_idempotency,
      'replaced_execution_count', replaced_execution_count,
      'provider_link_created', true,
      'real_money_capable', false,
      'external_network_call_performed', false,
      'message_sent', false,
      'payment_collected', false,
      'settlement_recorded', false,
      'external_action_performed', false
    )
  );

  return query select
    created_execution.id,
    created_execution.provider_key,
    created_execution.provider_environment,
    created_execution.adapter_version,
    created_execution.status,
    created_execution.provider_reference,
    created_execution.checkout_target,
    created_execution.checkout_expires_at,
    created_execution.idempotency_key,
    created_execution.created_at,
    false;
end;
$$;

revoke all on function public.record_payment_link_execution(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  uuid
) from public, anon, authenticated;
grant execute on function public.record_payment_link_execution(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  uuid
) to service_role;

create or replace function public.get_sandbox_payment_checkout(
  target_checkout_token_sha256 text
)
returns table (
  provider_reference text,
  invoice_number text,
  currency char(3),
  requested_amount numeric(14, 2),
  checkout_expires_at timestamptz,
  sandbox_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_hash text := lower(btrim(target_checkout_token_sha256));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the trusted sandbox checkout may read this snapshot.'
      using errcode = '42501';
  end if;
  if normalized_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  return query
  select
    execution.provider_reference,
    draft.invoice_number,
    execution.currency,
    execution.requested_amount,
    execution.checkout_expires_at,
    'simulation_only'::text
  from public.payment_link_executions execution
  join public.payment_link_drafts draft
    on draft.organization_id = execution.organization_id
   and draft.id = execution.payment_link_draft_id
  where execution.provider_key = 'sandbox'
    and execution.provider_environment = 'sandbox'
    and execution.checkout_token_sha256 = normalized_hash
    and execution.status = 'active'
    and execution.checkout_expires_at > statement_timestamp()
    and draft.status = 'ready';
end;
$$;

revoke all on function public.get_sandbox_payment_checkout(text)
  from public, anon, authenticated;
grant execute on function public.get_sandbox_payment_checkout(text)
  to service_role;

create or replace function private.invalidate_payment_link_executions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  with invalidated as (
    update public.payment_link_executions execution
    set
      status = 'invalidated',
      invalidated_at = statement_timestamp()
    where execution.organization_id = new.organization_id
      and execution.payment_link_draft_id = new.id
      and execution.status = 'active'
    returning execution.id, execution.organization_id
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
    invalidated.organization_id,
    (select auth.uid()),
    'integration.invalidated',
    'payment_link_execution',
    invalidated.id,
    jsonb_build_object(
      'event', 'finance.sandbox_payment_link_invalidated',
      'payment_link_draft_id', new.id,
      'provider_environment', 'sandbox',
      'real_money_capable', false,
      'payment_collected', false,
      'external_action_performed', false
    )
  from invalidated;
  return new;
end;
$$;

revoke all on function private.invalidate_payment_link_executions()
  from public, anon, authenticated;

create trigger payment_link_drafts_invalidate_executions
  after update of status on public.payment_link_drafts
  for each row
  when (old.status = 'ready' and new.status = 'superseded')
  execute function private.invalidate_payment_link_executions();
