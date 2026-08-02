-- Immutable customer payment schedules bound to an exact quote version.
-- A schedule is commercial evidence only: it does not issue an invoice,
-- create a receivable, collect money, or contact a customer.

create or replace function private.quote_payment_schedule_is_valid(
  target_items jsonb,
  target_total_amount numeric
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  item_value jsonb;
  item_index integer := 0;
  item_count integer;
  item_kind text;
  item_label text;
  item_amount numeric;
  item_due_date date;
  previous_due_date date;
  schedule_total numeric := 0;
  deposit_count integer := 0;
  balance_count integer := 0;
begin
  if target_total_amount is null
    or target_total_amount <= 0
    or jsonb_typeof(target_items) is distinct from 'array'
  then
    return false;
  end if;

  item_count := jsonb_array_length(target_items);
  if item_count not between 1 and 12 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_items) item(value)
    group by lower(btrim(item.value ->> 'label'))
    having count(*) > 1
  ) then
    return false;
  end if;

  for item_value in
    select item.value
    from jsonb_array_elements(target_items) item(value)
  loop
    if jsonb_typeof(item_value) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(item_value) item_key
        where item_key not in ('kind', 'label', 'amount', 'due_date')
      )
      or jsonb_typeof(item_value -> 'kind') is distinct from 'string'
      or jsonb_typeof(item_value -> 'label') is distinct from 'string'
      or jsonb_typeof(item_value -> 'amount') is distinct from 'number'
      or jsonb_typeof(item_value -> 'due_date') is distinct from 'string'
    then
      return false;
    end if;

    if (item_value ->> 'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then
      return false;
    end if;

    item_kind := item_value ->> 'kind';
    item_label := item_value ->> 'label';
    item_amount := (item_value ->> 'amount')::numeric;
    item_due_date := make_date(
      substring(item_value ->> 'due_date' from 1 for 4)::integer,
      substring(item_value ->> 'due_date' from 6 for 2)::integer,
      substring(item_value ->> 'due_date' from 9 for 2)::integer
    );

    if item_kind not in ('deposit', 'installment', 'balance')
      or item_label <> btrim(item_label)
      or char_length(item_label) not between 1 and 120
      or item_amount <= 0
      or item_amount > 999999999999.99
      or (previous_due_date is not null and item_due_date < previous_due_date)
    then
      return false;
    end if;

    if item_kind = 'deposit' then
      deposit_count := deposit_count + 1;
      if item_index <> 0 then
        return false;
      end if;
    elsif item_kind = 'balance' then
      balance_count := balance_count + 1;
      if item_index <> item_count - 1 then
        return false;
      end if;
    end if;

    schedule_total := schedule_total + item_amount;
    previous_due_date := item_due_date;
    item_index := item_index + 1;
  end loop;

  return deposit_count <= 1
    and balance_count = 1
    and round(schedule_total, 2) = round(target_total_amount, 2);
exception
  when others then
    return false;
end;
$$;

revoke all on function private.quote_payment_schedule_is_valid(jsonb, numeric)
  from public, anon, authenticated;

create table public.quote_payment_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  quote_id uuid not null,
  quote_version_id uuid not null,
  revision integer not null check (revision > 0),
  status text not null default 'active'
    check (status in ('active', 'superseded')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  total_amount numeric(14, 2) not null check (total_amount > 0),
  items jsonb not null,
  item_count smallint generated always as (jsonb_array_length(items)) stored,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  superseded_by uuid references public.profiles(id) on delete set null,
  superseded_at timestamptz,
  constraint quote_payment_schedules_organization_id_id_key
    unique (organization_id, id),
  constraint quote_payment_schedules_quote_revision_key
    unique (quote_id, revision),
  constraint quote_payment_schedules_version_same_organization_fkey
    foreign key (organization_id, quote_id, quote_version_id)
    references public.quote_versions (organization_id, quote_id, id)
    on delete cascade,
  constraint quote_payment_schedules_items_valid
    check (private.quote_payment_schedule_is_valid(items, total_amount)),
  constraint quote_payment_schedules_lifecycle_evidence
    check (
      (status = 'active' and superseded_at is null and superseded_by is null)
      or
      (status = 'superseded' and superseded_at is not null)
    )
);

create unique index quote_payment_schedules_one_active_quote_idx
  on public.quote_payment_schedules (quote_id)
  where status = 'active';
create index quote_payment_schedules_org_version_idx
  on public.quote_payment_schedules (
    organization_id,
    quote_version_id,
    status
  );
create index quote_payment_schedules_created_by_idx
  on public.quote_payment_schedules (created_by)
  where created_by is not null;
create index quote_payment_schedules_superseded_by_idx
  on public.quote_payment_schedules (superseded_by)
  where superseded_by is not null;

create trigger quote_payment_schedules_prevent_organization_move
  before update on public.quote_payment_schedules
  for each row execute function private.prevent_organization_id_change();

alter table public.quote_payment_schedules enable row level security;

create policy quote_payment_schedules_member_select
  on public.quote_payment_schedules
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

revoke all on table public.quote_payment_schedules
  from public, anon, authenticated;
grant select on table public.quote_payment_schedules to authenticated;
grant select, insert, update, delete on table public.quote_payment_schedules
  to service_role;

create or replace function public.append_quote_payment_schedule(
  target_organization_id uuid,
  target_quote_id uuid,
  target_items jsonb
)
returns setof public.quote_payment_schedules
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  quote_record record;
  previous_schedule public.quote_payment_schedules%rowtype;
  created_schedule public.quote_payment_schedules%rowtype;
  next_revision integer;
  schedule_hash text;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to configure quote payment terms.'
      using errcode = '42501';
  end if;

  select
    quote.id,
    quote.status,
    quote.current_version,
    quote.currency,
    version.id as quote_version_id,
    version.total_amount
  into quote_record
  from public.quotes quote
  join public.quote_versions version
    on version.organization_id = quote.organization_id
    and version.quote_id = quote.id
    and version.version = quote.current_version
  where quote.organization_id = target_organization_id
    and quote.id = target_quote_id
  for update of quote;

  if not found then
    raise exception 'This quote is not available in this workspace.'
      using errcode = 'P0002';
  end if;
  if quote_record.status <> 'draft' then
    raise exception 'Only an internal draft can receive revised payment terms.'
      using errcode = '22023';
  end if;
  if not private.quote_payment_schedule_is_valid(
    target_items,
    quote_record.total_amount
  ) then
    raise exception 'Payment milestones must be ordered and reconcile to the current quote total.'
      using errcode = '22023';
  end if;

  schedule_hash := encode(
    extensions.digest(convert_to(target_items::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select schedule.*
  into previous_schedule
  from public.quote_payment_schedules schedule
  where schedule.organization_id = target_organization_id
    and schedule.quote_id = target_quote_id
    and schedule.status = 'active'
  for update;

  if found
    and previous_schedule.quote_version_id = quote_record.quote_version_id
    and previous_schedule.content_sha256 = schedule_hash
  then
    return next previous_schedule;
    return;
  end if;

  select coalesce(max(schedule.revision), 0) + 1
  into next_revision
  from public.quote_payment_schedules schedule
  where schedule.quote_id = target_quote_id;

  if previous_schedule.id is not null then
    update public.quote_payment_schedules
    set
      status = 'superseded',
      superseded_by = actor_id,
      superseded_at = statement_timestamp()
    where id = previous_schedule.id;
  end if;

  insert into public.quote_payment_schedules (
    organization_id,
    quote_id,
    quote_version_id,
    revision,
    currency,
    total_amount,
    items,
    content_sha256,
    created_by
  ) values (
    target_organization_id,
    target_quote_id,
    quote_record.quote_version_id,
    next_revision,
    quote_record.currency,
    quote_record.total_amount,
    target_items,
    schedule_hash,
    actor_id
  ) returning * into created_schedule;

  with cancelled as (
    update public.approval_requests approval
    set
      status = 'cancelled',
      resolved_at = statement_timestamp()
    where approval.organization_id = target_organization_id
      and approval.action = 'quote.share'
      and approval.entity_type = 'quote'
      and approval.entity_id = target_quote_id
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
      'reason', 'quote_payment_schedule_changed',
      'current_quote_version', quote_record.current_version,
      'payment_schedule_revision', next_revision
    )
  from cancelled;

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
    'record.updated',
    'quote',
    target_quote_id,
    jsonb_build_object(
      'event', 'quote.payment_schedule_created',
      'quote_version', quote_record.current_version,
      'payment_schedule_revision', next_revision,
      'item_count', created_schedule.item_count,
      'content_sha256', schedule_hash,
      'invoice_created', false,
      'receivable_created', false,
      'external_delivery_performed', false
    )
  );

  return next created_schedule;
end;
$$;

revoke all on function public.append_quote_payment_schedule(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.append_quote_payment_schedule(uuid, uuid, jsonb)
  to authenticated, service_role;

-- The established guardrail trigger canonicalizes the approval first. This
-- later alphabetic trigger attaches only bounded exact-schedule evidence.
create or replace function private.attach_quote_payment_schedule_evidence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  schedule_record public.quote_payment_schedules%rowtype;
  expected_version_id uuid;
begin
  if new.action <> 'quote.share' then
    return new;
  end if;

  select version.id
  into expected_version_id
  from public.quotes quote
  join public.quote_versions version
    on version.organization_id = quote.organization_id
    and version.quote_id = quote.id
    and version.version = quote.current_version
  where quote.organization_id = new.organization_id
    and quote.id = new.entity_id;

  select schedule.*
  into schedule_record
  from public.quote_payment_schedules schedule
  where schedule.organization_id = new.organization_id
    and schedule.quote_id = new.entity_id
    and schedule.quote_version_id = expected_version_id
    and schedule.status = 'active';

  new.payload := new.payload || jsonb_build_object(
    'payment_schedule', case
      when schedule_record.id is null then jsonb_build_object(
        'configured', false,
        'invoice_created', false,
        'receivable_created', false
      )
      else jsonb_build_object(
        'configured', true,
        'revision', schedule_record.revision,
        'item_count', schedule_record.item_count,
        'content_sha256', schedule_record.content_sha256,
        'invoice_created', false,
        'receivable_created', false
      )
    end
  );

  return new;
end;
$$;

revoke all on function private.attach_quote_payment_schedule_evidence()
  from public, anon, authenticated;

create trigger zz_approval_requests_attach_quote_payment_schedule
  before insert on public.approval_requests
  for each row execute function private.attach_quote_payment_schedule_evidence();

-- The public proposal receives only the exact active schedule already bound
-- to its immutable quote version. No ledger or invoice state is exposed.
create or replace function private.attach_quote_payment_schedule_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  schedule_items jsonb := '[]'::jsonb;
begin
  select schedule.items
  into schedule_items
  from public.quote_payment_schedules schedule
  where schedule.organization_id = new.organization_id
    and schedule.quote_id = new.quote_id
    and schedule.quote_version_id = new.quote_version_id
    and schedule.status = 'active';

  new.snapshot := jsonb_set(
    new.snapshot,
    '{quote,payment_schedule}',
    coalesce(schedule_items, '[]'::jsonb),
    true
  );
  return new;
end;
$$;

revoke all on function private.attach_quote_payment_schedule_snapshot()
  from public, anon, authenticated;

create trigger quote_share_links_attach_payment_schedule
  before insert on public.quote_share_links
  for each row execute function private.attach_quote_payment_schedule_snapshot();
