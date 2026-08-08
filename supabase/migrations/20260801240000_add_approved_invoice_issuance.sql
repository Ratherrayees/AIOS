-- A permanent invoice number is consumed only after one exact immutable draft
-- and the current issuer identity have received a human approval. This records
-- issuance evidence; rendering, delivery, payment links, and collection remain
-- separate external-effect workflows.

create table public.invoice_issuer_profiles (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  legal_name text not null
    check (
      legal_name = btrim(legal_name)
      and char_length(legal_name) between 2 and 180
    ),
  registered_address text not null
    check (
      registered_address = btrim(registered_address)
      and char_length(registered_address) between 10 and 500
    ),
  jurisdiction_country_code char(2) not null
    check (jurisdiction_country_code ~ '^[A-Z]{2}$'),
  tax_registration_id text
    check (
      tax_registration_id is null
      or (
        tax_registration_id = upper(btrim(tax_registration_id))
        and char_length(tax_registration_id) between 2 and 80
      )
    ),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default statement_timestamp()
);

create index invoice_issuer_profiles_updated_by_idx
  on public.invoice_issuer_profiles (updated_by)
  where updated_by is not null;

alter table public.invoice_issuer_profiles enable row level security;

create policy invoice_issuer_profiles_finance_select
  on public.invoice_issuer_profiles
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  );

revoke all on table public.invoice_issuer_profiles
  from public, anon, authenticated;
grant select on table public.invoice_issuer_profiles to authenticated;
grant select, insert, update, delete on table public.invoice_issuer_profiles
  to service_role;

create or replace function public.upsert_invoice_issuer_profile(
  target_organization_id uuid,
  target_legal_name text,
  target_registered_address text,
  target_jurisdiction_country_code text,
  target_tax_registration_id text default null
)
returns setof public.invoice_issuer_profiles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_legal_name text := btrim(target_legal_name);
  normalized_address text := btrim(target_registered_address);
  normalized_country text := upper(btrim(target_jurisdiction_country_code));
  normalized_tax_id text := nullif(upper(btrim(target_tax_registration_id)), '');
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to configure invoice identity.'
      using errcode = '42501';
  end if;
  if char_length(normalized_legal_name) not between 2 and 180
    or char_length(normalized_address) not between 10 and 500
    or normalized_country !~ '^[A-Z]{2}$'
    or (
      normalized_tax_id is not null
      and char_length(normalized_tax_id) not between 2 and 80
    )
  then
    raise exception 'Invoice issuer identity is invalid.'
      using errcode = '22023';
  end if;

  insert into public.invoice_issuer_profiles (
    organization_id,
    legal_name,
    registered_address,
    jurisdiction_country_code,
    tax_registration_id,
    updated_by,
    updated_at
  ) values (
    target_organization_id,
    normalized_legal_name,
    normalized_address,
    normalized_country,
    normalized_tax_id,
    actor_id,
    statement_timestamp()
  )
  on conflict (organization_id) do update set
    legal_name = excluded.legal_name,
    registered_address = excluded.registered_address,
    jurisdiction_country_code = excluded.jurisdiction_country_code,
    tax_registration_id = excluded.tax_registration_id,
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
    'invoice_issuer_profile',
    target_organization_id,
    jsonb_build_object(
      'event', 'finance.invoice_issuer_profile_updated',
      'jurisdiction_country_code', normalized_country,
      'tax_registration_configured', normalized_tax_id is not null,
      'approval_created', false,
      'invoice_number_allocated', false,
      'invoice_issued', false,
      'invoice_delivered', false,
      'external_action_performed', false
    )
  );

  return query
  select profile.*
  from public.invoice_issuer_profiles profile
  where profile.organization_id = target_organization_id;
end;
$$;

revoke all on function public.upsert_invoice_issuer_profile(
  uuid,
  text,
  text,
  text,
  text
) from public, anon;
grant execute on function public.upsert_invoice_issuer_profile(
  uuid,
  text,
  text,
  text,
  text
) to authenticated;

alter table public.invoice_drafts
  drop constraint invoice_drafts_lifecycle_evidence,
  drop constraint invoice_drafts_status_check;

