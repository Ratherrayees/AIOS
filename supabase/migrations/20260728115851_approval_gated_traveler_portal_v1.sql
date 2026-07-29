-- Phase 14 v1: approval-gated, expiring traveler portals.
-- Raw portal tokens are never stored. Publishing freezes a deliberately
-- narrow customer-safe snapshot and never exposes internal notes, supplier
-- terms, costs, margins, payables, or storage paths.

alter table public.documents
  add column document_kind text not null default 'other'
    check (
      document_kind in (
        'voucher',
        'ticket',
        'insurance',
        'visa',
        'identity',
        'other'
      )
    ),
  add constraint documents_organization_id_id_key
    unique (organization_id, id);

create table public.trip_portal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  trip_id uuid not null,
  approval_request_id uuid not null,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  snapshot jsonb not null
    check (jsonb_typeof(snapshot) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  revoked_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_note text
    check (
      revocation_note is null
      or char_length(revocation_note) between 5 and 500
    ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint trip_portal_links_organization_id_id_key
    unique (organization_id, id),
  constraint trip_portal_links_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade,
  constraint trip_portal_links_approval_same_organization_fkey
    foreign key (organization_id, approval_request_id)
    references public.approval_requests (organization_id, id)
    on delete cascade,
  constraint trip_portal_links_one_link_per_approval_key
    unique (approval_request_id),
  constraint trip_portal_links_expiry_order_check
    check (expires_at > created_at),
  constraint trip_portal_links_revocation_evidence_check
    check (
      (status = 'active' and revoked_at is null and revocation_note is null)
      or
      (status = 'revoked' and revoked_at is not null and revocation_note is not null)
    )
);

create index trip_portal_links_trip_status_idx
  on public.trip_portal_links (
    organization_id,
    trip_id,
    status,
    expires_at desc
  );
create index trip_portal_links_created_by_idx
  on public.trip_portal_links (created_by)
  where created_by is not null;
create index trip_portal_links_approved_by_idx
  on public.trip_portal_links (approved_by)
  where approved_by is not null;
create index trip_portal_links_revoked_by_idx
  on public.trip_portal_links (revoked_by)
  where revoked_by is not null;

create table public.trip_portal_documents (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  portal_link_id uuid not null,
  document_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (portal_link_id, document_id),
  constraint trip_portal_documents_organization_id_link_id_key
    unique (organization_id, portal_link_id, document_id),
  constraint trip_portal_documents_link_same_organization_fkey
    foreign key (organization_id, portal_link_id)
    references public.trip_portal_links (organization_id, id)
    on delete cascade,
  constraint trip_portal_documents_document_same_organization_fkey
    foreign key (organization_id, document_id)
    references public.documents (organization_id, id)
    on delete cascade
);

create index trip_portal_documents_document_idx
  on public.trip_portal_documents (organization_id, document_id);

create trigger trip_portal_links_set_updated_at
  before update on public.trip_portal_links
  for each row execute function public.set_updated_at();
create trigger trip_portal_links_prevent_organization_move
  before update on public.trip_portal_links
  for each row execute function private.prevent_organization_id_change();
create trigger trip_portal_documents_prevent_organization_move
  before update on public.trip_portal_documents
  for each row execute function private.prevent_organization_id_change();

alter table public.trip_portal_links enable row level security;
alter table public.trip_portal_documents enable row level security;

create policy "members may read traveler portal links"
  on public.trip_portal_links
  for select to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

create policy "members may read traveler portal document mappings"
  on public.trip_portal_documents
  for select to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
  );

revoke all on table public.trip_portal_links from public, anon, authenticated;
revoke all on table public.trip_portal_documents from public, anon, authenticated;
grant select on table
  public.trip_portal_links,
  public.trip_portal_documents
to authenticated;
grant select, insert, update, delete on table
  public.trip_portal_links,
  public.trip_portal_documents
to service_role;

-- Document classification is an audited internal action. Browser clients keep
-- no general document-update privilege.
revoke update on table public.documents from authenticated;

