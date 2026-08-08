-- Prepare exact accepted-quote invoice evidence without allocating a legal
-- invoice number, issuing a document, delivering it, or collecting money.

create table public.invoice_number_policies (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  number_prefix text not null default 'INV-'
    check (
      number_prefix = upper(btrim(number_prefix))
      and number_prefix ~ '^[A-Z0-9][A-Z0-9/-]{0,23}$'
    ),
  next_number bigint not null default 1
    check (next_number between 1 and 999999999),
  number_padding smallint not null default 4
    check (number_padding between 3 and 10),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default statement_timestamp()
);

create index invoice_number_policies_updated_by_idx
  on public.invoice_number_policies (updated_by)
  where updated_by is not null;

alter table public.invoice_number_policies enable row level security;

create policy invoice_number_policies_finance_select
  on public.invoice_number_policies
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  );

revoke all on table public.invoice_number_policies
  from public, anon, authenticated;
grant select on table public.invoice_number_policies to authenticated;
grant select, insert, update, delete
  on table public.invoice_number_policies to service_role;

insert into public.invoice_number_policies (organization_id)
select organization.id
from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function private.seed_invoice_number_policy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.invoice_number_policies (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function private.seed_invoice_number_policy()
  from public, anon, authenticated;

create trigger organizations_seed_invoice_number_policy
  after insert on public.organizations
  for each row execute function private.seed_invoice_number_policy();

create or replace function private.invoice_line_snapshot_is_valid(
  candidate jsonb,
  expected_net numeric,
  expected_tax numeric,
  expected_total numeric
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  item jsonb;
  item_quantity numeric;
  item_unit_price numeric;
  item_discount numeric;
  item_tax_percent numeric;
  item_net numeric;
  item_tax numeric;
  item_total numeric;
  net_sum numeric := 0;
  tax_sum numeric := 0;
  total_sum numeric := 0;
begin
  if jsonb_typeof(candidate) <> 'array'
    or jsonb_array_length(candidate) not between 1 and 50
  then
    return false;
  end if;

  for item in select value from jsonb_array_elements(candidate)
  loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array[
        'position',
        'category',
        'description',
        'quantity',
        'unit_price_amount',
        'discount_amount',
        'tax_percent',
        'net_amount',
        'tax_amount',
        'total_amount'
      ])
      or (item ->> 'position')::integer not between 0 and 49
      or item ->> 'category' not in (
        'accommodation',
        'transport',
        'activity',
        'service',
        'fee',
        'other'
      )
      or char_length(btrim(item ->> 'description')) not between 1 and 180
    then
      return false;
    end if;

    item_quantity := (item ->> 'quantity')::numeric;
    item_unit_price := (item ->> 'unit_price_amount')::numeric;
    item_discount := (item ->> 'discount_amount')::numeric;
    item_tax_percent := (item ->> 'tax_percent')::numeric;
    item_net := (item ->> 'net_amount')::numeric;
    item_tax := (item ->> 'tax_amount')::numeric;
    item_total := (item ->> 'total_amount')::numeric;

    if item_quantity <= 0
      or item_unit_price < 0
      or item_discount < 0
      or item_tax_percent not between 0 and 100
      or item_net <> round(item_quantity * item_unit_price, 2) - item_discount
      or item_tax <> round(item_net * item_tax_percent / 100, 2)
      or item_total <> item_net + item_tax
    then
      return false;
    end if;

    net_sum := net_sum + item_net;
    tax_sum := tax_sum + item_tax;
    total_sum := total_sum + item_total;
  end loop;

  return round(net_sum, 2) = round(expected_net, 2)
    and round(tax_sum, 2) = round(expected_tax, 2)
    and round(total_sum, 2) = round(expected_total, 2);
exception
  when others then
    return false;
end;
$$;

revoke all on function private.invoice_line_snapshot_is_valid(
  jsonb,
  numeric,
  numeric,
  numeric
) from public, anon, authenticated;

create table public.invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  quote_id uuid not null,
  quote_version_id uuid not null,
  quote_acceptance_id uuid not null,
  quote_payment_schedule_id uuid not null,
  deal_id uuid not null,
  contact_id uuid,
  revision integer not null check (revision > 0),
  status text not null default 'ready'
    check (status in ('ready', 'superseded')),
  number_preview text not null
    check (
      number_preview = upper(btrim(number_preview))
      and char_length(number_preview) between 4 and 40
    ),
  number_policy_updated_at timestamptz not null,
  bill_to_name text not null
    check (
      bill_to_name = btrim(bill_to_name)
      and char_length(bill_to_name) between 2 and 180
    ),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  net_amount numeric(14, 2) not null check (net_amount >= 0),
  tax_amount numeric(14, 2) not null check (tax_amount >= 0),
  total_amount numeric(14, 2) not null check (total_amount > 0),
  line_items jsonb not null,
  payment_terms jsonb not null,
  line_count smallint generated always as (jsonb_array_length(line_items)) stored,
  payment_term_count smallint generated always as (
    jsonb_array_length(payment_terms)
  ) stored,
  content_sha256 text not null default repeat('0', 64)
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  superseded_by uuid references public.profiles(id) on delete set null,
  superseded_at timestamptz,
  constraint invoice_drafts_organization_id_id_key
    unique (organization_id, id),
  constraint invoice_drafts_acceptance_revision_key
    unique (quote_acceptance_id, revision),
  constraint invoice_drafts_amounts_reconcile
    check (total_amount = net_amount + tax_amount),
  constraint invoice_drafts_lines_reconcile
    check (
      private.invoice_line_snapshot_is_valid(
        line_items,
        net_amount,
        tax_amount,
        total_amount
      )
    ),
  constraint invoice_drafts_payment_terms_reconcile
    check (private.quote_payment_schedule_is_valid(payment_terms, total_amount)),
  constraint invoice_drafts_lifecycle_evidence
    check (
      (status = 'ready' and superseded_by is null and superseded_at is null)
      or
      (status = 'superseded' and superseded_at is not null)
    ),
  constraint invoice_drafts_version_same_organization_fkey
    foreign key (organization_id, quote_id, quote_version_id)
    references public.quote_versions (organization_id, quote_id, id)
    on delete cascade,
  constraint invoice_drafts_acceptance_exact_version_fkey
    foreign key (
      organization_id,
      quote_id,
      quote_version_id,
      quote_acceptance_id
    )
    references public.quote_acceptances (
      organization_id,
      quote_id,
      quote_version_id,
      id
    )
    on delete cascade,
  constraint invoice_drafts_schedule_exact_version_fkey
    foreign key (
      organization_id,
      quote_id,
      quote_version_id,
      quote_payment_schedule_id
    )
    references public.quote_payment_schedules (
      organization_id,
      quote_id,
      quote_version_id,
      id
    )
    on delete cascade,
  constraint invoice_drafts_deal_same_organization_fkey
    foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete cascade,
  constraint invoice_drafts_contact_same_organization_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id)
    on delete set null (contact_id)
);

