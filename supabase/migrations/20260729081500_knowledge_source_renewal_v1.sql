-- Phase 17: immutable knowledge renewal and draft passage revision.
--
-- Approved evidence is never edited in place. Curators prepare a successor
-- draft, revise its cloned passages, and submit it for human review. Approving
-- the successor retires the previous version in the same transaction.

alter table public.knowledge_sources
  add column supersedes_source_id uuid;

alter table public.knowledge_sources
  add constraint knowledge_sources_supersedes_not_self_check
    check (
      supersedes_source_id is null
      or supersedes_source_id <> id
    ),
  add constraint knowledge_sources_supersedes_same_organization_fkey
    foreign key (organization_id, supersedes_source_id)
    references public.knowledge_sources (organization_id, id)
    on delete restrict;

create unique index knowledge_sources_active_successor_key
  on public.knowledge_sources (organization_id, supersedes_source_id)
  where supersedes_source_id is not null
    and status <> 'retired';

create index knowledge_sources_supersedes_idx
  on public.knowledge_sources (organization_id, supersedes_source_id)
  where supersedes_source_id is not null;

create or replace function public.renew_knowledge_source(
  target_organization_id uuid,
  target_source_id uuid,
  target_version_label text,
  target_review_due_on date,
  target_valid_from date default current_date
)
returns setof public.knowledge_sources
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_source public.knowledge_sources%rowtype;
  successor_source public.knowledge_sources%rowtype;
  cloned_section_count integer := 0;
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
    raise exception 'You do not have permission to renew knowledge.'
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

  if current_source.status <> 'approved' then
    raise exception 'Only approved knowledge can start a replacement version.'
      using errcode = '22023';
  end if;

  if char_length(trim(target_version_label)) not between 1 and 80
    or lower(trim(target_version_label))
      = lower(trim(current_source.version_label))
  then
    raise exception 'Choose a distinct replacement version label.'
      using errcode = '22023';
  end if;

  if target_review_due_on is null
    or target_review_due_on < current_date
    or (
      target_valid_from is not null
      and target_review_due_on < target_valid_from
    )
  then
    raise exception 'The replacement needs a current review window.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.knowledge_sources as successor
    where successor.organization_id = target_organization_id
      and successor.supersedes_source_id = target_source_id
      and successor.status <> 'retired'
  ) then
    raise exception 'An active replacement already exists for this source.'
      using errcode = '23505';
  end if;

  insert into public.knowledge_sources (
    organization_id,
    title,
    source_kind,
    authority,
    status,
    sensitivity,
    version_label,
    source_url,
    summary,
    valid_from,
    review_due_on,
    created_by,
    supersedes_source_id,
    created_at,
    updated_at
  )
  values (
    target_organization_id,
    current_source.title,
    current_source.source_kind,
    current_source.authority,
    'draft',
    current_source.sensitivity,
    trim(target_version_label),
    current_source.source_url,
    current_source.summary,
    target_valid_from,
    target_review_due_on,
    actor_id,
    current_source.id,
    changed_at,
    changed_at
  )
  returning * into successor_source;

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
    successor_source.id,
    section.heading,
    section.content,
    section.citation_label,
    section.position,
    actor_id,
    changed_at,
    changed_at
  from public.knowledge_sections as section
  where section.organization_id = target_organization_id
    and section.source_id = current_source.id
  order by section.position, section.id;

  get diagnostics cloned_section_count = row_count;

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
    'knowledge.source.renewal_started',
    'knowledge_source',
    successor_source.id,
    jsonb_build_object(
      'supersedes_source_id', current_source.id,
      'from_version', current_source.version_label,
      'to_version', successor_source.version_label,
      'cloned_section_count', cloned_section_count
    ),
    changed_at
  );

  return next successor_source;
end;
$$;

