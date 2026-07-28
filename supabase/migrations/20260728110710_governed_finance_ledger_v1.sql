-- Phase 15 v1: governed supplier records and an internal payment-obligation
-- ledger. This schema records financial facts; it never initiates a charge,
-- payout, refund, invoice email, or supplier communication.

alter table public.suppliers
  add column contact_name text
    check (contact_name is null or char_length(contact_name) <= 180),
  add column website text
    check (website is null or char_length(website) <= 500),
  add column preferred_currency char(3) not null default 'INR'
    check (preferred_currency ~ '^[A-Z]{3}$'),
  add column payment_terms_days integer
    check (payment_terms_days is null or payment_terms_days between 0 and 365),
  add column cancellation_terms text
    check (cancellation_terms is null or char_length(cancellation_terms) <= 5_000),
  add column internal_notes text
    check (internal_notes is null or char_length(internal_notes) <= 5_000),
  add column quality_rating numeric(2, 1)
    check (quality_rating is null or quality_rating between 1 and 5);

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  name text not null check (char_length(name) between 1 and 180),
  role_title text
    check (role_title is null or char_length(role_title) <= 180),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 40),
  is_primary boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 2_000),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint supplier_contacts_organization_id_id_key
    unique (organization_id, id),
  constraint supplier_contacts_supplier_same_organization_fkey
    foreign key (organization_id, supplier_id)
    references public.suppliers (organization_id, id)
    on delete cascade,
  constraint supplier_contacts_contact_method_check
    check (email is not null or phone is not null)
);

create unique index supplier_contacts_one_primary_idx
  on public.supplier_contacts (organization_id, supplier_id)
  where is_primary;
create index supplier_contacts_supplier_idx
  on public.supplier_contacts (organization_id, supplier_id, name);

create table public.supplier_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  title text not null check (char_length(title) between 1 and 180),
  contract_reference text
    check (
      contract_reference is null
      or char_length(contract_reference) <= 180
    ),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'expired', 'terminated')),
  starts_on date,
  ends_on date,
  currency char(3) not null default 'INR'
    check (currency ~ '^[A-Z]{3}$'),
  payment_terms_days integer
    check (payment_terms_days is null or payment_terms_days between 0 and 365),
  cancellation_terms text
    check (cancellation_terms is null or char_length(cancellation_terms) <= 5_000),
  internal_notes text
    check (internal_notes is null or char_length(internal_notes) <= 5_000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint supplier_contracts_organization_id_id_key
    unique (organization_id, id),
  constraint supplier_contracts_supplier_same_organization_fkey
    foreign key (organization_id, supplier_id)
    references public.suppliers (organization_id, id)
    on delete cascade,
  constraint supplier_contracts_date_order_check
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index supplier_contracts_supplier_status_idx
  on public.supplier_contracts (
    organization_id,
    supplier_id,
    status,
    ends_on
  );
create index supplier_contracts_expiry_idx
  on public.supplier_contracts (organization_id, ends_on)
  where status = 'active' and ends_on is not null;
create index supplier_contracts_created_by_idx
  on public.supplier_contracts (created_by)
  where created_by is not null;

alter table public.payments
  add column supplier_id uuid,
  add column title text,
  add column invoice_number text,
  add column description text,
  add column paid_amount numeric(14, 2) not null default 0,
  add column created_by uuid,
  add column voided_by uuid,
  add column voided_at timestamptz,
  add column status_note text;

update public.payments
set
  title = case
    when direction = 'receivable' then 'Customer payment'
    else 'Supplier payment'
  end,
  paid_amount = case
    when status = 'paid' then amount
    else 0
  end
where title is null;

alter table public.payments
  alter column title set not null,
  add constraint payments_organization_id_id_key
    unique (organization_id, id),
  add constraint payments_title_length_check
    check (char_length(title) between 1 and 180),
  add constraint payments_invoice_number_length_check
    check (invoice_number is null or char_length(invoice_number) <= 180),
  add constraint payments_description_length_check
    check (description is null or char_length(description) <= 4_000),
  add constraint payments_paid_amount_check
    check (paid_amount >= 0 and paid_amount <= amount),
  add constraint payments_status_note_length_check
    check (status_note is null or char_length(status_note) <= 500),
  add constraint payments_supplier_same_organization_fkey
    foreign key (organization_id, supplier_id)
    references public.suppliers (organization_id, id)
    on delete set null (supplier_id),
  add constraint payments_creator_same_organization_fkey
    foreign key (organization_id, created_by)
    references public.memberships (organization_id, user_id)
    on delete set null (created_by),
  add constraint payments_voider_same_organization_fkey
    foreign key (organization_id, voided_by)
    references public.memberships (organization_id, user_id)
    on delete set null (voided_by),
  add constraint payments_void_evidence_check
    check (
      (status <> 'void')
      or (
        voided_at is not null
        and status_note is not null
      )
    );

create index payments_org_supplier_idx
  on public.payments (organization_id, supplier_id)
  where supplier_id is not null;
create index payments_org_status_created_idx
  on public.payments (organization_id, status, created_at desc);
create index payments_org_created_by_idx
  on public.payments (organization_id, created_by)
  where created_by is not null;
create index payments_org_voided_by_idx
  on public.payments (organization_id, voided_by)
  where voided_by is not null;
create unique index payments_org_invoice_number_idx
  on public.payments (organization_id, lower(invoice_number))
  where invoice_number is not null;

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  payment_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz not null,
  reference text
    check (reference is null or char_length(reference) <= 180),
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint payment_allocations_organization_id_id_key
    unique (organization_id, id),
  constraint payment_allocations_payment_same_organization_fkey
    foreign key (organization_id, payment_id)
    references public.payments (organization_id, id)
    on delete cascade,
  constraint payment_allocations_evidence_check
    check (reference is not null or note is not null)
);

