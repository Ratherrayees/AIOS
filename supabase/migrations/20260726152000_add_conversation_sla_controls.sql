-- Internal SLA controls make response obligations visible before external
-- channel delivery is enabled. Deadlines are operator-owned facts, not model
-- predictions, and can be cleared explicitly.

alter table public.conversations
  add column priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column response_due_at timestamptz;

create index conversations_response_sla_idx
  on public.conversations (
    organization_id,
    response_due_at,
    priority,
    status
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
      'ai_observation'
    )
  );