alter table public.invoice_drafts
  add constraint invoice_drafts_status_check
    check (status in ('ready', 'superseded', 'issued')),
  add constraint invoice_drafts_lifecycle_evidence
    check (
      (
        status in ('ready', 'issued')
        and superseded_by is null
        and superseded_at is null
      )
      or
      (status = 'superseded' and superseded_at is not null)
    ),
  add constraint invoice_drafts_exact_issuance_source_key
    unique (
      organization_id,
      id,
      quote_id,
      quote_version_id,
      quote_acceptance_id,
      quote_payment_schedule_id,
      deal_id,
      revision,
      content_sha256
    );

create table public.invoice_issuances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  invoice_draft_id uuid not null,
  approval_request_id uuid not null,
  quote_id uuid not null,
  quote_version_id uuid not null,
  quote_acceptance_id uuid not null,
  quote_payment_schedule_id uuid not null,
  deal_id uuid not null,
  draft_revision integer not null check (draft_revision > 0),
  source_content_sha256 text not null
    check (source_content_sha256 ~ '^[0-9a-f]{64}$'),
  invoice_number text not null
    check (
      invoice_number = upper(btrim(invoice_number))
      and char_length(invoice_number) between 4 and 40
    ),
  sequence_value bigint not null
    check (sequence_value between 1 and 999999999),
  number_prefix text not null
    check (
      number_prefix = upper(btrim(number_prefix))
      and number_prefix ~ '^[A-Z0-9][A-Z0-9/-]{0,23}$'
    ),
  number_padding smallint not null
    check (number_padding between 3 and 10),
  number_policy_updated_at timestamptz not null,
  issuer_profile_updated_at timestamptz not null,
  issuer_legal_name text not null
    check (
      issuer_legal_name = btrim(issuer_legal_name)
      and char_length(issuer_legal_name) between 2 and 180
    ),
  issuer_registered_address text not null
    check (
      issuer_registered_address = btrim(issuer_registered_address)
      and char_length(issuer_registered_address) between 10 and 500
    ),
  issuer_jurisdiction_country_code char(2) not null
    check (issuer_jurisdiction_country_code ~ '^[A-Z]{2}$'),
  issuer_tax_registration_id text
    check (
      issuer_tax_registration_id is null
      or (
        issuer_tax_registration_id = upper(btrim(issuer_tax_registration_id))
        and char_length(issuer_tax_registration_id) between 2 and 80
      )
    ),
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
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_at timestamptz not null,
  issued_by uuid not null references public.profiles(id) on delete restrict,
  issued_at timestamptz not null default statement_timestamp(),
  issuance_sha256 text not null default repeat('0', 64)
    check (issuance_sha256 ~ '^[0-9a-f]{64}$'),
  constraint invoice_issuances_organization_id_id_key
    unique (organization_id, id),
  constraint invoice_issuances_one_draft_key unique (invoice_draft_id),
  constraint invoice_issuances_one_approval_key unique (approval_request_id),
  constraint invoice_issuances_one_acceptance_key unique (quote_acceptance_id),
  constraint invoice_issuances_amounts_reconcile
    check (total_amount = net_amount + tax_amount),
  constraint invoice_issuances_tax_identity_check
    check (tax_amount = 0 or issuer_tax_registration_id is not null),
  constraint invoice_issuances_lines_reconcile
    check (
      private.invoice_line_snapshot_is_valid(
        line_items,
        net_amount,
        tax_amount,
        total_amount
      )
    ),
  constraint invoice_issuances_payment_terms_reconcile
    check (private.quote_payment_schedule_is_valid(payment_terms, total_amount)),
  constraint invoice_issuances_exact_draft_fkey
    foreign key (
      organization_id,
      invoice_draft_id,
      quote_id,
      quote_version_id,
      quote_acceptance_id,
      quote_payment_schedule_id,
      deal_id,
      draft_revision,
      source_content_sha256
    )
    references public.invoice_drafts (
      organization_id,
      id,
      quote_id,
      quote_version_id,
      quote_acceptance_id,
      quote_payment_schedule_id,
      deal_id,
      revision,
      content_sha256
    )
    on delete cascade,
  constraint invoice_issuances_approval_same_organization_fkey
    foreign key (organization_id, approval_request_id)
    references public.approval_requests (organization_id, id)
    on delete restrict
);