create index payment_allocations_payment_created_idx
  on public.payment_allocations (
    organization_id,
    payment_id,
    occurred_at desc
  );
create unique index payment_allocations_reference_idx
  on public.payment_allocations (organization_id, lower(reference))
  where reference is not null;
create index payment_allocations_recorded_by_idx
  on public.payment_allocations (recorded_by)
  where recorded_by is not null;

create trigger supplier_contacts_set_updated_at
  before update on public.supplier_contacts
  for each row execute function public.set_updated_at();
create trigger supplier_contracts_set_updated_at
  before update on public.supplier_contracts
  for each row execute function public.set_updated_at();
create trigger supplier_contacts_prevent_organization_move
  before update on public.supplier_contacts
  for each row execute function private.prevent_organization_id_change();
create trigger supplier_contracts_prevent_organization_move
  before update on public.supplier_contracts
  for each row execute function private.prevent_organization_id_change();
create trigger payment_allocations_prevent_organization_move
  before update on public.payment_allocations
  for each row execute function private.prevent_organization_id_change();

alter table public.supplier_contacts enable row level security;
alter table public.supplier_contracts enable row level security;
alter table public.payment_allocations enable row level security;

create policy "members may read supplier contacts"
  on public.supplier_contacts
  for select to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );
create policy "supplier roles may create supplier contacts"
  on public.supplier_contacts
  for insert to authenticated
  with check (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  );
create policy "supplier roles may update supplier contacts"
  on public.supplier_contacts
  for update to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  )
  with check (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  );

create policy "members may read supplier contracts"
  on public.supplier_contracts
  for select to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );
create policy "supplier roles may create supplier contracts"
  on public.supplier_contracts
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  );
create policy "supplier roles may update supplier contracts"
  on public.supplier_contracts
  for update to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  )
  with check (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'finance'
      ]::public.app_role[]
    )
  );

create policy "members may read payment allocations"
  on public.payment_allocations
  for select to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

-- Payment obligations and their immutable settlement evidence can only be
-- written through the guarded functions below.
drop policy if exists "finance may add payments" on public.payments;
drop policy if exists "finance may update payments" on public.payments;
drop policy if exists "finance may remove payments" on public.payments;

revoke all on table public.supplier_contacts from public, anon;
revoke all on table public.supplier_contracts from public, anon;
revoke all on table public.payment_allocations from public, anon, authenticated;
revoke insert, update, delete on table public.payments from authenticated;

grant select, insert, update on table public.supplier_contacts to authenticated;
grant select, insert on table public.supplier_contracts to authenticated;
grant update (
    title,
    contract_reference,
    status,
    starts_on,
    ends_on,
    currency,
    payment_terms_days,
    cancellation_terms,
    internal_notes
  )
  on table public.supplier_contracts
  to authenticated;
grant select on table public.payment_allocations to authenticated;
grant select on table public.payments to authenticated;
grant select, insert, update, delete
  on table
    public.supplier_contacts,
    public.supplier_contracts,
    public.payment_allocations
  to service_role;
grant select, insert, update, delete
  on table public.payments
  to service_role;

