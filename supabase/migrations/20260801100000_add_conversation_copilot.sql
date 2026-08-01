-- Governed Sales Copilot drafts are internal-only records. The AI run link is
-- service-created provenance; authenticated browser clients may not forge or
-- replace it, and one run may create at most one durable draft.

alter type public.ai_job_type add value 'conversation_reply_draft';

alter table public.message_drafts
  add column ai_run_id uuid,
  add constraint message_drafts_ai_run_id_key unique (ai_run_id),
  add constraint message_drafts_ai_run_same_organization_fkey
    foreign key (organization_id, ai_run_id)
    references public.ai_runs (organization_id, id);

create or replace function private.guard_message_draft_ai_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.ai_run_id is distinct from old.ai_run_id then
    raise exception 'AI draft provenance is immutable.' using errcode = '42501';
  end if;

  if new.ai_run_id is not null
    and not exists (
      select 1
      from public.ai_runs run
      where run.organization_id = new.organization_id
        and run.id = new.ai_run_id
        and run.agent_type = 'conversation_reply_draft'
    ) then
    raise exception 'AI draft provenance is invalid.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_message_draft_ai_provenance()
  from public, anon, authenticated;

create trigger message_drafts_guard_ai_provenance
  before insert or update on public.message_drafts
  for each row execute function private.guard_message_draft_ai_provenance();

drop policy "inbox roles may create message drafts"
  on public.message_drafts;
create policy "inbox roles may create message drafts"
  on public.message_drafts for insert to authenticated
  with check (
    ai_run_id is null
    and created_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'operations', 'agent']::public.app_role[]
    )
  );