create unique index invoice_drafts_one_ready_acceptance_idx
  on public.invoice_drafts (organization_id, quote_acceptance_id)
  where status = 'ready';
create index invoice_drafts_org_created_idx
  on public.invoice_drafts (organization_id, created_at desc);
create index invoice_drafts_quote_idx
  on public.invoice_drafts (organization_id, quote_id, revision desc);
create index invoice_drafts_created_by_idx
  on public.invoice_drafts (created_by)
  where created_by is not null;
create index invoice_drafts_superseded_by_idx
  on public.invoice_drafts (superseded_by)
  where superseded_by is not null;
create index invoice_drafts_contact_idx
  on public.invoice_drafts (organization_id, contact_id)
  where contact_id is not null;

create or replace function private.set_invoice_draft_content_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions
as $$
begin
  new.content_sha256 := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'quote_id', new.quote_id,
          'quote_version_id', new.quote_version_id,
          'quote_acceptance_id', new.quote_acceptance_id,
          'quote_payment_schedule_id', new.quote_payment_schedule_id,
          'deal_id', new.deal_id,
          'contact_id', new.contact_id,
          'number_preview', new.number_preview,
          'number_policy_updated_at', new.number_policy_updated_at,
          'bill_to_name', new.bill_to_name,
          'currency', new.currency,
          'net_amount', new.net_amount,
          'tax_amount', new.tax_amount,
          'total_amount', new.total_amount,
          'line_items', new.line_items,
          'payment_terms', new.payment_terms
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