create or replace function public.create_payment_obligation(
  target_organization_id uuid,
  target_direction text,
  target_title text,
  target_amount numeric,
  target_currency text,
  target_due_at date default null,
  target_deal_id uuid default null,
  target_trip_id uuid default null,
  target_supplier_id uuid default null,
  target_invoice_number text default null,
  target_description text default null
)
returns setof public.payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  created_payment_id uuid;
  normalized_title text := nullif(btrim(target_title), '');
  normalized_currency text := upper(btrim(target_currency));
  normalized_invoice_number text := nullif(btrim(target_invoice_number), '');
  normalized_description text := nullif(btrim(target_description), '');
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to create payment obligations.'
      using errcode = '42501';
  end if;
  if target_direction not in ('receivable', 'payable') then
    raise exception 'Payment direction must be receivable or payable.'
      using errcode = '22023';
  end if;
  if normalized_title is null or char_length(normalized_title) > 180 then
    raise exception 'Payment titles must contain 1 to 180 characters.'
      using errcode = '22023';
  end if;
  if target_amount is null
    or target_amount <= 0
    or target_amount > 999999999999.99
  then
    raise exception 'Payment amount must be greater than zero.'
      using errcode = '22023';
  end if;
  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Use a three-letter currency code.'
      using errcode = '22023';
  end if;
  if normalized_invoice_number is not null
    and char_length(normalized_invoice_number) > 180
  then
    raise exception 'Invoice numbers must be 180 characters or fewer.'
      using errcode = '22023';
  end if;
  if normalized_description is not null
    and char_length(normalized_description) > 4000
  then
    raise exception 'Payment descriptions must be 4,000 characters or fewer.'
      using errcode = '22023';
  end if;

  insert into public.payments (
    organization_id,
    deal_id,
    trip_id,
    supplier_id,
    direction,
    status,
    title,
    invoice_number,
    description,
    amount,
    paid_amount,
    currency,
    due_at,
    created_by
  )
  values (
    target_organization_id,
    target_deal_id,
    target_trip_id,
    target_supplier_id,
    target_direction,
    (
      case
        when target_due_at < current_date then 'overdue'
        else 'pending'
      end
    )::public.payment_status,
    normalized_title,
    normalized_invoice_number,
    normalized_description,
    target_amount,
    0,
    normalized_currency,
    target_due_at,
    actor_id
  )
  returning id into created_payment_id;

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
    'record.created',
    'payment_obligation',
    created_payment_id,
    jsonb_build_object(
      'event', 'finance.payment_obligation_created',
      'direction', target_direction,
      'amount', target_amount,
      'currency', normalized_currency,
      'trip_id', target_trip_id,
      'supplier_id', target_supplier_id
    )
  );

  return query
  select payment.*
  from public.payments payment
  where payment.id = created_payment_id;
end;
$$;

create or replace function public.record_payment_allocation(
  target_organization_id uuid,
  target_payment_id uuid,
  target_amount numeric,
  target_occurred_at timestamptz,
  target_reference text default null,
  target_note text default null
)
returns setof public.payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_payment public.payments%rowtype;
  allocation_id uuid;
  normalized_reference text := nullif(btrim(target_reference), '');
  normalized_note text := nullif(btrim(target_note), '');
  next_paid_amount numeric(14, 2);
  next_status public.payment_status;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to record settlements.'
      using errcode = '42501';
  end if;
  if target_amount is null or target_amount <= 0 then
    raise exception 'Settlement amount must be greater than zero.'
      using errcode = '22023';
  end if;
  if target_occurred_at is null
    or target_occurred_at > statement_timestamp() + interval '5 minutes'
  then
    raise exception 'Settlement time cannot be in the future.'
      using errcode = '22023';
  end if;
  if normalized_reference is null and normalized_note is null then
    raise exception 'Add a reference or note as settlement evidence.'
      using errcode = '23514';
  end if;
  if normalized_reference is not null
    and char_length(normalized_reference) > 180
  then
    raise exception 'Settlement references must be 180 characters or fewer.'
      using errcode = '22023';
  end if;
  if normalized_note is not null and char_length(normalized_note) > 500 then
    raise exception 'Settlement notes must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  select payment.*
  into current_payment
  from public.payments payment
  where payment.organization_id = target_organization_id
    and payment.id = target_payment_id
  for update;
  if not found then
    raise exception 'That payment obligation is not available.'
      using errcode = 'P0002';
  end if;
  if current_payment.status in ('paid', 'refunded', 'void') then
    raise exception 'That payment obligation cannot accept another settlement.'
      using errcode = '23514';
  end if;

  next_paid_amount := current_payment.paid_amount + target_amount;
  if next_paid_amount > current_payment.amount then
    raise exception 'Settlement exceeds the outstanding balance.'
      using errcode = '23514';
  end if;

  insert into public.payment_allocations (
    organization_id,
    payment_id,
    amount,
    currency,
    occurred_at,
    reference,
    note,
    recorded_by
  )
  values (
    target_organization_id,
    current_payment.id,
    target_amount,
    current_payment.currency,
    target_occurred_at,
    normalized_reference,
    normalized_note,
    actor_id
  )
  returning id into allocation_id;

  next_status := (
    case
      when next_paid_amount = current_payment.amount then 'paid'
      when current_payment.due_at < current_date then 'overdue'
      else 'partially_paid'
    end
  )::public.payment_status;

  update public.payments
  set
    paid_amount = next_paid_amount,
    status = next_status,
    paid_at = case
      when next_status = 'paid' then target_occurred_at
      else null
    end,
    status_note = case
      when next_status = 'paid' then 'Settled from recorded allocations.'
      else status_note
    end
  where id = current_payment.id;

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
    'payment_obligation',
    current_payment.id,
    jsonb_build_object(
      'event', 'finance.payment_settlement_recorded',
      'allocation_id', allocation_id,
      'amount', target_amount,
      'currency', current_payment.currency,
      'from_status', current_payment.status,
      'to_status', next_status,
      'reference', normalized_reference
    )
  );

  return query
  select payment.*
  from public.payments payment
  where payment.id = current_payment.id;