create or replace function public.update_knowledge_section(
  target_organization_id uuid,
  target_source_id uuid,
  target_section_id uuid,
  target_heading text,
  target_content text,
  target_citation_label text,
  target_position integer
)
returns setof public.knowledge_sections
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  source_status public.knowledge_source_status;
  current_section public.knowledge_sections%rowtype;
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
    raise exception 'You do not have permission to revise knowledge.'
      using errcode = '42501';
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
    raise exception 'Only draft knowledge passages may be revised.'
      using errcode = '22023';
  end if;

  select *
  into current_section
  from public.knowledge_sections
  where organization_id = target_organization_id
    and source_id = target_source_id
    and id = target_section_id
  for update;

  if not found then
    raise exception 'Knowledge passage was not found.'
      using errcode = 'P0002';
  end if;

  update public.knowledge_sections
  set heading = trim(target_heading),
      content = trim(target_content),
      citation_label = trim(target_citation_label),
      position = target_position
  where organization_id = target_organization_id
    and source_id = target_source_id
    and id = target_section_id
  returning * into current_section;

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
    'knowledge.section.revised',
    'knowledge_section',
    target_section_id,
    jsonb_build_object(
      'source_id', target_source_id,
      'position', target_position,
      'citation_label', current_section.citation_label
    ),
    changed_at
  );

  return next current_section;
end;
$$;

create or replace function public.delete_knowledge_section(
  target_organization_id uuid,
  target_source_id uuid,
  target_section_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  source_status public.knowledge_source_status;
  current_section public.knowledge_sections%rowtype;
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
    raise exception 'You do not have permission to remove knowledge.'
      using errcode = '42501';
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
    raise exception 'Only draft knowledge passages may be removed.'
      using errcode = '22023';
  end if;

  delete from public.knowledge_sections
  where organization_id = target_organization_id
    and source_id = target_source_id
    and id = target_section_id
  returning * into current_section;

  if not found then
    raise exception 'Knowledge passage was not found.'
      using errcode = 'P0002';
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
    'knowledge.section.removed',
    'knowledge_section',
    target_section_id,
    jsonb_build_object(
      'source_id', target_source_id,
      'position', current_section.position,
      'citation_label', current_section.citation_label
    ),
    changed_at
  );

  return true;
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
  superseded_source public.knowledge_sources%rowtype;
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

    if current_source.supersedes_source_id is not null then
      select *
      into superseded_source
      from public.knowledge_sources
      where organization_id = target_organization_id
        and id = current_source.supersedes_source_id
      for update;

      if not found
        or superseded_source.status not in ('approved', 'retired')
      then
        raise exception 'The superseded source is not in a replaceable state.'
          using errcode = '22023';
      end if;
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
      'to_status', target_status,
      'supersedes_source_id', current_source.supersedes_source_id
    ),
    changed_at
  );

  if target_status = 'approved'
    and current_source.supersedes_source_id is not null
    and superseded_source.status = 'approved'
  then
    update public.knowledge_sources
    set status = 'retired',
        retired_at = changed_at
    where organization_id = target_organization_id
      and id = current_source.supersedes_source_id;

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
      current_source.supersedes_source_id,
      jsonb_build_object(
        'from_status', 'approved',
        'to_status', 'retired',
        'reason', 'superseded',
        'successor_source_id', current_source.id
      ),
      changed_at
    );
  end if;

  return next current_source;
end;
$$;

revoke all on function public.renew_knowledge_source(
  uuid,
  uuid,
  text,
  date,
  date
) from public, anon;
revoke all on function public.update_knowledge_section(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  integer
) from public, anon;
revoke all on function public.delete_knowledge_section(
  uuid,
  uuid,
  uuid
) from public, anon;

grant execute on function public.renew_knowledge_source(
  uuid,
  uuid,
  text,
  date,
  date
) to authenticated, service_role;
grant execute on function public.update_knowledge_section(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  integer
) to authenticated, service_role;
grant execute on function public.delete_knowledge_section(
  uuid,
  uuid,
  uuid
) to authenticated, service_role;
