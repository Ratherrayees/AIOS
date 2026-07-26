-- Persist only the highest internal escalation tier AIOS has applied.
-- These fields cannot deliver a message or make a customer commitment.

alter table public.conversations
  add column sla_escalation_level smallint not null default 0,
  add column sla_escalated_at timestamptz,
  add constraint conversations_sla_escalation_level_check
    check (sla_escalation_level between 0 and 3),
  add constraint conversations_sla_escalation_state_check
    check (
      (sla_escalation_level = 0 and sla_escalated_at is null)
      or
      (sla_escalation_level > 0 and sla_escalated_at is not null)
    );

create index conversations_sla_escalation_idx
  on public.conversations (
    organization_id,
    sla_escalation_level,
    response_due_at
  )
  where archived_at is null
    and status in ('inbox', 'open', 'pending')
    and response_due_at is not null;

alter table public.activity_events
  drop constraint activity_events_activity_type_check,
  add constraint activity_events_activity_type_check
  check (
    activity_type in (
      'note',
      'contact_created',
      'contact_preferences_updated',
      'contact_owner_changed',
      'contact_merged',
      'company_created',
      'deal_created',
      'deal_stage_changed',
      'task_created',
      'task_status_changed',
      'conversation_sla_updated',
      'conversation_sla_escalated',
      'message_draft_created',
      'ai_observation'
    )
  );
