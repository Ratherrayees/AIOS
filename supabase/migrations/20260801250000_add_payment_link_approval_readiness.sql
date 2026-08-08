-- Prepare an exact receivable collection request without creating a provider
-- link, contacting a customer, or moving money. A current human approval is
-- recorded separately so a future provider adapter can fail closed against
-- this immutable evidence.

create table public.payment_link_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  payment_id uuid not null,
  invoice_issuance_id uuid not null,
  revision integer not null check (revision > 0),
  status text not null default 'ready'
    check (status in ('ready', 'superseded')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  payment_amount numeric(14, 2) not null check (payment_amount > 0),
  paid_amount numeric(14, 2) not null check (paid_amount >= 0),
  requested_amount numeric(14, 2) not null check (requested_amount > 0),
  due_at date,
  payment_status public.payment_status not null,
  payment_updated_at timestamptz not null,
  invoice_number text not null
    check (
      invoice_number = upper(btrim(invoice_number))
      and char_length(invoice_number) between 4 and 40
    ),
  source_issuance_sha256 text not null
    check (source_issuance_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_sha256 text not null
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  prepared_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  superseded_at timestamptz,
  constraint payment_link_drafts_organization_id_id_key
    unique (organization_id, id),
  constraint payment_link_drafts_payment_revision_key
    unique (organization_id, payment_id, revision),
  constraint payment_link_drafts_evidence_key
    unique (organization_id, payment_id, evidence_sha256),
  constraint payment_link_drafts_amounts_reconcile
    check (
      paid_amount < payment_amount
      and requested_amount = payment_amount - paid_amount
    ),
  constraint payment_link_drafts_lifecycle_evidence
    check (
      (status = 'ready' and superseded_at is null)
      or (status = 'superseded' and superseded_at is not null)
    ),
  constraint payment_link_drafts_payment_same_organization_fkey
    foreign key (organization_id, payment_id)
    references public.payments (organization_id, id)
    on delete cascade,
  constraint payment_link_drafts_issuance_same_organization_fkey
    foreign key (organization_id, invoice_issuance_id)
    references public.invoice_issuances (organization_id, id)
    on delete restrict
);

create unique index payment_link_drafts_one_ready_per_payment_idx
  on public.payment_link_drafts (organization_id, payment_id)
  where status = 'ready';
create index payment_link_drafts_org_created_idx
  on public.payment_link_drafts (organization_id, created_at desc);
create index payment_link_drafts_issuance_idx
  on public.payment_link_drafts (organization_id, invoice_issuance_id);
create index payment_link_drafts_prepared_by_idx
  on public.payment_link_drafts (prepared_by);

alter table public.payment_link_drafts enable row level security;

create policy payment_link_drafts_finance_select
  on public.payment_link_drafts
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  );

revoke all on table public.payment_link_drafts
  from public, anon, authenticated;
grant select on table public.payment_link_drafts to authenticated;
grant select, insert, update, delete on table public.payment_link_drafts
  to service_role;

create or replace function private.payment_link_evidence_sha256(
  payment_value public.payments,
  issuance_value public.invoice_issuances
)
returns text
language sql
stable
set search_path = pg_catalog, public, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'payment_id', payment_value.id,
          'direction', payment_value.direction,
          'status', payment_value.status,
          'amount', payment_value.amount,
          'paid_amount', payment_value.paid_amount,
          'requested_amount', payment_value.amount - payment_value.paid_amount,
          'currency', payment_value.currency,
          'due_at', payment_value.due_at,
          'payment_updated_at', payment_value.updated_at,
          'invoice_issuance_id', issuance_value.id,
          'invoice_number', issuance_value.invoice_number,
          'issuance_sha256', issuance_value.issuance_sha256
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.payment_link_evidence_sha256(
  public.payments,
  public.invoice_issuances
) from public, anon, authenticated;

