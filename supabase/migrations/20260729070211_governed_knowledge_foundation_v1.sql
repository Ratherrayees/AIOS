-- Phase 17: governed, tenant-scoped knowledge for cited AIOS retrieval.
--
-- Knowledge is deliberately curated rather than crawled. Draft and restricted
-- material is visible only to workspace curators, approval is a separate
-- privileged transition, and retrieval returns citations plus freshness state.

create type public.knowledge_source_kind as enum (
  'destination_guide',
  'visa_advisory',
  'supplier_terms',
  'sop',
  'policy',
  'product_sheet',
  'other'
);

create type public.knowledge_authority as enum (
  'official',
  'supplier',
  'internal',
  'third_party'
);

create type public.knowledge_source_status as enum (
  'draft',
  'in_review',
  'approved',
  'retired'
);

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  title text not null
    check (char_length(trim(title)) between 2 and 180),
  source_kind public.knowledge_source_kind not null,
  authority public.knowledge_authority not null,
  status public.knowledge_source_status not null default 'draft',
  sensitivity public.document_sensitivity not null default 'normal',
  version_label text not null default '1'
    check (char_length(trim(version_label)) between 1 and 80),
  source_url text
    check (
      source_url is null
      or (
        char_length(source_url) <= 1_000
        and source_url ~ '^https://'
      )
    ),
  summary text
    check (summary is null or char_length(summary) <= 2_000),
  valid_from date,
  review_due_on date,
  created_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint knowledge_sources_organization_id_id_key
    unique (organization_id, id),
  constraint knowledge_sources_creator_same_organization_fkey
    foreign key (organization_id, created_by)
    references public.memberships (organization_id, user_id)
    deferrable initially deferred,
  constraint knowledge_sources_reviewer_same_organization_fkey
    foreign key (organization_id, reviewed_by)
    references public.memberships (organization_id, user_id)
    deferrable initially deferred,
  constraint knowledge_sources_review_state_check
    check (
      (status in ('draft', 'in_review')
        and reviewed_by is null
        and reviewed_at is null
        and retired_at is null)
      or
      (status = 'approved'
        and reviewed_by is not null
        and reviewed_at is not null
        and retired_at is null)
      or
      (status = 'retired'
        and reviewed_by is not null
        and reviewed_at is not null
        and retired_at is not null)
    )
);

create unique index knowledge_sources_title_version_key
  on public.knowledge_sources (
    organization_id,
    lower(trim(title)),
    lower(trim(version_label))
  )
  where status <> 'retired';
create index knowledge_sources_inventory_idx
  on public.knowledge_sources (
    organization_id,
    status,
    review_due_on,
    updated_at desc
  );
create index knowledge_sources_created_by_idx
  on public.knowledge_sources (created_by);
create index knowledge_sources_reviewed_by_idx
  on public.knowledge_sources (reviewed_by)
  where reviewed_by is not null;

create table public.knowledge_sections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_id uuid not null,
  heading text not null
    check (char_length(trim(heading)) between 2 and 180),
  content text not null
    check (char_length(trim(content)) between 2 and 8_000),
  citation_label text not null
    check (char_length(trim(citation_label)) between 2 and 300),
  position integer not null default 0
    check (position between 0 and 10_000),
  created_by uuid not null,
  search_document tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(heading, '') || ' ' ||
      coalesce(content, '') || ' ' ||
      coalesce(citation_label, '')
    )
  ) stored,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint knowledge_sections_organization_id_id_key
    unique (organization_id, id),
  constraint knowledge_sections_source_position_key
    unique (organization_id, source_id, position),
  constraint knowledge_sections_source_same_organization_fkey
    foreign key (organization_id, source_id)
    references public.knowledge_sources (organization_id, id)
    on delete cascade,
  constraint knowledge_sections_creator_same_organization_fkey
    foreign key (organization_id, created_by)
    references public.memberships (organization_id, user_id)
    deferrable initially deferred
);

create index knowledge_sections_source_idx
  on public.knowledge_sections (organization_id, source_id, position);
create index knowledge_sections_search_idx
  on public.knowledge_sections using gin (search_document);
create index knowledge_sections_created_by_idx
  on public.knowledge_sections (created_by);