end;
$$;

create or replace function public.void_payment_obligation(
  target_organization_id uuid,
  target_payment_id uuid,
  target_reason text
)
returns setof public.payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_payment public.payments%rowtype;
  normalized_reason text := nullif(btrim(target_reason), '');
  changed_at timestamptz := statement_timestamp();
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to void payment obligations.'
      using errcode = '42501';
  end if;
  if normalized_reason is null or char_length(normalized_reason) > 500 then
    raise exception 'Add a void reason of 500 characters or fewer.'
      using errcode = '23514';
  end if;

  select payment.*
  into current_payment
  from public.payments payment
  where payment.organization_id = target_organization_id
    and payment.id = target_payment_id
  for update;
  if not found then
    raise exception 'That payment obligation is not available.'
      using errcode = 'P0002';
  end if;
  if current_payment.status in ('paid', 'refunded', 'void')
    or current_payment.paid_amount > 0
  then
    raise exception 'Only unsettled payment obligations can be voided.'
      using errcode = '23514';
  end if;

  update public.payments
  set
    status = 'void',
    voided_by = actor_id,
    voided_at = changed_at,
    status_note = normalized_reason
  where id = current_payment.id;

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
    'payment_obligation',
    current_payment.id,
    jsonb_build_object(
      'event', 'finance.payment_obligation_voided',
      'from_status', current_payment.status,
      'reason', normalized_reason
    )
  );

  return query
  select payment.*
  from public.payments payment
  where payment.id = current_payment.id;
end;
$$;

create or replace function public.refresh_payment_obligation_statuses(
  target_organization_id uuid
)
returns table (
  open_count bigint,
  overdue_count bigint,
  updated_count integer,
  refreshed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  changed_count integer := 0;
  scan_time timestamptz := statement_timestamp();
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to refresh payment statuses.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('payment-ledger:' || target_organization_id::text)
  );

  update public.payments payment
  set status = (
    case
      when payment.paid_amount = payment.amount then 'paid'
      when payment.due_at < current_date then 'overdue'
      when payment.paid_amount > 0 then 'partially_paid'
      else 'pending'
    end
  )::public.payment_status
  where payment.organization_id = target_organization_id
    and payment.status not in ('refunded', 'void')
    and payment.status is distinct from (
      case
        when payment.paid_amount = payment.amount then 'paid'
        when payment.due_at < current_date then 'overdue'
        when payment.paid_amount > 0 then 'partially_paid'
        else 'pending'
      end
    )::public.payment_status;
  get diagnostics changed_count = row_count;

  if changed_count > 0 then
    insert into public.audit_events (
      organization_id,
      actor_id,
      event_type,
      entity_type,
      metadata,
      created_at
    )
    values (
      target_organization_id,
      actor_id,
      'record.updated',
      'payment_ledger',
      jsonb_build_object(
        'event', 'finance.payment_statuses_refreshed',
        'updated_count', changed_count
      ),
      scan_time
    );
  end if;

  return query
  select
    count(*) filter (
      where payment.status in ('pending', 'partially_paid', 'overdue')
    ),
    count(*) filter (where payment.status = 'overdue'),
    changed_count,
    scan_time
  from public.payments payment
  where payment.organization_id = target_organization_id;