revoke all on function private.set_invoice_draft_content_hash()
  from public, anon, authenticated;

create trigger invoice_drafts_set_content_hash
  before insert on public.invoice_drafts
  for each row execute function private.set_invoice_draft_content_hash();

create or replace function private.protect_invoice_draft_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if row(
    old.organization_id,
    old.quote_id,
    old.quote_version_id,
    old.quote_acceptance_id,
    old.quote_payment_schedule_id,
    old.deal_id,
    old.contact_id,
    old.revision,
    old.number_preview,
    old.number_policy_updated_at,
    old.bill_to_name,
    old.currency,
    old.net_amount,
    old.tax_amount,
    old.total_amount,
    old.line_items,
    old.payment_terms,
    old.content_sha256,
    old.created_by,
    old.created_at
  ) is distinct from row(
    new.organization_id,
    new.quote_id,
    new.quote_version_id,
    new.quote_acceptance_id,
    new.quote_payment_schedule_id,
    new.deal_id,
    new.contact_id,
    new.revision,
    new.number_preview,
    new.number_policy_updated_at,
    new.bill_to_name,
    new.currency,
    new.net_amount,
    new.tax_amount,
    new.total_amount,
    new.line_items,
    new.payment_terms,
    new.content_sha256,
    new.created_by,
    new.created_at
  ) then
    raise exception 'Invoice draft evidence is immutable.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_invoice_draft_evidence()
  from public, anon, authenticated;

create trigger invoice_drafts_protect_evidence
  before update on public.invoice_drafts
  for each row execute function private.protect_invoice_draft_evidence();

alter table public.invoice_drafts enable row level security;

create policy invoice_drafts_finance_select
  on public.invoice_drafts
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  );

revoke all on table public.invoice_drafts
  from public, anon, authenticated;
grant select on table public.invoice_drafts to authenticated;
grant select, insert, update, delete on table public.invoice_drafts
  to service_role;

create or replace function public.upsert_invoice_number_policy(
  target_organization_id uuid,
  target_number_prefix text,
  target_next_number bigint,
  target_number_padding smallint
)
returns setof public.invoice_number_policies
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_prefix text := upper(btrim(target_number_prefix));
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to configure invoice numbering.'
      using errcode = '42501';
  end if;
  if normalized_prefix !~ '^[A-Z0-9][A-Z0-9/-]{0,23}$'
    or target_next_number not between 1 and 999999999
    or target_number_padding not between 3 and 10
  then
    raise exception 'Invoice numbering settings are invalid.'
      using errcode = '22023';
  end if;

  insert into public.invoice_number_policies (
    organization_id,
    number_prefix,
    next_number,
    number_padding,
    updated_by,
    updated_at
  ) values (
    target_organization_id,
    normalized_prefix,
    target_next_number,
    target_number_padding,
    actor_id,
    statement_timestamp()
  )
  on conflict (organization_id) do update set
    number_prefix = excluded.number_prefix,
    next_number = excluded.next_number,
    number_padding = excluded.number_padding,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

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
    'policy.updated',
    'invoice_number_policy',
    target_organization_id,
    jsonb_build_object(
      'event', 'finance.invoice_number_policy_updated',
      'number_prefix', normalized_prefix,
      'next_number', target_next_number,
      'number_padding', target_number_padding,
      'invoice_number_allocated', false,
      'invoice_issued', false,
      'invoice_delivered', false,
      'external_action_performed', false
    )
  );

  return query
  select policy.*
  from public.invoice_number_policies policy
  where policy.organization_id = target_organization_id;
end;
$$;

revoke all on function public.upsert_invoice_number_policy(
  uuid,
  text,
  bigint,
  smallint
) from public, anon;
grant execute on function public.upsert_invoice_number_policy(
  uuid,
  text,
  bigint,
  smallint
) to authenticated;

