-- Render immutable invoice issuance evidence into a private PDF artifact.
-- This is an internal document workflow only: it performs no delivery,
-- customer messaging, payment-provider action, charge, or settlement.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'invoice-documents',
  'invoice-documents',
  false,
  2097152,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "finance members may read invoice documents"
  on storage.objects;
create policy "finance members may read invoice documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'invoice-documents'
    and public.meets_mfa_requirement()
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (storage.foldername(name))[3] ~ '^invoice-record-v[0-9]+$'
    and exists (
      select 1
      from public.memberships membership
      where membership.user_id = (select auth.uid())
        and membership.organization_id::text = (storage.foldername(name))[1]
        and membership.status = 'active'
        and membership.role in ('owner', 'admin', 'finance')
    )
  );

create table public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  invoice_issuance_id uuid not null,
  invoice_number text not null
    check (
      invoice_number = upper(btrim(invoice_number))
      and char_length(invoice_number) between 4 and 40
    ),
  renderer_version text not null
    check (renderer_version ~ '^invoice-record-v[0-9]+$'),
  compliance_status text not null default 'jurisdiction_review_required'
    check (compliance_status = 'jurisdiction_review_required'),
  storage_bucket text not null default 'invoice-documents'
    check (storage_bucket = 'invoice-documents'),
  storage_path text not null unique,
  file_name text not null
    check (
      file_name = btrim(file_name)
      and char_length(file_name) between 5 and 128
      and file_name ~ '^[a-z0-9][a-z0-9._-]*[.]pdf$'
    ),
  mime_type text not null default 'application/pdf'
    check (mime_type = 'application/pdf'),
  byte_size integer not null check (byte_size between 512 and 2097152),
  source_issuance_sha256 text not null
    check (source_issuance_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  generated_by uuid not null references public.profiles(id) on delete restrict,
  generated_at timestamptz not null default statement_timestamp(),
  constraint invoice_documents_organization_id_id_key
    unique (organization_id, id),
  constraint invoice_documents_one_renderer_key
    unique (organization_id, invoice_issuance_id, renderer_version),
  constraint invoice_documents_issuance_same_organization_fkey
    foreign key (organization_id, invoice_issuance_id)
    references public.invoice_issuances (organization_id, id)
    on delete cascade
);

create index invoice_documents_org_generated_idx
  on public.invoice_documents (organization_id, generated_at desc);
create index invoice_documents_generated_by_idx
  on public.invoice_documents (generated_by);

create or replace function private.protect_invoice_document_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Invoice document evidence is immutable.'
    using errcode = '42501';
end;
$$;

revoke all on function private.protect_invoice_document_evidence()
  from public, anon, authenticated;

create trigger invoice_documents_protect_evidence
  before update on public.invoice_documents
  for each row execute function private.protect_invoice_document_evidence();

alter table public.invoice_documents enable row level security;

create policy invoice_documents_finance_select
  on public.invoice_documents
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  );

revoke all on table public.invoice_documents
  from public, anon, authenticated;
grant select on table public.invoice_documents to authenticated;
grant select, insert, update, delete on table public.invoice_documents
  to service_role;