end;
$$;

revoke all on function public.create_payment_obligation(
  uuid,
  text,
  text,
  numeric,
  text,
  date,
  uuid,
  uuid,
  uuid,
  text,
  text
) from public, anon;
grant execute on function public.create_payment_obligation(
  uuid,
  text,
  text,
  numeric,
  text,
  date,
  uuid,
  uuid,
  uuid,
  text,
  text
) to authenticated;

revoke all on function public.record_payment_allocation(
  uuid,
  uuid,
  numeric,
  timestamptz,
  text,
  text
) from public, anon;
grant execute on function public.record_payment_allocation(
  uuid,
  uuid,
  numeric,
  timestamptz,
  text,
  text
) to authenticated;

revoke all on function public.void_payment_obligation(uuid, uuid, text)
  from public, anon;
grant execute on function public.void_payment_obligation(uuid, uuid, text)
  to authenticated;

revoke all on function public.refresh_payment_obligation_statuses(uuid)
  from public, anon;
grant execute on function public.refresh_payment_obligation_statuses(uuid)
  to authenticated;

-- Extend Operations Radar without duplicating its original seven-signal
-- scanner. The renamed function remains private and the wrapper adds finance.
alter function private.find_operational_exceptions(uuid)
  rename to find_trip_operational_exceptions_v1;

alter table public.operational_exceptions
  drop constraint operational_exceptions_exception_type_check,
  add constraint operational_exceptions_exception_type_check
    check (
      exception_type in (
        'trip_dates_missing',
        'traveler_roster_empty',
        'booking_plan_empty',
        'booking_schedule_missing',
        'booking_confirmation_at_risk',
        'document_expiring',
        'operational_task_overdue',
        'payment_due'
      )
    ),
  drop constraint operational_exceptions_source_entity_type_check,
  add constraint operational_exceptions_source_entity_type_check
    check (
      source_entity_type in (
        'trip',
        'booking',
        'document',
        'task',
        'payment'
      )
    );

create or replace function private.find_operational_exceptions(
  target_organization_id uuid
)
returns table (
  finding_dedupe_key text,
  finding_trip_id uuid,
  finding_exception_type text,
  finding_severity text,
  finding_source_entity_type text,
  finding_source_entity_id uuid,
  finding_title text,
  finding_summary text,
  finding_evidence jsonb,
  finding_due_at timestamptz,
  finding_assigned_to uuid
)
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select *
  from private.find_trip_operational_exceptions_v1(target_organization_id)

  union all

  select
    format('payment:%s:due', payment.id),
    trip.id,
    'payment_due',
    case
      when payment.due_at < current_date then 'critical'
      when payment.due_at <= current_date + 2 then 'high'
      else 'medium'
    end,
    'payment',
    payment.id,
    case
      when payment.direction = 'receivable' then 'Customer payment needs attention'
      else 'Supplier payment needs attention'
    end,
    format(
      '%s has %s %s outstanding and is due %s.',
      payment.title,
      (payment.amount - payment.paid_amount),
      payment.currency,
      payment.due_at
    ),
    jsonb_build_object(
      'payment_id', payment.id,
      'direction', payment.direction,
      'status', payment.status,
      'amount', payment.amount,
      'paid_amount', payment.paid_amount,
      'outstanding_amount', payment.amount - payment.paid_amount,
      'currency', payment.currency,
      'due_at', payment.due_at
    ),
    payment.due_at::timestamp at time zone 'UTC',
    trip.owner_id
  from public.payments payment
  join public.trips trip
    on trip.organization_id = payment.organization_id
   and trip.id = payment.trip_id
  where payment.organization_id = target_organization_id
    and trip.status in ('draft', 'confirmed', 'in_travel')
    and payment.status not in ('paid', 'refunded', 'void')
    and payment.paid_amount < payment.amount
    and payment.due_at is not null
    and payment.due_at <= current_date + 7;
$$;

revoke all on function private.find_trip_operational_exceptions_v1(uuid)
  from public, anon, authenticated;
revoke all on function private.find_operational_exceptions(uuid)
  from public, anon, authenticated;