create trigger knowledge_sources_set_updated_at
  before update on public.knowledge_sources
  for each row execute function public.set_updated_at();
create trigger knowledge_sources_prevent_organization_move
  before update on public.knowledge_sources
  for each row execute function private.prevent_organization_id_change();
create trigger knowledge_sections_set_updated_at
  before update on public.knowledge_sections
  for each row execute function public.set_updated_at();
create trigger knowledge_sections_prevent_organization_move
  before update on public.knowledge_sections
  for each row execute function private.prevent_organization_id_change();

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_sections enable row level security;

create policy knowledge_sources_permission_aware_select
  on public.knowledge_sources
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
    and (
      (
        status = 'approved'
        and sensitivity = 'normal'
      )
      or public.has_organization_role(
        organization_id,
        array[
          'owner',
          'admin',
          'trip_designer',
          'operations'
        ]::public.app_role[]
      )
    )
  );

create policy knowledge_sections_permission_aware_select
  on public.knowledge_sections
  for select
  to authenticated
  using (
    public.meets_mfa_requirement()
    and public.is_active_member(organization_id)
    and exists (
      select 1
      from public.knowledge_sources as source
      where source.organization_id = knowledge_sections.organization_id
        and source.id = knowledge_sections.source_id
        and (
          (
            source.status = 'approved'
            and source.sensitivity = 'normal'
          )
          or public.has_organization_role(
            knowledge_sections.organization_id,
            array[
              'owner',
              'admin',
              'trip_designer',
              'operations'
            ]::public.app_role[]
          )
        )
    )
  );

revoke all on table public.knowledge_sources
  from public, anon, authenticated;
revoke all on table public.knowledge_sections
  from public, anon, authenticated;
grant select on table public.knowledge_sources to authenticated;
grant select on table public.knowledge_sections to authenticated;
grant select, insert, update, delete
  on table public.knowledge_sources to service_role;
grant select, insert, update, delete
  on table public.knowledge_sections to service_role;

create or replace function public.upsert_knowledge_source(
  target_organization_id uuid,
  target_title text,
  target_source_kind public.knowledge_source_kind,
  target_authority public.knowledge_authority,
  target_sensitivity public.document_sensitivity default 'normal',
  target_version_label text default '1',
  target_source_url text default null,
  target_summary text default null,
  target_valid_from date default null,
  target_review_due_on date default null,
  target_source_id uuid default null
)
returns setof public.knowledge_sources
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_title text := trim(target_title);
  normalized_version text := trim(target_version_label);
  normalized_url text := nullif(trim(target_source_url), '');
  normalized_summary text := nullif(trim(target_summary), '');
  current_source public.knowledge_sources%rowtype;
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
    raise exception 'You do not have permission to curate knowledge.'
      using errcode = '42501';
  end if;

  if char_length(normalized_title) not between 2 and 180
    or char_length(normalized_version) not between 1 and 80
  then
    raise exception 'Knowledge title or version is invalid.'
      using errcode = '22023';
  end if;

  if normalized_url is not null
    and (
      char_length(normalized_url) > 1_000
      or normalized_url !~ '^https://'
    )
  then
    raise exception 'Knowledge source links must use HTTPS.'
      using errcode = '22023';
  end if;

  if normalized_summary is not null
    and char_length(normalized_summary) > 2_000
  then
    raise exception 'Knowledge summaries are limited to 2,000 characters.'
      using errcode = '22023';
  end if;

  if target_review_due_on is not null
    and target_valid_from is not null
    and target_review_due_on < target_valid_from
  then
    raise exception 'The review date cannot precede the valid-from date.'
      using errcode = '22023';
  end if;

  if target_source_id is null then
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
      created_by
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
      actor_id
    )
    returning * into current_source;
  else
    select *
    into current_source
    from public.knowledge_sources
    where organization_id = target_organization_id
      and id = target_source_id
    for update;

    if not found then
      raise exception 'Knowledge source was not found.'
        using errcode = 'P0002';
    end if;

    if current_source.status <> 'draft' then
      raise exception 'Return knowledge to draft before editing it.'
        using errcode = '22023';
    end if;

    update public.knowledge_sources
    set title = normalized_title,
        source_kind = target_source_kind,
        authority = target_authority,
        sensitivity = target_sensitivity,
        version_label = normalized_version,
        source_url = normalized_url,
        summary = normalized_summary,
        valid_from = target_valid_from,
        review_due_on = target_review_due_on
    where organization_id = target_organization_id
      and id = target_source_id
    returning * into current_source;
  end if;

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
    case
      when target_source_id is null then 'knowledge.source.created'
      else 'knowledge.source.updated'
    end,
    'knowledge_source',
    current_source.id,
    jsonb_build_object(
      'status', current_source.status,
      'source_kind', current_source.source_kind,
      'authority', current_source.authority,
      'sensitivity', current_source.sensitivity,
      'version_label', current_source.version_label
    ),
    changed_at
  );

  return next current_source;