create or replace function public.classify_trip_document(
  target_organization_id uuid,
  target_trip_id uuid,
  target_document_id uuid,
  target_document_kind text
)
returns setof public.documents
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_kind text := lower(btrim(target_document_kind));
  current_document public.documents%rowtype;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations',
        'agent'
      ]::public.app_role[]
    )
  then
    raise exception 'You do not have permission to classify trip documents.'
      using errcode = '42501';
  end if;

  if normalized_kind not in (
    'voucher',
    'ticket',
    'insurance',
    'visa',
    'identity',
    'other'
  )
  then
    raise exception 'Choose a supported trip-document type.'
      using errcode = '22023';
  end if;

  select document.*
  into current_document
  from public.documents document
  where document.organization_id = target_organization_id
    and document.trip_id = target_trip_id
    and document.id = target_document_id
  for update;
  if not found then
    raise exception 'This trip document is not available.'
      using errcode = 'P0002';
  end if;

  update public.documents
  set document_kind = normalized_kind
  where id = current_document.id
  returning * into current_document;

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
    'document',
    current_document.id,
    jsonb_build_object(
      'event',
      'trip.document_classified',
      'trip_id',
      target_trip_id,
      'document_kind',
      normalized_kind
    )
  );

  return next current_document;
end;
$$;

revoke all on function public.classify_trip_document(
  uuid,
  uuid,
  uuid,
  text
) from public, anon;
grant execute on function public.classify_trip_document(
  uuid,
  uuid,
  uuid,
  text
) to authenticated;

