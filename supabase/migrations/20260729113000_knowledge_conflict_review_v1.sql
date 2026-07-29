-- Phase 17: deterministic knowledge conflict detection and human review.
--
-- The scanner never decides which source is correct. It only flags two current,
-- approved passages with the same normalized heading and source kind when their
-- date/number/currency tokens disagree. Curators must review the competing
-- citations, and normal source renewal remains the only way to correct evidence.

create type public.knowledge_conflict_status as enum (
  'open',
  'confirmed',
  'dismissed',
  'resolved'
);

create table public.knowledge_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  left_section_id uuid not null,
  right_section_id uuid not null,
  status public.knowledge_conflict_status not null default 'open',
  detection_reason text not null default 'factual_token_mismatch'
    check (detection_reason = 'factual_token_mismatch'),
  signal jsonb not null
    check (jsonb_typeof(signal) = 'object'),
  reviewed_by uuid,
  reviewed_at timestamptz,
  resolution_note text
    check (
      resolution_note is null
      or char_length(trim(resolution_note)) between 6 and 500
    ),
  detected_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint knowledge_conflicts_organization_id_id_key
    unique (organization_id, id),
  constraint knowledge_conflicts_section_order_check
    check (left_section_id < right_section_id),
  constraint knowledge_conflicts_pair_key
    unique (organization_id, left_section_id, right_section_id),
  constraint knowledge_conflicts_left_section_same_organization_fkey
    foreign key (organization_id, left_section_id)
    references public.knowledge_sections (organization_id, id)
    on delete cascade,
  constraint knowledge_conflicts_right_section_same_organization_fkey
    foreign key (organization_id, right_section_id)
    references public.knowledge_sections (organization_id, id)
    on delete cascade,
  constraint knowledge_conflicts_reviewer_same_organization_fkey
    foreign key (organization_id, reviewed_by)
    references public.memberships (organization_id, user_id)
    deferrable initially deferred,
  constraint knowledge_conflicts_review_state_check
    check (
      (
        status = 'open'
        and reviewed_by is null
        and reviewed_at is null
        and resolution_note is null
      )
      or
      (
        status in ('confirmed', 'dismissed', 'resolved')
        and reviewed_by is not null
        and reviewed_at is not null
        and resolution_note is not null
      )
    )
);

create index knowledge_conflicts_active_queue_idx
  on public.knowledge_conflicts (
    organization_id,
    status,
    detected_at desc
  )
  where status in ('open', 'confirmed');
create index knowledge_conflicts_right_section_idx
  on public.knowledge_conflicts (organization_id, right_section_id);
create index knowledge_conflicts_reviewed_by_idx
  on public.knowledge_conflicts (reviewed_by)
  where reviewed_by is not null;

create trigger knowledge_conflicts_set_updated_at
  before update on public.knowledge_conflicts
  for each row execute function public.set_updated_at();
create trigger knowledge_conflicts_prevent_organization_move
  before update on public.knowledge_conflicts
  for each row execute function private.prevent_organization_id_change();

alter table public.knowledge_conflicts enable row level security;