end;
$$;

create or replace function public.add_knowledge_section(
  target_organization_id uuid,
  target_source_id uuid,
  target_heading text,
  target_content text,
  target_citation_label text,
  target_position integer default 0
)
returns setof public.knowledge_sections
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  source_status public.knowledge_source_status;
  created_section public.knowledge_sections%rowtype;
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
    raise exception 'You do not have permission to curate knowledge.'
      using errcode = '42501';
  end if;

  if char_length(trim(target_heading)) not between 2 and 180
    or char_length(trim(target_content)) not between 2 and 8_000
    or char_length(trim(target_citation_label)) not between 2 and 300
    or target_position not between 0 and 10_000
  then
    raise exception 'Knowledge section content or position is invalid.'
      using errcode = '22023';
  end if;

  select status
  into source_status
  from public.knowledge_sources
  where organization_id = target_organization_id
    and id = target_source_id
  for update;

  if not found then
    raise exception 'Knowledge source was not found.'
      using errcode = 'P0002';
  end if;

  if source_status <> 'draft' then
    raise exception 'Return knowledge to draft before adding sections.'
      using errcode = '22023';
  end if;

  insert into public.knowledge_sections (
    organization_id,
    source_id,
    heading,
    content,
    citation_label,
    position,
    created_by
  )
  values (
    target_organization_id,
    target_source_id,
    trim(target_heading),
    trim(target_content),
    trim(target_citation_label),
    target_position,
    actor_id
  )
  returning * into created_section;

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
    'knowledge.section.created',
    'knowledge_section',
    created_section.id,
    jsonb_build_object(
      'source_id', target_source_id,
      'position', target_position,
      'citation_label', created_section.citation_label
    ),
    changed_at
  );

  return next created_section;
end;
$$;

create or replace function public.transition_knowledge_source(
  target_organization_id uuid,
  target_source_id uuid,
  target_status public.knowledge_source_status
)
returns setof public.knowledge_sources
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_source public.knowledge_sources%rowtype;
  prior_status public.knowledge_source_status;
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
    raise exception 'You do not have permission to review knowledge.'
      using errcode = '42501';
  end if;

  select *
  into current_source
  from public.knowledge_sources
  where organization_id = target_organization_id
    and id = target_source_id
  for update;

  if not found then
    raise exception 'Knowledge source was not found.'
      using errcode = 'P0002';
  end if;

  if not (
    (current_source.status = 'draft' and target_status = 'in_review')
    or
    (current_source.status = 'in_review' and target_status = 'draft')
    or
    (current_source.status = 'in_review' and target_status = 'approved')
    or
    (current_source.status = 'approved' and target_status = 'retired')
  ) then
    raise exception 'That knowledge lifecycle transition is not allowed.'
      using errcode = '22023';
  end if;

  prior_status := current_source.status;

  if target_status = 'approved'
    and not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operations']::public.app_role[]
    )
  then
    raise exception 'Only owners, administrators, or operations may approve knowledge.'
      using errcode = '42501';
  end if;

  if target_status = 'approved' then
    select count(*)
    into section_count
    from public.knowledge_sections
    where organization_id = target_organization_id
      and source_id = target_source_id;

    if section_count < 1 then
      raise exception 'Add at least one cited section before approval.'
        using errcode = '22023';
    end if;

    if current_source.review_due_on is null
      or current_source.review_due_on < current_date
    then
      raise exception 'Approved knowledge needs a current review-due date.'
        using errcode = '22023';
    end if;
  end if;

  update public.knowledge_sources
  set status = target_status,
      reviewed_by = case
        when target_status = 'approved' then actor_id
        when target_status = 'draft' then null
        else reviewed_by
      end,
      reviewed_at = case
        when target_status = 'approved' then changed_at
        when target_status = 'draft' then null
        else reviewed_at
      end,
      retired_at = case
        when target_status = 'retired' then changed_at
        else null
      end
  where organization_id = target_organization_id
    and id = target_source_id
  returning * into current_source;

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
    'knowledge.source.transitioned',
    'knowledge_source',
    target_source_id,
    jsonb_build_object(
      'from_status', prior_status,
      'to_status', target_status
    ),
    changed_at
  );

  return next current_source;
