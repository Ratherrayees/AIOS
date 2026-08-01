-- Aggregate Sales Copilot review outcomes without returning draft, feedback,
-- recipient, conversation, reviewer, or record-identifier data.

create index message_drafts_ai_quality_sample_idx
  on public.message_drafts (organization_id, created_at desc)
  where ai_run_id is not null;

create or replace function public.get_sales_copilot_quality_summary(
  target_organization_id uuid
)
returns table (
  total_ai_drafts bigint,
  active_ai_drafts bigint,
  reviewed_drafts bigint,
  review_decisions bigint,
  first_pass_approved bigint,
  initial_feedback_drafts bigint,
  recovered_after_feedback bigint,
  current_revision_approved bigint,
  current_revision_attention bigint,
  approved_decisions bigint,
  change_requested_decisions bigint,
  rejected_decisions bigint,
  latest_reviewed_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with ai_drafts as (
    select
      draft.id,
      draft.updated_at,
      draft.archived_at
    from public.message_drafts draft
    where draft.organization_id = target_organization_id
      and draft.ai_run_id is not null
  ),
  sequenced_reviews as (
    select
      review.id,
      review.message_draft_id,
      review.draft_updated_at,
      review.decision,
      review.reviewed_at,
      row_number() over (
        partition by review.message_draft_id
        order by review.reviewed_at, review.id
      ) as review_sequence
    from public.message_draft_reviews review
    join ai_drafts draft on draft.id = review.message_draft_id
    where review.organization_id = target_organization_id
  ),
  review_rollup as (
    select
      review.message_draft_id,
      count(*) as decision_count,
      (array_agg(
        review.decision::text
        order by review.reviewed_at, review.id
      ))[1] as first_decision,
      bool_or(
        review.review_sequence > 1
        and review.decision = 'approved'
      ) as later_approved,
      bool_or(
        review.draft_updated_at = draft.updated_at
        and review.decision = 'approved'
      ) as current_revision_is_approved
    from sequenced_reviews review
    join ai_drafts draft on draft.id = review.message_draft_id
    group by review.message_draft_id
  ),
  draft_totals as (
    select
      count(*) as total_ai_drafts,
      count(*) filter (where draft.archived_at is null) as active_ai_drafts,
      count(*) filter (
        where coalesce(rollup.decision_count, 0) > 0
      ) as reviewed_drafts,
      count(*) filter (
        where rollup.first_decision = 'approved'
      ) as first_pass_approved,
      count(*) filter (
        where rollup.first_decision in ('changes_requested', 'rejected')
      ) as initial_feedback_drafts,
      count(*) filter (
        where rollup.first_decision in ('changes_requested', 'rejected')
          and rollup.later_approved
      ) as recovered_after_feedback,
      count(*) filter (
        where draft.archived_at is null
          and coalesce(rollup.current_revision_is_approved, false)
      ) as current_revision_approved,
      count(*) filter (
        where draft.archived_at is null
          and not coalesce(rollup.current_revision_is_approved, false)
      ) as current_revision_attention
    from ai_drafts draft
    left join review_rollup rollup on rollup.message_draft_id = draft.id
  ),
  decision_totals as (
    select
      count(*) as review_decisions,
      count(*) filter (where review.decision = 'approved')
        as approved_decisions,
      count(*) filter (where review.decision = 'changes_requested')
        as change_requested_decisions,
      count(*) filter (where review.decision = 'rejected')
        as rejected_decisions,
      max(review.reviewed_at) as latest_reviewed_at
    from sequenced_reviews review
  )
  select
    drafts.total_ai_drafts,
    drafts.active_ai_drafts,
    drafts.reviewed_drafts,
    decisions.review_decisions,
    drafts.first_pass_approved,
    drafts.initial_feedback_drafts,
    drafts.recovered_after_feedback,
    drafts.current_revision_approved,
    drafts.current_revision_attention,
    decisions.approved_decisions,
    decisions.change_requested_decisions,
    decisions.rejected_decisions,
    decisions.latest_reviewed_at
  from draft_totals drafts
  cross join decision_totals decisions;
$$;

revoke all on function public.get_sales_copilot_quality_summary(uuid)
  from public, anon;
grant execute on function public.get_sales_copilot_quality_summary(uuid)
  to authenticated, service_role;

comment on function public.get_sales_copilot_quality_summary(uuid) is
  'Returns tenant-RLS-scoped aggregate Sales Copilot review outcomes without draft, feedback, recipient, reviewer, conversation, or record identifiers.';