create or replace function private.protect_payment_link_draft_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(
    old.organization_id,
    old.payment_id,
    old.invoice_issuance_id,
    old.revision,
    old.currency,
    old.payment_amount,
    old.paid_amount,
    old.requested_amount,
    old.due_at,
    old.payment_status,
    old.payment_updated_at,
    old.invoice_number,
    old.source_issuance_sha256,
    old.evidence_sha256,
    old.prepared_by,
    old.created_at
  ) is distinct from row(
    new.organization_id,
    new.payment_id,
    new.invoice_issuance_id,
    new.revision,
    new.currency,
    new.payment_amount,
    new.paid_amount,
    new.requested_amount,
    new.due_at,
    new.payment_status,
    new.payment_updated_at,
    new.invoice_number,
    new.source_issuance_sha256,
    new.evidence_sha256,
    new.prepared_by,
    new.created_at
  )
    or old.status <> 'ready'
    or new.status <> 'superseded'
    or old.superseded_at is not null
    or new.superseded_at is null
  then
    raise exception 'Payment-link draft evidence is immutable.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_payment_link_draft_evidence()
  from public, anon, authenticated;

create trigger payment_link_drafts_protect_evidence
  before update on public.payment_link_drafts
  for each row execute function private.protect_payment_link_draft_evidence();

create or replace function public.prepare_payment_link_draft(
  target_organization_id uuid,
  target_payment_id uuid
)
returns table (
  payment_link_draft_id uuid,
  revision integer,
  currency char(3),
  requested_amount numeric(14, 2),
  evidence_sha256 text,
  already_prepared boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select auth.uid());
  payment_record public.payments%rowtype;
  issuance_record public.invoice_issuances%rowtype;
  existing_draft public.payment_link_drafts%rowtype;
  created_draft public.payment_link_drafts%rowtype;
  computed_hash text;
  next_revision integer;
  stale_draft_ids uuid[];
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to prepare payment requests.'
      using errcode = '42501';
  end if;

  select payment.* into payment_record
  from public.payments payment
  where payment.organization_id = target_organization_id
    and payment.id = target_payment_id
  for update;

  if not found then
    raise exception 'That receivable is not available.' using errcode = 'P0002';
  end if;
  if payment_record.direction <> 'receivable'
    or payment_record.status not in ('pending', 'partially_paid', 'overdue')
    or payment_record.amount <= payment_record.paid_amount
  then
    raise exception 'Only an open receivable can become a payment request.'
      using errcode = '23514';
  end if;
  if payment_record.invoice_issuance_id is null then
    raise exception 'Issue the exact invoice before preparing a payment request.'
      using errcode = '23514';
  end if;

  select issuance.* into issuance_record
  from public.invoice_issuances issuance
  where issuance.organization_id = target_organization_id
    and issuance.id = payment_record.invoice_issuance_id;

  if not found
    or issuance_record.currency <> payment_record.currency
  then
    raise exception 'The receivable does not match current invoice issuance evidence.'
      using errcode = '23514';
  end if;

  computed_hash := private.payment_link_evidence_sha256(
    payment_record,
    issuance_record
  );

  select draft.* into existing_draft
  from public.payment_link_drafts draft
  where draft.organization_id = target_organization_id
    and draft.payment_id = payment_record.id
    and draft.status = 'ready'
    and draft.evidence_sha256 = computed_hash;

  if found then
    return query select
      existing_draft.id,
      existing_draft.revision,
      existing_draft.currency,
      existing_draft.requested_amount,
      existing_draft.evidence_sha256,
      true;
    return;
  end if;

  select coalesce(max(draft.revision), 0) + 1
  into next_revision
  from public.payment_link_drafts draft
  where draft.organization_id = target_organization_id
    and draft.payment_id = payment_record.id;

  select coalesce(array_agg(draft.id), array[]::uuid[])
  into stale_draft_ids
  from public.payment_link_drafts draft
  where draft.organization_id = target_organization_id
    and draft.payment_id = payment_record.id
    and draft.status = 'ready';

  update public.payment_link_drafts draft
  set status = 'superseded', superseded_at = statement_timestamp()
  where draft.id = any(stale_draft_ids);

  update public.approval_requests approval
  set status = 'expired', resolved_at = coalesce(approval.resolved_at, statement_timestamp())
  where approval.organization_id = target_organization_id
    and approval.action = 'payment.link.create'
    and approval.entity_type = 'payment_link_draft'
    and approval.entity_id = any(stale_draft_ids)
    and approval.status in ('pending', 'approved');

  insert into public.payment_link_drafts (
    organization_id,
    payment_id,
    invoice_issuance_id,
    revision,
    currency,
    payment_amount,
    paid_amount,
    requested_amount,
    due_at,
    payment_status,
    payment_updated_at,
    invoice_number,
    source_issuance_sha256,
    evidence_sha256,
    prepared_by
  ) values (
    target_organization_id,
    payment_record.id,
    issuance_record.id,
    next_revision,
    payment_record.currency,
    payment_record.amount,
    payment_record.paid_amount,
    payment_record.amount - payment_record.paid_amount,
    payment_record.due_at,
    payment_record.status,
    payment_record.updated_at,
    issuance_record.invoice_number,
    issuance_record.issuance_sha256,
    computed_hash,
    actor_id
  ) returning * into created_draft;

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
    'record.created',
    'payment_link_draft',
    created_draft.id,
    jsonb_build_object(
      'event', 'finance.payment_link_draft_prepared',
      'payment_id', payment_record.id,
      'revision', created_draft.revision,
      'currency', created_draft.currency,
      'requested_amount', created_draft.requested_amount,
      'evidence_sha256', created_draft.evidence_sha256,
      'provider_link_created', false,
      'message_sent', false,
      'payment_collected', false,
      'external_action_performed', false
    )
  );

  return query select
    created_draft.id,
    created_draft.revision,
    created_draft.currency,
    created_draft.requested_amount,
    created_draft.evidence_sha256,
    false;