create policy knowledge_conflicts_curator_select
  on public.knowledge_conflicts
  for select
  to authenticated
  using (
    (select public.meets_mfa_requirement())
    and (
      select public.has_organization_role(
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

revoke all on table public.knowledge_conflicts
  from public, anon, authenticated;
grant select on table public.knowledge_conflicts to authenticated;
grant select, insert, update, delete
  on table public.knowledge_conflicts to service_role;

create or replace function private.knowledge_factual_tokens(target_text text)
returns text[]
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(distinct lower(token[1]) order by lower(token[1])),
    '{}'::text[]
  )
  from regexp_matches(
    target_text,
    '\m(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[[:alpha:]]{3}[[:space:]]*[0-9]+(?:[.,][0-9]+)?|[0-9]+(?:[.,][0-9]+)?%?)\M',
    'g'
  ) as token;
$$;

revoke all on function private.knowledge_factual_tokens(text)
  from public, anon, authenticated;
grant execute on function private.knowledge_factual_tokens(text)
  to service_role;

create or replace function public.scan_knowledge_conflicts(
  target_organization_id uuid
)
returns setof public.knowledge_conflicts
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select auth.uid());
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
    raise exception 'You do not have permission to scan knowledge conflicts.'
      using errcode = '42501';
  end if;

  update public.knowledge_conflicts as conflict
  set status = 'resolved',
      reviewed_by = actor_id,
      reviewed_at = changed_at,
      resolution_note =
        'Automatically resolved because competing evidence is no longer current and approved.'
  where conflict.organization_id = target_organization_id
    and conflict.status in ('open', 'confirmed')
    and not exists (
      select 1
      from public.knowledge_sections as left_section
      join public.knowledge_sources as left_source
        on left_source.organization_id = left_section.organization_id
       and left_source.id = left_section.source_id
      join public.knowledge_sections as right_section
        on right_section.organization_id = conflict.organization_id
       and right_section.id = conflict.right_section_id
      join public.knowledge_sources as right_source
        on right_source.organization_id = right_section.organization_id
       and right_source.id = right_section.source_id
      where left_section.organization_id = conflict.organization_id
        and left_section.id = conflict.left_section_id
        and left_source.status = 'approved'
        and left_source.review_due_on >= current_date
        and right_source.status = 'approved'
        and right_source.review_due_on >= current_date
    );

  with candidates as (
    select
      left_section.id as left_section_id,
      right_section.id as right_section_id,
      left_source.source_kind,
      lower(
        regexp_replace(trim(left_section.heading), '[[:space:]]+', ' ', 'g')
      ) as normalized_heading,
      private.knowledge_factual_tokens(left_section.content) as left_tokens,
      private.knowledge_factual_tokens(right_section.content) as right_tokens
    from public.knowledge_sections as left_section
    join public.knowledge_sources as left_source
      on left_source.organization_id = left_section.organization_id
     and left_source.id = left_section.source_id
    join public.knowledge_sections as right_section
      on right_section.organization_id = left_section.organization_id
     and right_section.id > left_section.id
     and right_section.source_id <> left_section.source_id
    join public.knowledge_sources as right_source
      on right_source.organization_id = right_section.organization_id
     and right_source.id = right_section.source_id
    where left_section.organization_id = target_organization_id
      and left_source.status = 'approved'
      and left_source.review_due_on >= current_date
      and right_source.status = 'approved'
      and right_source.review_due_on >= current_date
      and left_source.source_kind = right_source.source_kind
      and lower(
        regexp_replace(trim(left_section.heading), '[[:space:]]+', ' ', 'g')
      ) = lower(
        regexp_replace(trim(right_section.heading), '[[:space:]]+', ' ', 'g')
      )
  )
  insert into public.knowledge_conflicts (
    organization_id,
    left_section_id,
    right_section_id,
    signal,
    detected_at,
    updated_at
  )
  select
    target_organization_id,
    candidate.left_section_id,
    candidate.right_section_id,
    jsonb_build_object(
      'reason', 'factual_token_mismatch',
      'source_kind', candidate.source_kind,
      'normalized_heading', candidate.normalized_heading,
      'left_tokens', to_jsonb(candidate.left_tokens),
      'right_tokens', to_jsonb(candidate.right_tokens)
    ),
    changed_at,
    changed_at
  from candidates as candidate
  where cardinality(candidate.left_tokens) > 0
    and cardinality(candidate.right_tokens) > 0
    and candidate.left_tokens <> candidate.right_tokens
  on conflict (organization_id, left_section_id, right_section_id)
  do update
    set signal = excluded.signal,
        detected_at = excluded.detected_at
  where knowledge_conflicts.status = 'open';

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    metadata,
    created_at
  )
  values (
    target_organization_id,
    actor_id,
    'knowledge.conflicts.scanned',
    'knowledge_conflict',
    jsonb_build_object(
      'active_conflict_count',
      (
        select count(*)
        from public.knowledge_conflicts
        where organization_id = target_organization_id
          and status in ('open', 'confirmed')
      )
    ),
    changed_at
  );

  return query
  select conflict.*
  from public.knowledge_conflicts as conflict
  where conflict.organization_id = target_organization_id
  order by
    case conflict.status
      when 'open' then 0
      when 'confirmed' then 1
      else 2
    end,
    conflict.detected_at desc;
end;
$$;

create or replace function public.review_knowledge_conflict(
  target_organization_id uuid,
  target_conflict_id uuid,
  target_status public.knowledge_conflict_status,
  target_resolution_note text
)
returns setof public.knowledge_conflicts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_conflict public.knowledge_conflicts%rowtype;
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
    raise exception 'You do not have permission to review knowledge conflicts.'
      using errcode = '42501';
  end if;

  if target_status not in ('confirmed', 'dismissed')
    or char_length(trim(target_resolution_note)) not between 6 and 500
  then
    raise exception 'Choose a review decision and record useful evidence.'
      using errcode = '22023';
  end if;

  select *
  into current_conflict
  from public.knowledge_conflicts
  where organization_id = target_organization_id
    and id = target_conflict_id
  for update;

  if not found then
    raise exception 'Knowledge conflict was not found.'
      using errcode = 'P0002';
  end if;

  if current_conflict.status <> 'open' then
    raise exception 'Only an open knowledge conflict can be reviewed.'
      using errcode = '22023';
  end if;

  update public.knowledge_conflicts
  set status = target_status,
      reviewed_by = actor_id,
      reviewed_at = changed_at,
      resolution_note = trim(target_resolution_note)
  where organization_id = target_organization_id
    and id = target_conflict_id
  returning * into current_conflict;

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
    'knowledge.conflict.reviewed',
    'knowledge_conflict',
    target_conflict_id,
    jsonb_build_object(
      'status', target_status,
      'resolution_note', trim(target_resolution_note),
      'left_section_id', current_conflict.left_section_id,
      'right_section_id', current_conflict.right_section_id
    ),
    changed_at
  );

  return next current_conflict;
end;
$$;

revoke all on function public.scan_knowledge_conflicts(uuid)
  from public, anon;
revoke all on function public.review_knowledge_conflict(
  uuid,
  uuid,
  public.knowledge_conflict_status,
  text
) from public, anon;
grant execute on function public.scan_knowledge_conflicts(uuid)
  to authenticated, service_role;
grant execute on function public.review_knowledge_conflict(
  uuid,
  uuid,
  public.knowledge_conflict_status,
  text
) to authenticated, service_role;
