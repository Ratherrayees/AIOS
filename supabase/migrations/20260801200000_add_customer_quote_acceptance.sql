-- Customer acceptance is explicit intent evidence for one approved public
-- proposal. It does not book inventory, issue an invoice, create a receivable,
-- collect money, send a message, or move the opportunity to Won.

alter table public.quote_share_links
  add constraint quote_share_links_exact_identity_key
  unique (organization_id, quote_id, quote_version_id, id);

create table public.quote_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  quote_id uuid not null,
  quote_version_id uuid not null,
  quote_share_link_id uuid not null,
  signatory_name text not null
    check (
      signatory_name = btrim(signatory_name)
      and char_length(signatory_name) between 2 and 160
    ),
  statement_version smallint not null default 1
    check (statement_version = 1),
  snapshot_sha256 text not null
    check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default statement_timestamp(),
  constraint quote_acceptances_organization_id_id_key
    unique (organization_id, id),
  constraint quote_acceptances_one_per_quote_key unique (quote_id),
  constraint quote_acceptances_one_per_link_key unique (quote_share_link_id),
  constraint quote_acceptances_version_same_organization_fkey
    foreign key (organization_id, quote_id, quote_version_id)
    references public.quote_versions (organization_id, quote_id, id)
    on delete restrict,
  constraint quote_acceptances_share_exact_version_fkey
    foreign key (
      organization_id,
      quote_id,
      quote_version_id,
      quote_share_link_id
    )
    references public.quote_share_links (
      organization_id,
      quote_id,
      quote_version_id,
      id
    )
    on delete restrict
);

create index quote_acceptances_org_version_idx
  on public.quote_acceptances (organization_id, quote_version_id);
create index quote_acceptances_org_accepted_idx
  on public.quote_acceptances (organization_id, accepted_at desc);

alter table public.quote_acceptances enable row level security;

create policy quote_acceptances_member_select
  on public.quote_acceptances
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

revoke all on table public.quote_acceptances
  from public, anon, authenticated;
grant select on table public.quote_acceptances to authenticated;
grant select, insert on table public.quote_acceptances to service_role;

create or replace function public.accept_quote_share(
  target_token_hash text,
  target_signatory_name text,
  target_statement_version smallint
)
returns table (
  acceptance_id uuid,
  quote_id uuid,
  accepted_at timestamptz,
  already_accepted boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := nullif(btrim(target_signatory_name), '');
  link_record record;
  acceptance_record public.quote_acceptances%rowtype;
  snapshot_hash text;
begin
  if target_token_hash is null
    or target_token_hash !~ '^[0-9a-f]{64}$'
    or normalized_name is null
    or char_length(normalized_name) not between 2 and 160
    or target_statement_version is distinct from 1
  then
    raise exception 'The acceptance evidence is invalid.'
      using errcode = '22023';
  end if;

  select
    link.id,
    link.organization_id,
    link.quote_id,
    link.quote_version_id,
    link.snapshot,
    quote.status as quote_status,
    quote.current_version,
    version.version as quote_version
  into link_record
  from public.quote_share_links link
  join public.quotes quote
    on quote.organization_id = link.organization_id
    and quote.id = link.quote_id
  join public.quote_versions version
    on version.organization_id = link.organization_id
    and version.quote_id = link.quote_id
    and version.id = link.quote_version_id
  where link.token_hash = target_token_hash
    and link.status = 'active'
    and link.expires_at > statement_timestamp()
  for update of link, quote;

  if not found then
    raise exception 'This proposal is not available.'
      using errcode = 'P0002';
  end if;

  select acceptance.*
  into acceptance_record
  from public.quote_acceptances acceptance
  where acceptance.quote_share_link_id = link_record.id;

  if found then
    return query select
      acceptance_record.id,
      acceptance_record.quote_id,
      acceptance_record.accepted_at,
      true;
    return;
  end if;

  if link_record.quote_status <> 'shared'
    or link_record.current_version <> link_record.quote_version
  then
    raise exception 'This proposal can no longer be accepted.'
      using errcode = '22023';
  end if;

  snapshot_hash := encode(
    extensions.digest(
      convert_to(link_record.snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.quote_acceptances (
    organization_id,
    quote_id,
    quote_version_id,
    quote_share_link_id,
    signatory_name,
    statement_version,
    snapshot_sha256
  ) values (
    link_record.organization_id,
    link_record.quote_id,
    link_record.quote_version_id,
    link_record.id,
    normalized_name,
    target_statement_version,
    snapshot_hash
  )
  returning * into acceptance_record;

  update public.quotes
  set
    status = 'accepted',
    accepted_at = acceptance_record.accepted_at
  where organization_id = link_record.organization_id
    and id = link_record.quote_id;

  insert into public.audit_events (
    organization_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    link_record.organization_id,
    'record.updated',
    'quote',
    link_record.quote_id,
    jsonb_build_object(
      'event', 'quote.customer_accepted',
      'quote_version', link_record.quote_version,
      'share_link_id', link_record.id,
      'acceptance_id', acceptance_record.id,
      'statement_version', target_statement_version,
      'snapshot_sha256', snapshot_hash,
      'opportunity_marked_won', false,
      'booking_created', false,
      'invoice_created', false,
      'receivable_created', false,
      'payment_collected', false,
      'external_delivery_performed', false
    )
  );

  return query select
    acceptance_record.id,
    acceptance_record.quote_id,
    acceptance_record.accepted_at,
    false;
end;
$$;

revoke all on function public.accept_quote_share(text, text, smallint)
  from public, anon, authenticated;
grant execute on function public.accept_quote_share(text, text, smallint)
  to service_role;

-- Return a dynamic acceptance state alongside the immutable customer-safe
-- snapshot. The stored commercial snapshot itself is never rewritten.
create or replace function public.get_quote_share_snapshot(
  target_token_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select link.snapshot || jsonb_build_object(
    'acceptance', case
      when acceptance.id is null then jsonb_build_object(
        'status', 'pending'
      )
      else jsonb_build_object(
        'status', 'accepted',
        'accepted_at', acceptance.accepted_at,
        'statement_version', acceptance.statement_version
      )
    end
  )
  from public.quote_share_links link
  left join public.quote_acceptances acceptance
    on acceptance.organization_id = link.organization_id
    and acceptance.quote_share_link_id = link.id
  where link.token_hash = target_token_hash
    and link.status = 'active'
    and link.expires_at > statement_timestamp()
  limit 1;
$$;

revoke all on function public.get_quote_share_snapshot(text)
  from public, anon, authenticated;
grant execute on function public.get_quote_share_snapshot(text)
  to service_role;