end;
$$;

revoke all on function public.prepare_payment_link_draft(uuid, uuid)
  from public, anon;
grant execute on function public.prepare_payment_link_draft(uuid, uuid)
  to authenticated;

create or replace function private.enforce_payment_link_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select auth.uid());
  draft_record public.payment_link_drafts%rowtype;
  payment_record public.payments%rowtype;
  issuance_record public.invoice_issuances%rowtype;
  current_hash text;
begin
  if new.action <> 'payment.link.create' then
    return new;
  end if;
  if actor_id is null
    or actor_id <> new.requester_id
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      new.organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to request payment-link approval.'
      using errcode = '42501';
  end if;
  if new.entity_type <> 'payment_link_draft'
    or new.entity_id is null
    or char_length(btrim(coalesce(new.rationale, ''))) not between 12 and 1000
  then
    raise exception 'Exact payment request and review rationale are required.'
      using errcode = '22023';
  end if;
  if new.expires_at is null then
    new.expires_at := statement_timestamp() + interval '7 days';
  elsif new.expires_at < statement_timestamp() + interval '15 minutes'
    or new.expires_at > statement_timestamp() + interval '30 days'
  then
    raise exception 'Payment-link approval expiry is invalid.'
      using errcode = '22023';
  end if;

  select draft.* into draft_record
  from public.payment_link_drafts draft
  where draft.organization_id = new.organization_id
    and draft.id = new.entity_id
  for update;
  if not found or draft_record.status <> 'ready' then
    raise exception 'A current ready payment request is required.'
      using errcode = '23514';
  end if;

  select payment.* into payment_record
  from public.payments payment
  where payment.organization_id = new.organization_id
    and payment.id = draft_record.payment_id
  for update;
  select issuance.* into issuance_record
  from public.invoice_issuances issuance
  where issuance.organization_id = new.organization_id
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
    or payment_record.amount - payment_record.paid_amount <> draft_record.requested_amount
    or payment_record.due_at is distinct from draft_record.due_at
    or payment_record.status <> draft_record.payment_status
    or payment_record.updated_at <> draft_record.payment_updated_at
    or issuance_record.invoice_number <> draft_record.invoice_number
    or issuance_record.issuance_sha256 <> draft_record.source_issuance_sha256
  then
    raise exception 'The payment request evidence is stale.'
      using errcode = '23514';
  end if;

  current_hash := private.payment_link_evidence_sha256(
    payment_record,
    issuance_record
  );
  if current_hash <> draft_record.evidence_sha256 then
    raise exception 'The payment request evidence is stale.'
      using errcode = '23514';
  end if;

  new.rationale := btrim(new.rationale);
  new.payload := jsonb_build_object(
    'payment_link_draft_id', draft_record.id,
    'payment_id', draft_record.payment_id,
    'invoice_issuance_id', draft_record.invoice_issuance_id,
    'invoice_number', draft_record.invoice_number,
    'revision', draft_record.revision,
    'currency', draft_record.currency,
    'requested_amount', draft_record.requested_amount,
    'due_at', draft_record.due_at,
    'evidence_sha256', draft_record.evidence_sha256,
    'source_issuance_sha256', draft_record.source_issuance_sha256,
    'provider_link_created', false,
    'message_sent', false,
    'payment_collected', false,
    'external_action_performed', false
  );

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    new.organization_id,
    actor_id,
    'approval.requested',
    'approval_request',
    new.id,
    jsonb_build_object(
      'event', 'finance.payment_link_approval_requested',
      'action', 'payment.link.create',
      'payment_link_draft_id', draft_record.id,
      'payment_id', draft_record.payment_id,
      'revision', draft_record.revision,
      'currency', draft_record.currency,
      'requested_amount', draft_record.requested_amount,
      'evidence_sha256', draft_record.evidence_sha256,
      'provider_link_created', false,
      'message_sent', false,
      'payment_collected', false,
      'external_action_performed', false
    )
  );
  return new;