create unique index invoice_issuances_org_number_idx
  on public.invoice_issuances (organization_id, lower(invoice_number));
create unique index invoice_issuances_prefix_sequence_idx
  on public.invoice_issuances (
    organization_id,
    number_prefix,
    sequence_value
  );
create index invoice_issuances_org_issued_idx
  on public.invoice_issuances (organization_id, issued_at desc);
create index invoice_issuances_quote_idx
  on public.invoice_issuances (organization_id, quote_id);
create index invoice_issuances_approved_by_idx
  on public.invoice_issuances (approved_by);
create index invoice_issuances_issued_by_idx
  on public.invoice_issuances (issued_by);

alter table public.invoice_issuances enable row level security;

create policy invoice_issuances_finance_select
  on public.invoice_issuances
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  );

revoke all on table public.invoice_issuances
  from public, anon, authenticated;
grant select on table public.invoice_issuances to authenticated;
grant select, insert, update, delete on table public.invoice_issuances
  to service_role;

alter table public.payments
  add column invoice_issuance_id uuid,
  add constraint payments_invoice_issuance_same_organization_fkey
    foreign key (organization_id, invoice_issuance_id)
    references public.invoice_issuances (organization_id, id)
    on delete set null (invoice_issuance_id);

create index payments_invoice_issuance_idx
  on public.payments (organization_id, invoice_issuance_id)
  where invoice_issuance_id is not null;

create or replace function private.validate_invoice_payment_link()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  issuance_record public.invoice_issuances%rowtype;
begin
  if new.invoice_issuance_id is null then
    return new;
  end if;

  select issuance.*
  into issuance_record
  from public.invoice_issuances issuance
  where issuance.organization_id = new.organization_id
    and issuance.id = new.invoice_issuance_id;

  if not found
    or new.direction <> 'receivable'
    or new.quote_id is distinct from issuance_record.quote_id
    or new.quote_version_id is distinct from issuance_record.quote_version_id
    or new.quote_acceptance_id is distinct from issuance_record.quote_acceptance_id
    or new.quote_payment_schedule_id is distinct from issuance_record.quote_payment_schedule_id
  then
    raise exception 'Invoice issuance must match the exact quote receivable.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_invoice_payment_link()
  from public, anon, authenticated;

create trigger payments_validate_invoice_issuance
  before insert or update of invoice_issuance_id on public.payments
  for each row execute function private.validate_invoice_payment_link();

create or replace function private.prevent_invoice_draft_after_issuance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.invoice_issuances issuance
    where issuance.organization_id = new.organization_id
      and issuance.quote_acceptance_id = new.quote_acceptance_id
  ) then
    raise exception 'This accepted quote already has immutable issuance evidence.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_invoice_draft_after_issuance()
  from public, anon, authenticated;

create trigger invoice_drafts_block_after_issuance
  before insert on public.invoice_drafts
  for each row execute function private.prevent_invoice_draft_after_issuance();

create or replace function private.enforce_invoice_number_monotonicity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  greatest_issued bigint;
begin
  select max(issuance.sequence_value)
  into greatest_issued
  from public.invoice_issuances issuance
  where issuance.organization_id = new.organization_id
    and issuance.number_prefix = new.number_prefix;

  if greatest_issued is not null and new.next_number <= greatest_issued then
    raise exception 'The next invoice number must follow every issued number in this prefix.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_invoice_number_monotonicity()
  from public, anon, authenticated;

create trigger invoice_number_policies_enforce_monotonicity
  before insert or update on public.invoice_number_policies
  for each row execute function private.enforce_invoice_number_monotonicity();

create or replace function private.invoice_issuer_profile_sha256(
  legal_name_value text,
  address_value text,
  country_value text,
  tax_id_value text,
  updated_at_value timestamptz
)
returns text
language sql
immutable
set search_path = pg_catalog, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'legal_name', legal_name_value,
          'registered_address', address_value,
          'jurisdiction_country_code', country_value,
          'tax_registration_id', tax_id_value,
          'updated_at', updated_at_value
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.invoice_issuer_profile_sha256(
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

create or replace function private.enforce_invoice_issue_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select auth.uid());
  draft_record public.invoice_drafts%rowtype;
  policy_record public.invoice_number_policies%rowtype;
  issuer_record public.invoice_issuer_profiles%rowtype;
  current_preview text;
  issuer_hash text;