create or replace function public.record_invoice_document_render(
  target_organization_id uuid,
  target_invoice_issuance_id uuid,
  target_renderer_version text,
  target_storage_path text,
  target_file_name text,
  target_byte_size integer,
  target_source_issuance_sha256 text,
  target_content_sha256 text,
  target_generated_by uuid
)
returns table (
  invoice_document_id uuid,
  invoice_number text,
  renderer_version text,
  compliance_status text,
  file_name text,
  byte_size integer,
  content_sha256 text,
  generated_at timestamptz,
  already_rendered boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  issuance_record public.invoice_issuances%rowtype;
  existing_document public.invoice_documents%rowtype;
  created_document public.invoice_documents%rowtype;
  expected_path text;
  normalized_renderer text := lower(btrim(target_renderer_version));
  normalized_file_name text := lower(btrim(target_file_name));
  normalized_source_hash text := lower(btrim(target_source_issuance_sha256));
  normalized_content_hash text := lower(btrim(target_content_sha256));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the trusted renderer may record invoice documents.'
      using errcode = '42501';
  end if;
  if normalized_renderer <> 'invoice-record-v1'
    or normalized_file_name !~ '^[a-z0-9][a-z0-9._-]*[.]pdf$'
    or char_length(normalized_file_name) not between 5 and 128
    or target_byte_size not between 512 and 2097152
    or normalized_source_hash !~ '^[0-9a-f]{64}$'
    or normalized_content_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invoice document render evidence is invalid.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_generated_by
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'finance')
  ) then
    raise exception 'The renderer actor lacks current finance authority.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' ||
      target_invoice_issuance_id::text || ':' || normalized_renderer,
      0
    )
  );

  select issuance.*
  into issuance_record
  from public.invoice_issuances issuance
  where issuance.organization_id = target_organization_id
    and issuance.id = target_invoice_issuance_id;
  if not found
    or issuance_record.issuance_sha256 <> normalized_source_hash
  then
    raise exception 'Exact invoice issuance evidence is required.'
      using errcode = '22023';
  end if;

  expected_path :=
    target_organization_id::text || '/' ||
    target_invoice_issuance_id::text || '/' ||
    normalized_renderer || '/' ||
    normalized_content_hash || '.pdf';
  if target_storage_path <> expected_path then
    raise exception 'The invoice document storage path is invalid.'
      using errcode = '22023';
  end if;

  select document.*
  into existing_document
  from public.invoice_documents document
  where document.organization_id = target_organization_id
    and document.invoice_issuance_id = target_invoice_issuance_id
    and document.renderer_version = normalized_renderer;
  if found then
    if existing_document.source_issuance_sha256 <> normalized_source_hash
      or existing_document.content_sha256 <> normalized_content_hash
      or existing_document.storage_path <> expected_path
      or existing_document.file_name <> normalized_file_name
      or existing_document.byte_size <> target_byte_size
    then
      raise exception 'This renderer version already has different evidence.'
        using errcode = '23505';
    end if;
    return query select
      existing_document.id,
      existing_document.invoice_number,
      existing_document.renderer_version,
      existing_document.compliance_status,
      existing_document.file_name,
      existing_document.byte_size,
      existing_document.content_sha256,
      existing_document.generated_at,
      true;
    return;
  end if;

  insert into public.invoice_documents (
    organization_id,
    invoice_issuance_id,
    invoice_number,
    renderer_version,
    storage_path,
    file_name,
    byte_size,
    source_issuance_sha256,
    content_sha256,
    generated_by
  ) values (
    target_organization_id,
    target_invoice_issuance_id,
    issuance_record.invoice_number,
    normalized_renderer,
    expected_path,
    normalized_file_name,
    target_byte_size,
    normalized_source_hash,
    normalized_content_hash,
    target_generated_by
  )
  returning * into created_document;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_organization_id,
    target_generated_by,
    'record.created',
    'invoice_document',
    created_document.id,
    jsonb_build_object(
      'event', 'finance.invoice_document_rendered',
      'invoice_issuance_id', target_invoice_issuance_id,
      'renderer_version', normalized_renderer,
      'source_issuance_sha256', normalized_source_hash,
      'content_sha256', normalized_content_hash,
      'byte_size', target_byte_size,
      'compliance_status', created_document.compliance_status,
      'invoice_rendered', true,
      'invoice_delivered', false,
      'message_sent', false,
      'payment_link_created', false,
      'payment_collected', false,
      'external_action_performed', false
    )
  );

  return query select
    created_document.id,
    created_document.invoice_number,
    created_document.renderer_version,
    created_document.compliance_status,
    created_document.file_name,
    created_document.byte_size,
    created_document.content_sha256,
    created_document.generated_at,
    false;
end;
$$;

revoke all on function public.record_invoice_document_render(
  uuid,
  uuid,
  text,
  text,
  text,
  integer,
  text,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.record_invoice_document_render(
  uuid,
  uuid,
  text,
  text,
  text,
  integer,
  text,
  text,
  uuid
) to service_role;