end;
$$;

revoke all on function private.enforce_payment_link_approval()
  from public, anon, authenticated;

create trigger approval_requests_enforce_payment_link
  before insert on public.approval_requests
  for each row execute function private.enforce_payment_link_approval();

create or replace function public.request_payment_link_approval(
  target_organization_id uuid,
  target_payment_link_draft_id uuid,
  target_rationale text
)
returns table (
  approval_request_id uuid,
  approval_status public.approval_status,
  expires_at timestamptz,
  already_requested boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  existing_approval public.approval_requests%rowtype;
  created_approval public.approval_requests%rowtype;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to request payment-link approval.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('payment-link-approval:' || target_payment_link_draft_id::text)
  );

  update public.approval_requests approval
  set status = 'expired', resolved_at = statement_timestamp()
  where approval.organization_id = target_organization_id
    and approval.action = 'payment.link.create'
    and approval.entity_type = 'payment_link_draft'
    and approval.entity_id = target_payment_link_draft_id
    and approval.status in ('pending', 'approved')
    and approval.expires_at <= statement_timestamp();

  select approval.* into existing_approval
  from public.approval_requests approval
  where approval.organization_id = target_organization_id
    and approval.action = 'payment.link.create'
    and approval.entity_type = 'payment_link_draft'
    and approval.entity_id = target_payment_link_draft_id
    and approval.status = 'pending'
  order by approval.created_at desc
  limit 1;

  if found then
    return query select
      existing_approval.id,
      existing_approval.status,
      existing_approval.expires_at,
      true;
    return;
  end if;

  insert into public.approval_requests (
    organization_id,
    requester_id,
    action,
    entity_type,
    entity_id,
    rationale,
    expires_at
  ) values (
    target_organization_id,
    actor_id,
    'payment.link.create',
    'payment_link_draft',
    target_payment_link_draft_id,
    target_rationale,
    statement_timestamp() + interval '7 days'
  ) returning * into created_approval;

  return query select
    created_approval.id,
    created_approval.status,
    created_approval.expires_at,
    false;
