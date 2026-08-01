-- Human feedback for Sales Copilot drafts is an immutable decision ledger.
-- Reviewing a draft never sends, schedules, archives, or externally exposes it.

create type public.message_draft_review_decision as enum (
  'approved',
  'changes_requested',
  'rejected'
);

alter table public.message_drafts
  add constraint message_drafts_organization_id_id_key
  unique (organization_id, id);

create table public.message_draft_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  message_draft_id uuid not null,
  ai_run_id uuid not null,
  draft_updated_at timestamptz not null,
  content_sha256 text not null
    check (content_sha256 ~ '^[a-f0-9]{64}$'),
  decision public.message_draft_review_decision not null,
  note text
    check (note is null or char_length(trim(note)) between 1 and 500),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default statement_timestamp(),
  constraint message_draft_reviews_organization_id_id_key
    unique (organization_id, id),
  constraint message_draft_reviews_revision_key
    unique (message_draft_id, draft_updated_at),
  constraint message_draft_reviews_draft_same_organization_fkey
    foreign key (organization_id, message_draft_id)
    references public.message_drafts (organization_id, id)
    on delete cascade,
  constraint message_draft_reviews_run_same_organization_fkey
    foreign key (organization_id, ai_run_id)
    references public.ai_runs (organization_id, id),
  constraint message_draft_reviews_reviewer_same_organization_fkey
    foreign key (organization_id, reviewed_by)
    references public.memberships (organization_id, user_id)
    deferrable initially deferred,
  constraint message_draft_reviews_evidence_check
    check (
      (decision = 'approved' and note is null)
      or
      (decision in ('changes_requested', 'rejected')
        and char_length(trim(note)) between 6 and 500)
    )
);

create index message_draft_reviews_org_draft_idx
  on public.message_draft_reviews (
    organization_id,
    message_draft_id,
    reviewed_at desc
  );
create index message_draft_reviews_org_run_idx
  on public.message_draft_reviews (organization_id, ai_run_id);
create index message_draft_reviews_reviewer_idx
  on public.message_draft_reviews (reviewed_by);

alter table public.message_draft_reviews enable row level security;

grant select on table public.message_draft_reviews
  to authenticated, service_role;

create policy message_draft_reviews_member_select
  on public.message_draft_reviews for select to authenticated
  using (public.is_active_member(organization_id));
create policy "verified MFA factors require aal2"
  on public.message_draft_reviews as restrictive for all to authenticated
  using (public.meets_mfa_requirement());

create or replace function public.review_ai_message_draft(
  target_organization_id uuid,
  target_message_draft_id uuid,
  target_decision public.message_draft_review_decision,
  target_note text default null
)
returns setof public.message_draft_reviews
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := (select auth.uid());
  current_draft public.message_drafts%rowtype;
  review_record public.message_draft_reviews%rowtype;
  normalized_note text := nullif(trim(target_note), '');
  reviewed_at_value timestamptz := statement_timestamp();
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'operations', 'agent']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to review AIOS drafts.'
      using errcode = '42501';
  end if;

  if target_decision is null
    or (target_decision = 'approved' and normalized_note is not null)
    or (
      target_decision in ('changes_requested', 'rejected')
      and coalesce(char_length(normalized_note), 0) not between 6 and 500
    )
  then
    raise exception 'Choose a valid review decision and record useful feedback when required.'
      using errcode = '22023';
  end if;

  select *
  into current_draft
  from public.message_drafts
  where organization_id = target_organization_id
    and id = target_message_draft_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'The message draft was not found.' using errcode = 'P0002';
  end if;

  if current_draft.ai_run_id is null then
    raise exception 'Only an AIOS-generated draft can use this review ledger.'
      using errcode = '22023';
  end if;

  insert into public.message_draft_reviews (
    organization_id,
    message_draft_id,
    ai_run_id,
    draft_updated_at,
    content_sha256,
    decision,
    note,
    reviewed_by,
    reviewed_at
  )
  values (
    target_organization_id,
    current_draft.id,
    current_draft.ai_run_id,
    current_draft.updated_at,
    encode(
      extensions.digest(
        concat_ws(
          chr(31),
          current_draft.channel,
          coalesce(current_draft.subject, ''),
          current_draft.body
        ),
        'sha256'
      ),
      'hex'
    ),
    target_decision,
    normalized_note,
    actor_id,
    reviewed_at_value
  )
  returning * into review_record;

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
    'ai.draft.reviewed',
    'message_draft',
    current_draft.id,
    jsonb_build_object(
      'review_id', review_record.id,
      'ai_run_id', current_draft.ai_run_id,
      'decision', target_decision,
      'content_sha256', review_record.content_sha256,
      'feedback_recorded', normalized_note is not null,
      'external_message_sent', false
    ),
    reviewed_at_value
  );

  return next review_record;
end;
$$;

revoke all on function public.review_ai_message_draft(
  uuid,
  uuid,
  public.message_draft_review_decision,
  text
) from public, anon;
grant execute on function public.review_ai_message_draft(
  uuid,
  uuid,
  public.message_draft_review_decision,
  text
) to authenticated;