create or replace function public.prepare_accepted_quote_invoice_draft(
  target_organization_id uuid,
  target_quote_id uuid
)
returns table (
  invoice_draft_id uuid,
  revision integer,
  number_preview text,
  currency text,
  total_amount numeric,
  line_count integer,
  payment_term_count integer,
  already_prepared boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := (select auth.uid());
  quote_record public.quotes%rowtype;
  version_record public.quote_versions%rowtype;
  acceptance_record public.quote_acceptances%rowtype;
  schedule_record public.quote_payment_schedules%rowtype;
  policy_record public.invoice_number_policies%rowtype;
  existing_draft public.invoice_drafts%rowtype;
  contact_record public.contacts%rowtype;
  line_snapshot jsonb;
  line_count_value integer;
  line_net numeric;
  line_tax numeric;
  line_total numeric;
  receivable_count integer;
  receivable_position_count integer;
  receivable_total numeric;
  bill_to_name_value text;
  number_preview_value text;
  next_revision integer;
  draft_id uuid;
  computed_hash text;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to prepare invoice drafts.'
      using errcode = '42501';
  end if;

  select quote.*
  into quote_record
  from public.quotes quote
  where quote.organization_id = target_organization_id
    and quote.id = target_quote_id
  for update;

  if not found or quote_record.status <> 'accepted' then
    raise exception 'An accepted quote is required.' using errcode = '22023';
  end if;

  select version.*
  into version_record
  from public.quote_versions version
  where version.organization_id = target_organization_id
    and version.quote_id = quote_record.id
    and version.version = quote_record.current_version;

  select acceptance.*
  into acceptance_record
  from public.quote_acceptances acceptance
  where acceptance.organization_id = target_organization_id
    and acceptance.quote_id = quote_record.id
    and acceptance.quote_version_id = version_record.id;

  if not found then
    raise exception 'Exact current-version acceptance evidence is required.'
      using errcode = '22023';
  end if;

  select schedule.*
  into schedule_record
  from public.quote_payment_schedules schedule
  where schedule.organization_id = target_organization_id
    and schedule.quote_id = quote_record.id
    and schedule.quote_version_id = version_record.id
    and schedule.status = 'active';

  if not found
    or round(schedule_record.total_amount, 2) <> round(version_record.total_amount, 2)
  then
    raise exception 'An exact active payment schedule is required.'
      using errcode = '22023';
  end if;

  select
    count(*)::integer,
    count(distinct payment.quote_schedule_item_position)::integer,
    coalesce(sum(payment.amount), 0)
  into receivable_count, receivable_position_count, receivable_total
  from public.payments payment
  where payment.organization_id = target_organization_id
    and payment.quote_acceptance_id = acceptance_record.id
    and payment.quote_payment_schedule_id = schedule_record.id;

  if receivable_count <> schedule_record.item_count
    or receivable_position_count <> schedule_record.item_count
    or round(receivable_total, 2) <> round(schedule_record.total_amount, 2)
  then
    raise exception 'Exact reconciled quote receivables are required.'
      using errcode = '22023';
  end if;

  select
    jsonb_agg(
      jsonb_build_object(
        'position', line.position,
        'category', line.category,
        'description', line.description,
        'quantity', line.quantity,
        'unit_price_amount', line.unit_price_amount,
        'discount_amount', line.discount_amount,
        'tax_percent', line.tax_percent,
        'net_amount', line.net_amount,
        'tax_amount', line.tax_amount,
        'total_amount', line.total_amount
      ) order by line.position
    ),
    count(*)::integer,
    coalesce(sum(line.net_amount), 0),
    coalesce(sum(line.tax_amount), 0),
    coalesce(sum(line.total_amount), 0)
  into line_snapshot, line_count_value, line_net, line_tax, line_total
  from public.quote_line_items line
  where line.organization_id = target_organization_id
    and line.quote_version_id = version_record.id;

  if line_count_value < 1
    or round(line_net, 2) <> round(version_record.net_amount, 2)
    or round(line_tax, 2) <> round(version_record.tax_amount, 2)
    or round(line_total, 2) <> round(version_record.total_amount, 2)
  then
    raise exception 'Reconciled structured invoice lines are required.'
      using errcode = '22023';
  end if;

  if quote_record.deal_id is null then
    raise exception 'The quote needs a linked opportunity.' using errcode = '22023';
  end if;

  select contact.*
  into contact_record
  from public.deals deal
  join public.contacts contact
    on contact.organization_id = deal.organization_id
   and contact.id = deal.contact_id
  where deal.organization_id = target_organization_id
    and deal.id = quote_record.deal_id;

  if not found then
    raise exception 'A linked customer identity is required.' using errcode = '22023';
  end if;

  bill_to_name_value := btrim(concat_ws(
    ' ',
    contact_record.first_name,
    contact_record.last_name
  ));

  select policy.*
  into policy_record
  from public.invoice_number_policies policy
  where policy.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'Invoice numbering policy is unavailable.'
      using errcode = '22023';
  end if;

  number_preview_value := policy_record.number_prefix || lpad(
    policy_record.next_number::text,
    policy_record.number_padding,
    '0'
  );

  computed_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'quote_id', quote_record.id,
          'quote_version_id', version_record.id,
          'quote_acceptance_id', acceptance_record.id,
          'quote_payment_schedule_id', schedule_record.id,
          'deal_id', quote_record.deal_id,
          'contact_id', contact_record.id,
          'number_preview', number_preview_value,
          'number_policy_updated_at', policy_record.updated_at,
          'bill_to_name', bill_to_name_value,
          'currency', quote_record.currency,
          'net_amount', version_record.net_amount,
          'tax_amount', version_record.tax_amount,
          'total_amount', version_record.total_amount,
          'line_items', line_snapshot,
          'payment_terms', schedule_record.items
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select draft.*
  into existing_draft
  from public.invoice_drafts draft
  where draft.organization_id = target_organization_id
    and draft.quote_acceptance_id = acceptance_record.id
    and draft.status = 'ready'
  for update;

  if found and existing_draft.content_sha256 = computed_hash then
    return query select
      existing_draft.id,
      existing_draft.revision,
      existing_draft.number_preview,
      existing_draft.currency::text,
      existing_draft.total_amount,
      existing_draft.line_count::integer,
      existing_draft.payment_term_count::integer,
      true;
    return;
  end if;

  if found then
    update public.invoice_drafts
    set
      status = 'superseded',
      superseded_by = actor_id,
      superseded_at = statement_timestamp()
    where id = existing_draft.id;
  end if;

  select coalesce(max(draft.revision), 0) + 1
  into next_revision
  from public.invoice_drafts draft
  where draft.quote_acceptance_id = acceptance_record.id;

  insert into public.invoice_drafts (
    organization_id,
    quote_id,
    quote_version_id,
    quote_acceptance_id,
    quote_payment_schedule_id,
    deal_id,
    contact_id,
    revision,
    number_preview,
    number_policy_updated_at,
    bill_to_name,
    currency,
    net_amount,
    tax_amount,
    total_amount,
    line_items,
    payment_terms,
    created_by
  ) values (
    target_organization_id,
    quote_record.id,
    version_record.id,
    acceptance_record.id,
    schedule_record.id,
    quote_record.deal_id,
    contact_record.id,
    next_revision,
    number_preview_value,
    policy_record.updated_at,
    bill_to_name_value,
    quote_record.currency,
    version_record.net_amount,
    version_record.tax_amount,
    version_record.total_amount,
    line_snapshot,
    schedule_record.items,
    actor_id
  )
  returning id into draft_id;

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
    'invoice_draft',
    draft_id,
    jsonb_build_object(
      'event', 'finance.invoice_draft_prepared',
      'quote_id', quote_record.id,
      'quote_version', quote_record.current_version,
      'acceptance_id', acceptance_record.id,
      'payment_schedule_id', schedule_record.id,
      'draft_revision', next_revision,
      'line_count', line_count_value,
      'payment_term_count', schedule_record.item_count,
      'currency', quote_record.currency,
      'total_amount', version_record.total_amount,
      'content_sha256', computed_hash,
      'invoice_number_allocated', false,
      'invoice_issued', false,
      'invoice_delivered', false,
      'payment_collected', false,
      'external_action_performed', false
    )
  );

  return query
  select
    draft.id,
    draft.revision,
    draft.number_preview,
    draft.currency::text,
    draft.total_amount,
    draft.line_count::integer,
    draft.payment_term_count::integer,
    false
  from public.invoice_drafts draft
  where draft.id = draft_id;
end;
$$;

revoke all on function public.prepare_accepted_quote_invoice_draft(uuid, uuid)
  from public, anon;
grant execute on function public.prepare_accepted_quote_invoice_draft(uuid, uuid)
  to authenticated;