create or replace function public.publish_traveler_portal(
  target_organization_id uuid,
  target_trip_id uuid,
  target_approval_id uuid,
  target_token_hash text
)
returns setof public.trip_portal_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  published_at timestamptz := statement_timestamp();
  approval_record public.approval_requests%rowtype;
  existing_link public.trip_portal_links%rowtype;
  created_link public.trip_portal_links%rowtype;
  requested_expires_at timestamptz;
  include_payment_status boolean;
  selected_document_ids jsonb;
  selected_document_count integer;
  valid_document_count integer;
  portal_snapshot jsonb;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations'
      ]::public.app_role[]
    )
  then
    raise exception 'You do not have permission to publish traveler portals.'
      using errcode = '42501';
  end if;

  if target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The portal credential is invalid.'
      using errcode = '22023';
  end if;

  perform 1
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.id = target_trip_id;
  if not found then
    raise exception 'This trip is not available.'
      using errcode = 'P0002';
  end if;

  select approval.*
  into approval_record
  from public.approval_requests approval
  where approval.organization_id = target_organization_id
    and approval.id = target_approval_id
    and approval.action = 'document.share'
    and approval.entity_type = 'trip'
    and approval.entity_id = target_trip_id
  for update;
  if not found then
    raise exception 'The matching traveler-share approval is not available.'
      using errcode = 'P0002';
  end if;
  if approval_record.status <> 'approved'
    or approval_record.resolved_at is null
    or approval_record.approver_id is null
  then
    raise exception 'A resolved human approval is required before publishing.'
      using errcode = '42501';
  end if;

  select link.*
  into existing_link
  from public.trip_portal_links link
  where link.approval_request_id = target_approval_id
  for update;
  if found then
    if existing_link.status = 'revoked'
      or existing_link.expires_at <= published_at
    then
      raise exception 'This approval already produced a closed portal link.'
        using errcode = 'P0001';
    end if;

    update public.trip_portal_links
    set token_hash = target_token_hash
    where id = existing_link.id
    returning * into existing_link;

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
      'trip_portal_link',
      existing_link.id,
      jsonb_build_object(
        'event',
        'trip.portal_token_rotated',
        'trip_id',
        target_trip_id,
        'approval_id',
        target_approval_id
      )
    );

    return next existing_link;
    return;
  end if;

  begin
    requested_expires_at :=
      (approval_record.payload ->> 'portal_expires_at')::timestamptz;
  exception
    when others then
      raise exception 'The approved portal expiry is invalid.'
        using errcode = '22023';
  end;
  if requested_expires_at <= published_at + interval '15 minutes'
    or requested_expires_at > published_at + interval '30 days'
  then
    raise exception 'Traveler portals must expire between 15 minutes and 30 days.'
      using errcode = '22023';
  end if;

  if coalesce(
    approval_record.payload ->> 'include_payment_status',
    ''
  )
    not in ('true', 'false')
  then
    raise exception 'The approved payment-visibility scope is invalid.'
      using errcode = '22023';
  end if;
  include_payment_status :=
    (approval_record.payload ->> 'include_payment_status') = 'true';

  selected_document_ids :=
    coalesce(approval_record.payload -> 'document_ids', '[]'::jsonb);
  if jsonb_typeof(selected_document_ids) <> 'array'
    or jsonb_array_length(selected_document_ids) > 20
  then
    raise exception 'The approved document selection is invalid.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(selected_document_ids) selected(value)
    where selected.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  then
    raise exception 'The approved document selection contains an invalid identifier.'
      using errcode = '22023';
  end if;

  selected_document_count := jsonb_array_length(selected_document_ids);
  select count(distinct document.id)
  into valid_document_count
  from public.documents document
  where document.organization_id = target_organization_id
    and document.trip_id = target_trip_id
    and document.id in (
      select selected.value::uuid
      from jsonb_array_elements_text(selected_document_ids) selected(value)
    )
    and document.sensitivity = 'normal'
    and document.document_kind in (
      'voucher',
      'ticket',
      'insurance',
      'visa',
      'other'
    );
  if valid_document_count <> selected_document_count then
    raise exception 'Every approved file must be a shareable trip document.'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'schema_version',
    1,
    'generated_at',
    published_at,
    'trip',
    jsonb_build_object(
      'name',
      trip.name,
      'destination',
      trip.destination,
      'start_date',
      trip.start_date,
      'end_date',
      trip.end_date,
      'status',
      trip.status
    ),
    'travelers',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'first_name',
            traveler.first_name,
            'last_name',
            traveler.last_name,
            'role',
            traveler.role
          )
          order by traveler.created_at
        )
        from public.travelers traveler
        where traveler.organization_id = target_organization_id
          and traveler.trip_id = target_trip_id
      ),
      '[]'::jsonb
    ),
    'itinerary',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'day_number',
            item.day_number,
            'position',
            item.position,
            'item_type',
            item.item_type,
            'title',
            item.title,
            'starts_at',
            item.starts_at,
            'ends_at',
            item.ends_at
          )
          order by item.day_number, item.position
        )
        from public.itinerary_items item
        where item.organization_id = target_organization_id
          and item.trip_id = target_trip_id
      ),
      '[]'::jsonb
    ),
    'confirmed_services',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'booking_type',
            booking.booking_type,
            'title',
            booking.title,
            'confirmation_reference',
            booking.confirmation_reference,
            'service_start_at',
            booking.service_start_at,
            'service_end_at',
            booking.service_end_at
          )
          order by booking.service_start_at nulls last, booking.created_at
        )
        from public.bookings booking
        where booking.organization_id = target_organization_id
          and booking.trip_id = target_trip_id
          and booking.status = 'confirmed'
      ),
      '[]'::jsonb
    ),
    'payment_status_included',
    include_payment_status,
    'receivables',
    case
      when include_payment_status then
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'title',
                payment.title,
                'amount',
                payment.amount,
                'paid_amount',
                payment.paid_amount,
                'outstanding_amount',
                payment.amount - payment.paid_amount,
                'currency',
                payment.currency,
                'due_at',
                payment.due_at,
                'status',
                payment.status
              )
              order by payment.due_at nulls last, payment.created_at
            )
            from public.payments payment
            where payment.organization_id = target_organization_id
              and payment.trip_id = target_trip_id
              and payment.direction = 'receivable'
              and payment.status <> 'void'
          ),
          '[]'::jsonb
        )
      else '[]'::jsonb
    end,
    'documents',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id',
            document.id,
            'file_name',
            document.file_name,
            'mime_type',
            document.mime_type,
            'document_kind',
            document.document_kind,
            'expires_at',
            document.expires_at
          )
          order by document.created_at
        )
        from public.documents document
        where document.organization_id = target_organization_id
          and document.trip_id = target_trip_id
          and document.id in (
            select selected.value::uuid
            from jsonb_array_elements_text(selected_document_ids) selected(value)
          )
      ),
      '[]'::jsonb
    )
  )
  into portal_snapshot
  from public.trips trip
  where trip.organization_id = target_organization_id
    and trip.id = target_trip_id;

  insert into public.trip_portal_links (
    organization_id,
    trip_id,
    approval_request_id,
    token_hash,
    snapshot,
    created_by,
    approved_by,
    expires_at
  )
  values (
    target_organization_id,
    target_trip_id,
    target_approval_id,
    target_token_hash,
    portal_snapshot,
    actor_id,
    approval_record.approver_id,
    requested_expires_at
  )
  returning * into created_link;

  insert into public.trip_portal_documents (
    organization_id,
    portal_link_id,
    document_id
  )
  select
    target_organization_id,
    created_link.id,
    document.id
  from public.documents document
  where document.organization_id = target_organization_id
    and document.trip_id = target_trip_id
    and document.id in (
      select selected.value::uuid
      from jsonb_array_elements_text(selected_document_ids) selected(value)
    );

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
    'trip_portal_link',
    created_link.id,
    jsonb_build_object(
      'event',
      'trip.portal_published',
      'trip_id',
      target_trip_id,
      'approval_id',
      target_approval_id,
      'expires_at',
      requested_expires_at,
      'document_count',
      selected_document_count,
      'payment_status_included',
      include_payment_status
    )
  );

  return next created_link;
