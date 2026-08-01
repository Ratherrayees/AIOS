-- Approval-gated public quote proposals. Raw bearer tokens are generated in
-- the server action and never stored. Publishing freezes only customer-safe
-- fields from the exact human-approved quote version; costs, margins,
-- suppliers, catalog provenance, user identifiers, and internal IDs are not
-- present in the public snapshot.

alter table public.quote_versions
  add constraint quote_versions_organization_quote_id_id_key
    unique (organization_id, quote_id, id);

create table public.quote_share_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  quote_id uuid not null,
  quote_version_id uuid not null,
  approval_request_id uuid not null,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  snapshot jsonb not null
    check (
      jsonb_typeof(snapshot) = 'object'
      and octet_length(snapshot::text) <= 2097152
    ),
  published_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  revoked_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_note text
    check (
      revocation_note is null
      or char_length(revocation_note) between 10 and 500
    ),
  expired_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint quote_share_links_organization_id_id_key
    unique (organization_id, id),
  constraint quote_share_links_quote_version_same_organization_fkey
    foreign key (organization_id, quote_id, quote_version_id)
    references public.quote_versions (organization_id, quote_id, id)
    on delete restrict,
  constraint quote_share_links_approval_same_organization_fkey
    foreign key (organization_id, approval_request_id)
    references public.approval_requests (organization_id, id)
    on delete restrict,
  constraint quote_share_links_one_link_per_approval_key
    unique (approval_request_id),
  constraint quote_share_links_expiry_order_check
    check (expires_at > published_at),
  constraint quote_share_links_lifecycle_check
    check (
      (
        status = 'active'
        and revoked_at is null
        and revocation_note is null
        and expired_at is null
      )
      or (
        status = 'revoked'
        and revoked_at is not null
        and revocation_note is not null
        and expired_at is null
      )
      or (
        status = 'expired'
        and revoked_at is null
        and revocation_note is null
        and expired_at is not null
      )
    )
);

create index quote_share_links_quote_status_idx
  on public.quote_share_links (
    organization_id,
    quote_id,
    status,
    expires_at desc
  );
create index quote_share_links_published_by_idx
  on public.quote_share_links (published_by)
  where published_by is not null;
create index quote_share_links_approved_by_idx
  on public.quote_share_links (approved_by)
  where approved_by is not null;
create index quote_share_links_revoked_by_idx
  on public.quote_share_links (revoked_by)
  where revoked_by is not null;

create trigger quote_share_links_set_updated_at
  before update on public.quote_share_links
  for each row execute function public.set_updated_at();
create trigger quote_share_links_prevent_organization_move
  before update on public.quote_share_links
  for each row execute function private.prevent_organization_id_change();

alter table public.quote_share_links enable row level security;

-- The base table deliberately has no authenticated policy or grant. This
-- prevents browser clients from selecting token hashes or frozen snapshots.
revoke all on table public.quote_share_links
  from public, anon, authenticated;
grant select, insert, update, delete on table public.quote_share_links
  to service_role;