begin
  if new.action <> 'invoice.issue' then
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
    raise exception 'You do not have permission to request invoice issuance.'
      using errcode = '42501';
  end if;
  if new.entity_type <> 'invoice_draft'
    or new.entity_id is null
    or char_length(btrim(coalesce(new.rationale, ''))) not between 12 and 1000
  then
    raise exception 'Exact invoice draft and review rationale are required.'
      using errcode = '22023';
  end if;
  if new.expires_at is null then
    new.expires_at := statement_timestamp() + interval '7 days';
  elsif new.expires_at < statement_timestamp() + interval '15 minutes'
    or new.expires_at > statement_timestamp() + interval '30 days'
  then
    raise exception 'Invoice issuance approval expiry is invalid.'
      using errcode = '22023';
  end if;

  select draft.*
  into draft_record
  from public.invoice_drafts draft
  where draft.organization_id = new.organization_id
    and draft.id = new.entity_id
  for update;

  if not found or draft_record.status <> 'ready' then
    raise exception 'A current ready invoice draft is required.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.invoice_issuances issuance
    where issuance.invoice_draft_id = draft_record.id
  ) then
    raise exception 'This invoice draft has already been issued.'
      using errcode = '23505';
  end if;

  select policy.*
  into policy_record
  from public.invoice_number_policies policy
  where policy.organization_id = new.organization_id
  for update;
  select issuer.*
  into issuer_record
  from public.invoice_issuer_profiles issuer
  where issuer.organization_id = new.organization_id;

  if policy_record.organization_id is null
    or issuer_record.organization_id is null
  then
    raise exception 'Current invoice number and issuer policies are required.'
      using errcode = '22023';
  end if;
  if draft_record.tax_amount > 0 and issuer_record.tax_registration_id is null then
    raise exception 'Tax registration evidence is required for a taxed invoice.'
      using errcode = '22023';
  end if;

  current_preview := policy_record.number_prefix || lpad(
    policy_record.next_number::text,
    policy_record.number_padding,
    '0'
  );
  if draft_record.number_policy_updated_at <> policy_record.updated_at
    or draft_record.number_preview <> current_preview
  then
    raise exception 'The invoice draft numbering preview is stale.'
      using errcode = '22023';
  end if;

  issuer_hash := private.invoice_issuer_profile_sha256(
    issuer_record.legal_name,
    issuer_record.registered_address,
    issuer_record.jurisdiction_country_code,
    issuer_record.tax_registration_id,
    issuer_record.updated_at
  );

  new.rationale := btrim(new.rationale);
  new.payload := jsonb_build_object(
    'invoice_draft_id', draft_record.id,
    'draft_revision', draft_record.revision,
    'draft_content_sha256', draft_record.content_sha256,
    'quote_id', draft_record.quote_id,
    'quote_version_id', draft_record.quote_version_id,
    'quote_acceptance_id', draft_record.quote_acceptance_id,
    'quote_payment_schedule_id', draft_record.quote_payment_schedule_id,
    'number_preview', draft_record.number_preview,
    'number_policy_updated_at', draft_record.number_policy_updated_at,
    'issuer_profile_updated_at', issuer_record.updated_at,
    'issuer_profile_sha256', issuer_hash,
    'currency', draft_record.currency,
    'invoice_number_allocated', false,
    'invoice_issued', false,
    'invoice_delivered', false,
    'payment_link_created', false,
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
      'event', 'finance.invoice_issuance_requested',
      'action', 'invoice.issue',
      'invoice_draft_id', draft_record.id,
      'draft_revision', draft_record.revision,
      'draft_content_sha256', draft_record.content_sha256,
      'issuer_profile_sha256', issuer_hash,
      'invoice_number_allocated', false,
      'invoice_issued', false,
      'invoice_delivered', false,
      'external_action_performed', false
    )
  );
  return new;
end;
$$;

revoke all on function private.enforce_invoice_issue_approval()
  from public, anon, authenticated;

create trigger approval_requests_enforce_invoice_issue
  before insert on public.approval_requests
  for each row execute function private.enforce_invoice_issue_approval();

