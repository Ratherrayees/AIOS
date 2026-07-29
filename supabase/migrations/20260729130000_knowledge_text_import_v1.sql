-- Phase 17: bounded private text/Markdown import with immutable provenance.
--
-- Files are parsed into bounded passages by the authenticated server action.
-- This database function revalidates every passage and creates one Draft plus
-- its sections atomically. Imported material never enters retrieval until the
-- normal human review and approval lifecycle completes.

alter table public.knowledge_sources
  add column ingestion_method text not null default 'manual'
    check (ingestion_method in ('manual', 'text_file')),
  add column ingested_file_name text
    check (
      ingested_file_name is null
      or (
        char_length(trim(ingested_file_name)) between 1 and 180
        and ingested_file_name !~ '[\/\\[:cntrl:]]'
      )
    ),
  add column ingested_file_sha256 text
    check (
      ingested_file_sha256 is null
      or ingested_file_sha256 ~ '^[a-f0-9]{64}$'
    ),
  add column ingested_byte_size integer
    check (
      ingested_byte_size is null
      or ingested_byte_size between 1 and 262144
    ),
  add constraint knowledge_sources_ingestion_provenance_check
    check (
      (
        ingestion_method = 'manual'
        and ingested_file_name is null
        and ingested_file_sha256 is null
        and ingested_byte_size is null
      )
      or
      (
        ingestion_method = 'text_file'
        and ingested_file_name is not null
        and ingested_file_sha256 is not null
        and ingested_byte_size is not null
      )
    );

create unique index knowledge_sources_active_file_hash_key
  on public.knowledge_sources (
    organization_id,
    ingested_file_sha256
  )
  where ingestion_method = 'text_file'
    and status <> 'retired';

create or replace function public.import_knowledge_text_source(
  target_organization_id uuid,
  target_title text,
  target_source_kind public.knowledge_source_kind,
  target_authority public.knowledge_authority,
  target_sensitivity public.document_sensitivity,
  target_version_label text,
  target_file_name text,
  target_file_sha256 text,
  target_byte_size integer,
  target_sections jsonb,
  target_source_url text default null,
  target_summary text default null,
  target_valid_from date default null,
  target_review_due_on date default null
)
returns setof public.knowledge_sources
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  imported_source public.knowledge_sources%rowtype;
  normalized_title text := trim(target_title);
  normalized_version text := trim(target_version_label);
  normalized_file_name text := trim(target_file_name);
  normalized_url text := nullif(trim(target_source_url), '');
  normalized_summary text := nullif(trim(target_summary), '');
  section_count integer;
  changed_at timestamptz := statement_timestamp();
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
    raise exception 'You do not have permission to import knowledge.'
      using errcode = '42501';
  end if;

  if char_length(normalized_title) not between 2 and 180
    or char_length(normalized_version) not between 1 and 80
    or char_length(normalized_file_name) not between 1 and 180
    or normalized_file_name ~ '[\/\\[:cntrl:]]'
    or normalized_file_name !~* '\.(txt|md|markdown)$'
    or target_file_sha256 !~ '^[a-f0-9]{64}$'
    or target_byte_size not between 1 and 262144
    or (
      normalized_url is not null
      and (
        char_length(normalized_url) > 1000
        or normalized_url !~ '^https://'
      )
    )
    or (
      normalized_summary is not null
      and char_length(normalized_summary) > 2000
    )
    or (
      target_valid_from is not null
      and target_review_due_on is not null
      and target_review_due_on < target_valid_from
    )
  then
    raise exception 'The imported source metadata is invalid.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(target_sections) <> 'array'
    or jsonb_array_length(target_sections) not between 1 and 80
  then
    raise exception 'The import needs between 1 and 80 reviewable passages.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_sections) as section
    where jsonb_typeof(section) <> 'object'
      or char_length(trim(section ->> 'heading')) not between 2 and 180
      or char_length(trim(section ->> 'content')) not between 2 and 1800
      or char_length(trim(section ->> 'citation_label')) not between 2 and 300
      or coalesce(section ->> 'position', '') !~ '^[0-9]{1,5}$'
      or (section ->> 'position')::integer not between 0 and 10000
  )
  then
    raise exception 'An imported passage is outside the review boundary.'
      using errcode = '22023';
  end if;

  select count(*)
  into section_count
  from jsonb_array_elements(target_sections);

  if (
    select count(distinct (section ->> 'position')::integer)
    from jsonb_array_elements(target_sections) as section
  ) <> section_count
    or (
      select sum(octet_length(section ->> 'content'))
      from jsonb_array_elements(target_sections) as section
    ) > 262144
  then
    raise exception 'Imported passage positions or total size are invalid.'
      using errcode = '22023';
  end if;

  insert into public.knowledge_sources (
    organization_id,
    title,
    source_kind,
    authority,
    sensitivity,
    version_label,
    source_url,
    summary,
    valid_from,
    review_due_on,
    created_by,
    ingestion_method,
    ingested_file_name,
    ingested_file_sha256,
    ingested_byte_size,
    created_at,
    updated_at
  )
  values (
    target_organization_id,
    normalized_title,
    target_source_kind,
    target_authority,
    target_sensitivity,
    normalized_version,
    normalized_url,
    normalized_summary,
    target_valid_from,
    target_review_due_on,
    actor_id,
    'text_file',
    normalized_file_name,
    target_file_sha256,
    target_byte_size,
    changed_at,
    changed_at
  )
  returning * into imported_source;

  insert into public.knowledge_sections (
    organization_id,
    source_id,
    heading,
    content,
    citation_label,
    position,
    created_by,
    created_at,
    updated_at
  )
  select
    target_organization_id,
    imported_source.id,
    trim(section ->> 'heading'),
    trim(section ->> 'content'),
    trim(section ->> 'citation_label'),
    (section ->> 'position')::integer,
    actor_id,
    changed_at,
    changed_at
  from jsonb_array_elements(target_sections) as section
  order by (section ->> 'position')::integer;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_organization_id,
    actor_id,
    'knowledge.source.text_imported',
    'knowledge_source',
    imported_source.id,
    jsonb_build_object(
      'file_name', normalized_file_name,
      'file_sha256', target_file_sha256,
      'byte_size', target_byte_size,
      'section_count', section_count
    ),
    changed_at
  );

  return next imported_source;
end;
$$;

revoke all on function public.import_knowledge_text_source(
  uuid,
  text,
  public.knowledge_source_kind,
  public.knowledge_authority,
  public.document_sensitivity,
  text,
  text,
  text,
  integer,
  jsonb,
  text,
  text,
  date,
  date
) from public, anon;
grant execute on function public.import_knowledge_text_source(
  uuid,
  text,
  public.knowledge_source_kind,
  public.knowledge_authority,
  public.document_sensitivity,
  text,
  text,
  text,
  integer,
  jsonb,
  text,
  text,
  date,
  date
) to authenticated, service_role;