create or replace function public.publish_quote_share(
  target_organization_id uuid,
  target_quote_id uuid,
  target_approval_id uuid,
  target_token_hash text,
  target_expires_at timestamptz
)
returns table (
  share_link_id uuid,
  share_status text,
  quote_version integer,
  published_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  now_at timestamptz := statement_timestamp();
  quote_record record;
  approval_record public.approval_requests%rowtype;
  created_link public.quote_share_links%rowtype;
  public_snapshot jsonb;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to publish quote proposals.'
      using errcode = '42501';
  end if;

  if target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The proposal credential is invalid.'
      using errcode = '22023';
  end if;
  if target_expires_at <= now_at + interval '15 minutes'
    or target_expires_at > now_at + interval '30 days'
  then
    raise exception 'Proposal links must expire between 15 minutes and 30 days.'
      using errcode = '22023';
  end if;

  select
    quote.id,
    quote.deal_id,
    quote.title,
    quote.status,
    quote.current_version,
    quote.currency,
    quote.valid_until,
    version.id as version_id,
    version.total_amount,
    version.terms_snapshot,
    organization.name as organization_name,
    deal.destination,
    case
      when contact.id is null then 'Traveler'
      else concat_ws(' ', contact.first_name, contact.last_name)
    end as traveler_name
  into quote_record
  from public.quotes quote
  join public.quote_versions version
    on version.organization_id = quote.organization_id
    and version.quote_id = quote.id
    and version.version = quote.current_version
  join public.organizations organization
    on organization.id = quote.organization_id
  join public.deals deal
    on deal.organization_id = quote.organization_id
    and deal.id = quote.deal_id
  left join public.contacts contact
    on contact.organization_id = deal.organization_id
    and contact.id = deal.contact_id
  where quote.organization_id = target_organization_id
    and quote.id = target_quote_id
  for update of quote;
  if not found then
    raise exception 'This quote is not available in this workspace.'
      using errcode = 'P0002';
  end if;
  if quote_record.status <> 'draft' then
    raise exception 'Only an internal draft can be published.'
      using errcode = '22023';
  end if;
  if quote_record.total_amount <= 0
    or not private.quote_proposal_content_is_ready(
      quote_record.terms_snapshot
    )
  then
    raise exception 'The current customer proposal is not ready to publish.'
      using errcode = '22023';
  end if;

  select approval.*
  into approval_record
  from public.approval_requests approval
  where approval.organization_id = target_organization_id
    and approval.id = target_approval_id
    and approval.action = 'quote.share'
    and approval.entity_type = 'quote'
    and approval.entity_id = target_quote_id
  for update;
  if not found then
    raise exception 'The matching quote-share approval is not available.'
      using errcode = 'P0002';
  end if;
  if approval_record.status <> 'approved'
    or approval_record.resolved_at is null
    or approval_record.approver_id is null
    or (
      approval_record.expires_at is not null
      and approval_record.expires_at <= now_at
    )
  then
    raise exception 'A current resolved human approval is required before publishing.'
      using errcode = '42501';
  end if;
  if not (
    approval_record.payload @> jsonb_build_object(
      'quote_id', target_quote_id,
      'quote_version', quote_record.current_version,
      'external_share_performed', false
    )
  ) then
    raise exception 'The approval does not match the exact current quote version.'
      using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.quote_share_links link
    where link.approval_request_id = target_approval_id
  ) then
    raise exception 'This approval has already been consumed by a proposal link.'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from public.quote_share_links link
    where link.organization_id = target_organization_id
      and link.quote_id = target_quote_id
      and link.status = 'active'
      and link.expires_at > now_at
  ) then
    raise exception 'This quote already has an active public proposal.'
      using errcode = 'P0001';
  end if;

  update public.quote_share_links as stale_link
  set
    status = 'expired',
    expired_at = now_at
  where stale_link.organization_id = target_organization_id
    and stale_link.quote_id = target_quote_id
    and stale_link.status = 'active'
    and stale_link.expires_at <= now_at;

  select jsonb_build_object(
    'schema_version', 1,
    'published_at', now_at,
    'expires_at', target_expires_at,
    'organization', jsonb_build_object(
      'name', quote_record.organization_name
    ),
    'customer', jsonb_build_object(
      'name', quote_record.traveler_name,
      'destination', quote_record.destination
    ),
    'quote', jsonb_build_object(
      'title', quote_record.title,
      'version', quote_record.current_version,
      'currency', quote_record.currency,
      'valid_until', quote_record.valid_until,
      'total_amount', quote_record.total_amount,
      'line_items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'position', line.position,
              'category', line.category,
              'description', line.description,
              'quantity', line.quantity,
              'discount_amount', line.discount_amount,
              'tax_percent', line.tax_percent,
              'tax_amount', line.tax_amount,
              'total_amount', line.total_amount
            )
            order by line.position
          )
          from public.quote_line_items line
          where line.organization_id = target_organization_id
            and line.quote_version_id = quote_record.version_id
        ),
        '[]'::jsonb
      ),
      'content', quote_record.terms_snapshot
    )
  ) into public_snapshot;

  insert into public.quote_share_links (
    organization_id,
    quote_id,
    quote_version_id,
    approval_request_id,
    token_hash,
    snapshot,
    published_by,
    approved_by,
    published_at,
    expires_at
  ) values (
    target_organization_id,
    target_quote_id,
    quote_record.version_id,
    target_approval_id,
    target_token_hash,
    public_snapshot,
    actor_id,
    approval_record.approver_id,
    now_at,
    target_expires_at
  ) returning * into created_link;

  update public.quotes
  set status = 'shared'
  where organization_id = target_organization_id
    and id = target_quote_id;

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
    'quote_share_link',
    created_link.id,
    jsonb_build_object(
      'event', 'quote.proposal_published',
      'quote_id', target_quote_id,
      'quote_version', quote_record.current_version,
      'approval_id', target_approval_id,
      'expires_at', target_expires_at,
      'external_delivery_performed', false
    )
  );

  return query select
    created_link.id,
    created_link.status,
    quote_record.current_version,
    created_link.published_at,
    created_link.expires_at;