end;
$$;

revoke all on function public.publish_traveler_portal(
  uuid,
  uuid,
  uuid,
  text
) from public, anon;
grant execute on function public.publish_traveler_portal(
  uuid,
  uuid,
  uuid,
  text
) to authenticated;

create or replace function public.revoke_traveler_portal(
  target_organization_id uuid,
  target_portal_link_id uuid,
  target_note text
)
returns setof public.trip_portal_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_note text := nullif(btrim(target_note), '');
  current_link public.trip_portal_links%rowtype;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array[
        'owner',
        'admin',
        'trip_designer',
        'operations'
      ]::public.app_role[]
    )
  then
    raise exception 'You do not have permission to revoke traveler portals.'
      using errcode = '42501';
  end if;
  if normalized_note is null
    or char_length(normalized_note) not between 5 and 500
  then
    raise exception 'Add a short revocation reason.'
      using errcode = '22023';
  end if;

  select link.*
  into current_link
  from public.trip_portal_links link
  where link.organization_id = target_organization_id
    and link.id = target_portal_link_id
  for update;
  if not found then
    raise exception 'This traveler portal is not available.'
      using errcode = 'P0002';
  end if;

  if current_link.status = 'revoked' then
    return next current_link;
    return;
  end if;

  update public.trip_portal_links
  set
    status = 'revoked',
    revoked_by = actor_id,
    revoked_at = statement_timestamp(),
    revocation_note = normalized_note
  where id = current_link.id
  returning * into current_link;

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
    'trip_portal_link',
    current_link.id,
    jsonb_build_object(
      'event',
      'trip.portal_revoked',
      'trip_id',
      current_link.trip_id,
      'reason',
      normalized_note
    )
  );

  return next current_link;
end;
$$;

revoke all on function public.revoke_traveler_portal(
  uuid,
  uuid,
  text
) from public, anon;
grant execute on function public.revoke_traveler_portal(
  uuid,
  uuid,
  text
) to authenticated;

-- These read functions are intentionally service-only. Public route handlers
-- validate the high-entropy raw token, hash it server-side, and return only
-- the frozen safe snapshot or one explicitly approved file.
create or replace function public.get_traveler_portal_snapshot(
  target_token_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    link.snapshot || jsonb_build_object(
      'portal_expires_at',
      link.expires_at
    )
  from public.trip_portal_links link
  where link.token_hash = target_token_hash
    and link.status = 'active'
    and link.expires_at > statement_timestamp()
  limit 1;
$$;

revoke all on function public.get_traveler_portal_snapshot(text)
  from public, anon, authenticated;
grant execute on function public.get_traveler_portal_snapshot(text)
  to service_role;

create or replace function public.get_traveler_portal_document(
  target_token_hash text,
  target_document_id uuid
)
returns table (
  storage_path text,
  file_name text,
  mime_type text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    document.storage_path,
    document.file_name,
    document.mime_type
  from public.trip_portal_links link
  join public.trip_portal_documents mapping
    on mapping.organization_id = link.organization_id
    and mapping.portal_link_id = link.id
  join public.documents document
    on document.organization_id = mapping.organization_id
    and document.id = mapping.document_id
  where link.token_hash = target_token_hash
    and link.status = 'active'
    and link.expires_at > statement_timestamp()
    and document.id = target_document_id
    and document.sensitivity = 'normal'
  limit 1;
$$;

revoke all on function public.get_traveler_portal_document(text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_traveler_portal_document(text, uuid)
  to service_role;
