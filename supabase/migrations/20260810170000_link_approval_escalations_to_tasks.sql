-- Escalated approvals must enter the ordinary daily-work queue. This remains
-- an internal CRM signal: it sends no message and performs no external effect.

alter table public.tasks
  add column approval_request_id uuid;

alter table public.tasks
  add constraint tasks_approval_request_same_organization_fkey
    foreign key (organization_id, approval_request_id)
    references public.approval_requests (organization_id, id)
    on delete set null (approval_request_id);

create index tasks_approval_request_idx
  on public.tasks (organization_id, approval_request_id, status)
  where approval_request_id is not null;

create unique index tasks_one_active_approval_attention_idx
  on public.tasks (organization_id, approval_request_id)
  where approval_request_id is not null
    and status in ('open', 'in_progress');

create or replace function private.sync_approval_escalation_task()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  active_task_id uuid;
begin
  if new.status = 'pending'
    and new.approver_id is not null
    and new.escalation_count > old.escalation_count then
    select task.id
    into active_task_id
    from public.tasks task
    where task.organization_id = new.organization_id
      and task.approval_request_id = new.id
      and task.status in ('open', 'in_progress')
    order by task.created_at
    limit 1
    for update;

    if active_task_id is null then
      insert into public.tasks (
        organization_id,
        approval_request_id,
        title,
        status,
        due_at,
        assignee_id
      ) values (
        new.organization_id,
        new.id,
        left(
          'AIOS approval: ' || replace(new.action, '.', ' ') ||
          ' needs a human decision',
          500
        ),
        'open',
        statement_timestamp(),
        new.approver_id
      );
    else
      update public.tasks
      set
        title = left(
          'AIOS approval: ' || replace(new.action, '.', ' ') ||
          ' needs a human decision',
          500
        ),
        due_at = statement_timestamp(),
        assignee_id = new.approver_id
      where id = active_task_id;
    end if;
  elsif old.status = 'pending' and new.status <> 'pending' then
    update public.tasks
    set
      status = 'completed',
      completed_at = statement_timestamp()
    where organization_id = new.organization_id
      and approval_request_id = new.id
      and status in ('open', 'in_progress');
  end if;

  return new;
end;
$$;

revoke all on function private.sync_approval_escalation_task()
  from public, anon, authenticated;

create trigger approval_requests_sync_escalation_task
  after update of status, approver_id, escalation_count
  on public.approval_requests
  for each row execute function private.sync_approval_escalation_task();

comment on column public.tasks.approval_request_id is
  'Optional internal attention link to an escalated human approval gate.';
comment on function private.sync_approval_escalation_task() is
  'Creates or reroutes one internal task per escalated approval and completes it when the gate leaves pending state.';