end;
$$;

revoke all on function public.publish_quote_share(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon;
grant execute on function public.publish_quote_share(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) to authenticated;

create or replace function public.revoke_quote_share(
  target_organization_id uuid,
  target_share_link_id uuid,
  target_note text
)
returns table (
  share_link_id uuid,
  share_status text,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_note text := nullif(btrim(target_note), '');
  current_link public.quote_share_links%rowtype;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to revoke quote proposals.'
      using errcode = '42501';
  end if;
  if normalized_note is null
    or char_length(normalized_note) not between 10 and 500
  then
    raise exception 'Add a revocation reason between 10 and 500 characters.'
      using errcode = '22023';
  end if;

  select link.*
  into current_link
  from public.quote_share_links link
  where link.organization_id = target_organization_id
    and link.id = target_share_link_id
  for update;
  if not found then
    raise exception 'This public proposal is not available.'
      using errcode = 'P0002';
  end if;
  if current_link.status <> 'active' then
    raise exception 'This public proposal is already closed.'
      using errcode = 'P0001';
  end if;

  update public.quote_share_links
  set
    status = 'revoked',
    revoked_by = actor_id,
    revoked_at = statement_timestamp(),
    revocation_note = normalized_note
  where id = current_link.id
  returning * into current_link;

  update public.quotes quote
  set status = 'draft'
  where quote.organization_id = target_organization_id
    and quote.id = current_link.quote_id
    and quote.status = 'shared'
    and not exists (
      select 1
      from public.quote_share_links other_link
      where other_link.organization_id = target_organization_id
        and other_link.quote_id = current_link.quote_id
        and other_link.id <> current_link.id
        and other_link.status = 'active'
        and other_link.expires_at > statement_timestamp()
    );

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
    'quote_share_link',
    current_link.id,
    jsonb_build_object(
      'event', 'quote.proposal_revoked',
      'quote_id', current_link.quote_id,
      'reason', normalized_note
    )
  );

  return query select
    current_link.id,
    current_link.status,
    current_link.revoked_at;
end;
$$;

revoke all on function public.revoke_quote_share(uuid, uuid, text)
  from public, anon;
grant execute on function public.revoke_quote_share(uuid, uuid, text)
  to authenticated;

-- Returns metadata only. Authenticated clients never receive token hashes or
-- snapshots, even when they are allowed to manage the proposal lifecycle.
create or replace function public.list_quote_share_links(
  target_organization_id uuid
)
returns table (
  id uuid,
  quote_id uuid,
  quote_version_id uuid,
  approval_request_id uuid,
  status text,
  effective_status text,
  published_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'trip_designer']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to view public proposal links.'
      using errcode = '42501';
  end if;

  return query
  select
    link.id,
    link.quote_id,
    link.quote_version_id,
    link.approval_request_id,
    link.status,
    case
      when link.status = 'active'
        and link.expires_at <= statement_timestamp()
      then 'expired'
      else link.status
    end,
    link.published_at,
    link.expires_at,
    link.revoked_at
  from public.quote_share_links link
  where link.organization_id = target_organization_id
  order by link.published_at desc;
end;
$$;

revoke all on function public.list_quote_share_links(uuid)
  from public, anon;
grant execute on function public.list_quote_share_links(uuid)
  to authenticated;

-- Service-only lookup for the public route. Unknown, revoked, and expired
-- credentials all fail identically without revealing link existence.
create or replace function public.get_quote_share_snapshot(
  target_token_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select link.snapshot
  from public.quote_share_links link
  where link.token_hash = target_token_hash
    and link.status = 'active'
    and link.expires_at > statement_timestamp()
  limit 1;
$$;

revoke all on function public.get_quote_share_snapshot(text)
  from public, anon, authenticated;
grant execute on function public.get_quote_share_snapshot(text)
  to service_role;
