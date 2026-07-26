-- Link internal work to its originating conversation so AIOS retries cannot
-- create duplicate open SLA follow-ups.

alter table public.tasks
  add column conversation_id uuid;

alter table public.tasks
  add constraint tasks_conversation_same_organization_fkey
    foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id)
    on delete set null (conversation_id);

create index tasks_conversation_status_idx
  on public.tasks (organization_id, conversation_id, status, due_at)
  where conversation_id is not null;

create unique index tasks_aios_inbox_sla_open_per_conversation_idx
  on public.tasks (organization_id, conversation_id)
  where conversation_id is not null
    and title like 'AIOS Inbox SLA:%'
    and status in ('open', 'in_progress');
