alter table public.activity_events
  drop constraint activity_events_activity_type_check;

alter table public.activity_events
  add constraint activity_events_activity_type_check
  check (activity_type in (
    'note',
    'contact_created',
    'company_created',
    'deal_created',
    'deal_stage_changed',
    'task_created',
    'task_status_changed',
    'ai_observation'
  ));