create or replace function public.request_invoice_issuance_approval(
  target_organization_id uuid,
  target_invoice_draft_id uuid,
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
    raise exception 'You do not have permission to request invoice issuance.'
      using errcode = '42501';
  end if;

  select approval.*
  into existing_approval
  from public.approval_requests approval
  where approval.organization_id = target_organization_id
    and approval.action = 'invoice.issue'
    and approval.entity_type = 'invoice_draft'
    and approval.entity_id = target_invoice_draft_id
    and approval.status = 'pending'
    and (approval.expires_at is null or approval.expires_at > statement_timestamp())
  order by approval.created_at desc
  limit 1
  for update;

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
    'invoice.issue',
    'invoice_draft',
    target_invoice_draft_id,
    target_rationale,
    statement_timestamp() + interval '7 days'
  )
  returning * into created_approval;

  return query select
    created_approval.id,
    created_approval.status,
    created_approval.expires_at,
    false;
end;
$$;

revoke all on function public.request_invoice_issuance_approval(
  uuid,
  uuid,
  text
) from public, anon;
grant execute on function public.request_invoice_issuance_approval(
  uuid,
  uuid,
  text
) to authenticated;

create or replace function private.expire_invoice_approvals_after_policy_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  expired_count integer;
begin
  update public.approval_requests approval
  set
    status = 'expired',
    resolved_at = statement_timestamp()
  where approval.organization_id = new.organization_id
    and approval.action = 'invoice.issue'
    and approval.status in ('pending', 'approved')
    and not exists (
      select 1
      from public.invoice_issuances issuance
      where issuance.approval_request_id = approval.id
    );
  get diagnostics expired_count = row_count;

  if expired_count > 0 then
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
      tg_table_name,
      new.organization_id,
      jsonb_build_object(
        'event', 'finance.invoice_issuance_approvals_expired',
        'reason', tg_table_name || '_changed',
        'expired_count', expired_count
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function private.expire_invoice_approvals_after_policy_change()
  from public, anon, authenticated;

create trigger invoice_number_policy_expire_approvals
  after update on public.invoice_number_policies
  for each row execute function private.expire_invoice_approvals_after_policy_change();
create trigger invoice_issuer_profile_expire_approvals
  after update on public.invoice_issuer_profiles
  for each row execute function private.expire_invoice_approvals_after_policy_change();

create or replace function private.expire_invoice_approvals_after_draft_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status = 'ready' and new.status <> 'ready' then
    update public.approval_requests approval
    set
      status = 'expired',
      resolved_at = statement_timestamp()
    where approval.organization_id = new.organization_id
      and approval.action = 'invoice.issue'
      and approval.entity_id = new.id
      and approval.status in ('pending', 'approved')
      and not exists (
        select 1
        from public.invoice_issuances issuance
        where issuance.approval_request_id = approval.id
      );
  end if;
  return new;
end;
$$;

revoke all on function private.expire_invoice_approvals_after_draft_change()
  from public, anon, authenticated;

create trigger invoice_drafts_expire_approvals
  after update of status on public.invoice_drafts
  for each row execute function private.expire_invoice_approvals_after_draft_change();

create or replace function private.validate_and_hash_invoice_issuance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  draft_record public.invoice_drafts%rowtype;
  policy_record public.invoice_number_policies%rowtype;
  issuer_record public.invoice_issuer_profiles%rowtype;
  approval_record public.approval_requests%rowtype;
  expected_number text;
  issuer_hash text;
begin
  select draft.* into draft_record
  from public.invoice_drafts draft
  where draft.organization_id = new.organization_id
    and draft.id = new.invoice_draft_id
  for update;
  select policy.* into policy_record
  from public.invoice_number_policies policy
  where policy.organization_id = new.organization_id
  for update;
  select issuer.* into issuer_record
  from public.invoice_issuer_profiles issuer
  where issuer.organization_id = new.organization_id;
  select approval.* into approval_record
  from public.approval_requests approval
  where approval.organization_id = new.organization_id
    and approval.id = new.approval_request_id
  for update;

  expected_number := policy_record.number_prefix || lpad(
    policy_record.next_number::text,
    policy_record.number_padding,
    '0'
  );
  issuer_hash := private.invoice_issuer_profile_sha256(
    issuer_record.legal_name,
    issuer_record.registered_address,
    issuer_record.jurisdiction_country_code,
    issuer_record.tax_registration_id,
    issuer_record.updated_at
  );

  if draft_record.status <> 'ready'
    or new.quote_id <> draft_record.quote_id
    or new.quote_version_id <> draft_record.quote_version_id
    or new.quote_acceptance_id <> draft_record.quote_acceptance_id
    or new.quote_payment_schedule_id <> draft_record.quote_payment_schedule_id
    or new.deal_id <> draft_record.deal_id
    or new.draft_revision <> draft_record.revision
    or new.source_content_sha256 <> draft_record.content_sha256
    or new.invoice_number <> expected_number
    or new.sequence_value <> policy_record.next_number
    or new.number_prefix <> policy_record.number_prefix
    or new.number_padding <> policy_record.number_padding
    or new.number_policy_updated_at <> policy_record.updated_at
    or new.issuer_profile_updated_at <> issuer_record.updated_at
    or new.issuer_legal_name <> issuer_record.legal_name
    or new.issuer_registered_address <> issuer_record.registered_address
    or new.issuer_jurisdiction_country_code <> issuer_record.jurisdiction_country_code
    or new.issuer_tax_registration_id is distinct from issuer_record.tax_registration_id
    or new.bill_to_name <> draft_record.bill_to_name
    or new.currency <> draft_record.currency
    or new.net_amount <> draft_record.net_amount
    or new.tax_amount <> draft_record.tax_amount
    or new.total_amount <> draft_record.total_amount
    or new.line_items <> draft_record.line_items
    or new.payment_terms <> draft_record.payment_terms
  then
    raise exception 'Invoice issuance evidence does not match the exact draft and policies.'
      using errcode = '23514';
  end if;
  if approval_record.status <> 'approved'
    or approval_record.action <> 'invoice.issue'
    or approval_record.entity_type <> 'invoice_draft'
    or approval_record.entity_id <> draft_record.id
    or approval_record.approver_id is null
    or approval_record.resolved_at is null
    or (
      approval_record.expires_at is not null
      and approval_record.expires_at <= statement_timestamp()
    )
    or approval_record.payload ->> 'draft_content_sha256' <> draft_record.content_sha256
    or approval_record.payload ->> 'issuer_profile_sha256' <> issuer_hash
    or approval_record.payload ->> 'number_preview' <> expected_number
    or coalesce((approval_record.payload ->> 'invoice_number_allocated')::boolean, true)
    or coalesce((approval_record.payload ->> 'invoice_issued')::boolean, true)
    or coalesce((approval_record.payload ->> 'invoice_delivered')::boolean, true)
    or coalesce((approval_record.payload ->> 'external_action_performed')::boolean, true)
  then
    raise exception 'An approved exact-draft invoice gate is required.'
      using errcode = '42501';
  end if;

  new.issuance_sha256 := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'invoice_draft_id', new.invoice_draft_id,
          'approval_request_id', new.approval_request_id,
          'source_content_sha256', new.source_content_sha256,
          'invoice_number', new.invoice_number,
          'sequence_value', new.sequence_value,
          'issuer_profile_updated_at', new.issuer_profile_updated_at,
          'issuer_legal_name', new.issuer_legal_name,
          'issuer_registered_address', new.issuer_registered_address,
          'issuer_jurisdiction_country_code', new.issuer_jurisdiction_country_code,
          'issuer_tax_registration_id', new.issuer_tax_registration_id,
          'bill_to_name', new.bill_to_name,
          'currency', new.currency,
          'net_amount', new.net_amount,
          'tax_amount', new.tax_amount,
          'total_amount', new.total_amount,
          'line_items', new.line_items,
          'payment_terms', new.payment_terms,
          'approved_by', new.approved_by,
          'approved_at', new.approved_at,
          'issued_by', new.issued_by,
          'issued_at', new.issued_at
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

revoke all on function private.validate_and_hash_invoice_issuance()
  from public, anon, authenticated;

create trigger invoice_issuances_validate_and_hash
  before insert on public.invoice_issuances
  for each row execute function private.validate_and_hash_invoice_issuance();

create or replace function private.protect_invoice_issuance_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Issued invoice evidence is immutable.'
    using errcode = '42501';
end;
$$;

revoke all on function private.protect_invoice_issuance_evidence()
  from public, anon, authenticated;

create trigger invoice_issuances_protect_evidence
  before update on public.invoice_issuances
  for each row execute function private.protect_invoice_issuance_evidence();

create or replace function public.issue_approved_invoice(
  target_organization_id uuid,
  target_invoice_draft_id uuid,
  target_approval_request_id uuid
)
returns table (
  invoice_issuance_id uuid,
  invoice_number text,
  issued_at timestamptz,
  currency text,
  total_amount numeric,
  linked_receivable_count integer,
  issuance_sha256 text,
  already_issued boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  draft_record public.invoice_drafts%rowtype;
  policy_record public.invoice_number_policies%rowtype;
  issuer_record public.invoice_issuer_profiles%rowtype;
  approval_record public.approval_requests%rowtype;
  existing_issuance public.invoice_issuances%rowtype;
  created_issuance public.invoice_issuances%rowtype;
  number_value text;
  receivable_count integer;
  receivable_position_count integer;
  receivable_total numeric;
  linked_count integer;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to issue an approved invoice.'
      using errcode = '42501';
  end if;

  select issuance.*
  into existing_issuance
  from public.invoice_issuances issuance
  where issuance.organization_id = target_organization_id
    and issuance.invoice_draft_id = target_invoice_draft_id
  for update;
  if found then
    if existing_issuance.approval_request_id <> target_approval_request_id then
      raise exception 'This invoice draft was issued through another approval.'
        using errcode = '23505';
    end if;
    select count(*)::integer into linked_count
    from public.payments payment
    where payment.organization_id = target_organization_id
      and payment.invoice_issuance_id = existing_issuance.id;
    return query select
      existing_issuance.id,
      existing_issuance.invoice_number,
      existing_issuance.issued_at,
      existing_issuance.currency::text,
      existing_issuance.total_amount,
      linked_count,
      existing_issuance.issuance_sha256,
      true;
    return;
  end if;

  select draft.* into draft_record
  from public.invoice_drafts draft
  where draft.organization_id = target_organization_id
    and draft.id = target_invoice_draft_id
  for update;
  select policy.* into policy_record
  from public.invoice_number_policies policy
  where policy.organization_id = target_organization_id
  for update;
  select issuer.* into issuer_record
  from public.invoice_issuer_profiles issuer
  where issuer.organization_id = target_organization_id;
  select approval.* into approval_record
  from public.approval_requests approval
  where approval.organization_id = target_organization_id
    and approval.id = target_approval_request_id
  for update;

  number_value := policy_record.number_prefix || lpad(
    policy_record.next_number::text,
    policy_record.number_padding,
    '0'
  );
  if draft_record.status <> 'ready'
    or draft_record.number_policy_updated_at <> policy_record.updated_at
    or draft_record.number_preview <> number_value
    or issuer_record.organization_id is null
    or approval_record.status <> 'approved'
    or approval_record.action <> 'invoice.issue'
    or approval_record.entity_id <> draft_record.id
    or approval_record.approver_id is null
    or approval_record.resolved_at is null
    or (
      approval_record.expires_at is not null
      and approval_record.expires_at <= statement_timestamp()
    )
    or not exists (
      select 1
      from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = approval_record.approver_id
        and membership.status = 'active'
        and membership.role in ('owner', 'admin', 'finance')
    )
  then
    raise exception 'The exact invoice approval is not currently executable.'
      using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(distinct payment.quote_schedule_item_position)::integer,
    coalesce(sum(payment.amount), 0)
  into receivable_count, receivable_position_count, receivable_total
  from public.payments payment
  where payment.organization_id = target_organization_id
    and payment.quote_acceptance_id = draft_record.quote_acceptance_id
    and payment.quote_payment_schedule_id = draft_record.quote_payment_schedule_id
    and payment.direction = 'receivable'
    and payment.invoice_issuance_id is null;

  if receivable_count <> draft_record.payment_term_count
    or receivable_position_count <> draft_record.payment_term_count
    or round(receivable_total, 2) <> round(draft_record.total_amount, 2)
  then
    raise exception 'Exact unissued quote receivables are required.'
      using errcode = '22023';
  end if;

  insert into public.invoice_issuances (
    organization_id,
    invoice_draft_id,
    approval_request_id,
    quote_id,
    quote_version_id,
    quote_acceptance_id,
    quote_payment_schedule_id,
    deal_id,
    draft_revision,
    source_content_sha256,
    invoice_number,
    sequence_value,
    number_prefix,
    number_padding,
    number_policy_updated_at,
    issuer_profile_updated_at,
    issuer_legal_name,
    issuer_registered_address,
    issuer_jurisdiction_country_code,
    issuer_tax_registration_id,
    bill_to_name,
    currency,
    net_amount,
    tax_amount,
    total_amount,
    line_items,
    payment_terms,
    approved_by,
    approved_at,
    issued_by
  ) values (
    target_organization_id,
    draft_record.id,
    approval_record.id,
    draft_record.quote_id,
    draft_record.quote_version_id,
    draft_record.quote_acceptance_id,
    draft_record.quote_payment_schedule_id,
    draft_record.deal_id,
    draft_record.revision,
    draft_record.content_sha256,
    number_value,
    policy_record.next_number,
    policy_record.number_prefix,
    policy_record.number_padding,
    policy_record.updated_at,
    issuer_record.updated_at,
    issuer_record.legal_name,
    issuer_record.registered_address,
    issuer_record.jurisdiction_country_code,
    issuer_record.tax_registration_id,
    draft_record.bill_to_name,
    draft_record.currency,
    draft_record.net_amount,
    draft_record.tax_amount,
    draft_record.total_amount,
    draft_record.line_items,
    draft_record.payment_terms,
    approval_record.approver_id,
    approval_record.resolved_at,
    actor_id
  )
  returning * into created_issuance;

  update public.payments payment
  set invoice_issuance_id = created_issuance.id
  where payment.organization_id = target_organization_id
    and payment.quote_acceptance_id = draft_record.quote_acceptance_id
    and payment.quote_payment_schedule_id = draft_record.quote_payment_schedule_id
    and payment.direction = 'receivable'
    and payment.invoice_issuance_id is null;
  get diagnostics linked_count = row_count;
  if linked_count <> draft_record.payment_term_count then
    raise exception 'Every exact receivable must link to the issued invoice.'
      using errcode = '23514';
  end if;

  update public.invoice_drafts
  set status = 'issued'
  where id = draft_record.id;

  update public.invoice_number_policies
  set
    next_number = policy_record.next_number + 1,
    updated_by = actor_id,
    updated_at = statement_timestamp()
  where organization_id = target_organization_id;

  update public.approval_requests approval
  set
    status = 'expired',
    resolved_at = statement_timestamp()
  where approval.organization_id = target_organization_id
    and approval.action = 'invoice.issue'
    and approval.entity_id = draft_record.id
    and approval.status = 'pending';

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
    'invoice_issuance',
    created_issuance.id,
    jsonb_build_object(
      'event', 'finance.invoice_issued',
      'invoice_draft_id', draft_record.id,
      'approval_request_id', approval_record.id,
      'invoice_number', created_issuance.invoice_number,
      'draft_revision', draft_record.revision,
      'source_content_sha256', draft_record.content_sha256,
      'issuance_sha256', created_issuance.issuance_sha256,
      'linked_receivable_count', linked_count,
      'currency', created_issuance.currency,
      'invoice_number_allocated', true,
      'invoice_issued', true,
      'invoice_rendered', false,
      'invoice_delivered', false,
      'payment_link_created', false,
      'payment_collected', false,
      'external_action_performed', false
    )
  );

  return query select
    created_issuance.id,
    created_issuance.invoice_number,
    created_issuance.issued_at,
    created_issuance.currency::text,
    created_issuance.total_amount,
    linked_count,
    created_issuance.issuance_sha256,
    false;
end;
$$;

revoke all on function public.issue_approved_invoice(
  uuid,
  uuid,
  uuid
) from public, anon;
grant execute on function public.issue_approved_invoice(
  uuid,
  uuid,
  uuid
) to authenticated;