end;
$$;

revoke all on function public.request_payment_link_approval(uuid, uuid, text)
  from public, anon;
grant execute on function public.request_payment_link_approval(uuid, uuid, text)
  to authenticated;

create or replace function private.invalidate_payment_link_drafts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  stale_draft_ids uuid[];
begin
  select coalesce(array_agg(draft.id), array[]::uuid[])
  into stale_draft_ids
  from public.payment_link_drafts draft
  where draft.organization_id = new.organization_id
    and draft.payment_id = new.id
    and draft.status = 'ready';

  if cardinality(stale_draft_ids) = 0 then
    return new;
  end if;

  update public.payment_link_drafts draft
  set status = 'superseded', superseded_at = statement_timestamp()
  where draft.id = any(stale_draft_ids);

  update public.approval_requests approval
  set status = 'expired', resolved_at = coalesce(approval.resolved_at, statement_timestamp())
  where approval.organization_id = new.organization_id
    and approval.action = 'payment.link.create'
    and approval.entity_type = 'payment_link_draft'
    and approval.entity_id = any(stale_draft_ids)
    and approval.status in ('pending', 'approved');

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    new.organization_id,
    (select auth.uid()),
    'approval.expired',
    'payment_obligation',
    new.id,
    jsonb_build_object(
      'event', 'finance.payment_link_evidence_invalidated',
      'draft_count', cardinality(stale_draft_ids),
      'provider_link_created', false,
      'message_sent', false,
      'payment_collected', false,
      'external_action_performed', false
    )
  );
  return new;
end;
$$;

revoke all on function private.invalidate_payment_link_drafts()
  from public, anon, authenticated;

-- This trigger sorts after payments_set_updated_at, so the next prepared draft
-- observes the final updated_at evidence written by that trigger.
create trigger zz_payments_invalidate_payment_link_drafts
  after update of amount, paid_amount, currency, due_at, status, invoice_issuance_id
  on public.payments
  for each row
  when (
    old.amount is distinct from new.amount
    or old.paid_amount is distinct from new.paid_amount
    or old.currency is distinct from new.currency
    or old.due_at is distinct from new.due_at
    or old.status is distinct from new.status
    or old.invoice_issuance_id is distinct from new.invoice_issuance_id
  )
  execute function private.invalidate_payment_link_drafts();

create or replace function private.enforce_finance_approval_resolver_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status = 'pending'
    and new.status in ('approved', 'rejected')
    and new.action in ('invoice.issue', 'payment.link.create', 'payment.refund')
    and (
      (select auth.uid()) is null
      or not public.meets_mfa_requirement()
      or not public.has_organization_role(
        new.organization_id,
        array['owner', 'admin', 'finance']::public.app_role[]
      )
    )
  then
    raise exception 'Only an owner, admin, or finance member can resolve this finance approval.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_finance_approval_resolver_role()
  from public, anon, authenticated;

create trigger approval_requests_enforce_finance_resolver_role
  before update on public.approval_requests
  for each row execute function private.enforce_finance_approval_resolver_role();

update public.ai_autonomy_policies
set mode = 'approval_required'
where action in ('invoice.issue', 'payment.link.create')
  and mode <> 'approval_required';

alter table public.ai_autonomy_policies
  drop constraint ai_autonomy_external_effect_requires_approval,
  add constraint ai_autonomy_external_effect_requires_approval
  check (
    action not in (
      'external_message.send',
      'supplier.follow_up.send',
      'quote.share',
      'pricing.override',
      'booking.confirm',
      'invoice.issue',
      'payment.link.create',
      'payment.refund',
      'document.share'
    )
    or mode = 'approval_required'
  );