end;
$$;

create or replace function public.search_approved_knowledge(
  target_organization_id uuid,
  target_query text,
  target_limit integer default 8
)
returns table (
  section_id uuid,
  source_id uuid,
  source_title text,
  source_kind public.knowledge_source_kind,
  authority public.knowledge_authority,
  sensitivity public.document_sensitivity,
  version_label text,
  source_url text,
  heading text,
  excerpt text,
  citation_label text,
  review_due_on date,
  is_stale boolean,
  relevance real
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_query text := trim(target_query);
  bounded_limit integer := least(greatest(target_limit, 1), 12);
  may_read_restricted boolean;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.is_active_member(target_organization_id)
  then
    raise exception 'You do not have permission to search this knowledge.'
      using errcode = '42501';
  end if;

  if char_length(normalized_query) not between 2 and 240 then
    raise exception 'Knowledge searches must contain 2 to 240 characters.'
      using errcode = '22023';
  end if;

  may_read_restricted := public.has_organization_role(
    target_organization_id,
    array[
      'owner',
      'admin',
      'trip_designer',
      'operations'
    ]::public.app_role[]
  );

  return query
  with requested_query as (
    select websearch_to_tsquery('simple', normalized_query) as value
  )
  select
    section.id,
    source.id,
    source.title,
    source.source_kind,
    source.authority,
    source.sensitivity,
    source.version_label,
    source.source_url,
    section.heading,
    case
      when char_length(section.content) > 500
        then left(section.content, 497) || '...'
      else section.content
    end,
    section.citation_label,
    source.review_due_on,
    source.review_due_on is null
      or source.review_due_on < current_date,
    ts_rank_cd(section.search_document, requested_query.value)
  from public.knowledge_sections as section
  join public.knowledge_sources as source
    on source.organization_id = section.organization_id
    and source.id = section.source_id
  cross join requested_query
  where section.organization_id = target_organization_id
    and source.status = 'approved'
    and (
      source.sensitivity = 'normal'
      or may_read_restricted
    )
    and section.search_document @@ requested_query.value
  order by
    ts_rank_cd(section.search_document, requested_query.value) desc,
    source.review_due_on desc nulls last,
    section.position,
    section.id
  limit bounded_limit;
end;
$$;

revoke all on function public.upsert_knowledge_source(
  uuid,
  text,
  public.knowledge_source_kind,
  public.knowledge_authority,
  public.document_sensitivity,
  text,
  text,
  text,
  date,
  date,
  uuid
) from public, anon;
revoke all on function public.add_knowledge_section(
  uuid,
  uuid,
  text,
  text,
  text,
  integer
) from public, anon;
revoke all on function public.transition_knowledge_source(
  uuid,
  uuid,
  public.knowledge_source_status
) from public, anon;
revoke all on function public.search_approved_knowledge(
  uuid,
  text,
  integer
) from public, anon;

grant execute on function public.upsert_knowledge_source(
  uuid,
  text,
  public.knowledge_source_kind,
  public.knowledge_authority,
  public.document_sensitivity,
  text,
  text,
  text,
  date,
  date,
  uuid
) to authenticated, service_role;
grant execute on function public.add_knowledge_section(
  uuid,
  uuid,
  text,
  text,
  text,
  integer
) to authenticated, service_role;
grant execute on function public.transition_knowledge_source(
  uuid,
  uuid,
  public.knowledge_source_status
) to authenticated, service_role;
grant execute on function public.search_approved_knowledge(
  uuid,
  text,
  integer
) to authenticated, service_role;
