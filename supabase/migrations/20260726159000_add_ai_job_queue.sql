-- Durable, server-controlled execution records for provider-backed AIOS work.
-- Browser roles may inspect their tenant's queue metadata but cannot enqueue,
-- claim, settle, cancel, or otherwise influence execution.

create type public.ai_job_type as enum (
  'lead_intake',
  'itinerary_draft'
);

create type public.ai_job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'dead_letter'
);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  ai_run_id uuid not null,
  job_type public.ai_job_type not null,
  status public.ai_job_status not null default 'queued',
  payload jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(payload) = 'object'
      and octet_length(payload::text) <= 4096
    ),
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 200),
  attempts integer not null default 0,
  max_attempts integer not null default 3
    check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text
    check (
      locked_by is null
      or char_length(locked_by) between 8 and 120
    ),
  last_error_code text
    check (
      last_error_code is null
      or char_length(last_error_code) between 3 and 120
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_jobs_organization_id_id_key
    unique (organization_id, id),
  constraint ai_jobs_idempotency_key_key
    unique (organization_id, idempotency_key),
  constraint ai_jobs_run_same_organization_fkey
    foreign key (organization_id, ai_run_id)
    references public.ai_runs (organization_id, id)
    on delete cascade,
  constraint ai_jobs_attempts_check
    check (attempts between 0 and max_attempts),
  constraint ai_jobs_execution_state_check
    check (
      (
        status in ('queued', 'failed')
        and locked_at is null
        and locked_by is null
        and completed_at is null
      )
      or (
        status = 'running'
        and attempts >= 1
        and locked_at is not null
        and locked_by is not null
        and completed_at is null
      )
      or (
        status in ('succeeded', 'cancelled', 'dead_letter')
        and locked_at is null
        and locked_by is null
        and completed_at is not null
      )
    ),
  constraint ai_jobs_error_state_check
    check (
      (
        status in ('failed', 'dead_letter')
        and attempts >= 1
        and last_error_code is not null
      )
      or (
        status not in ('failed', 'dead_letter')
        and last_error_code is null
      )
    )
);

create index ai_jobs_available_idx
  on public.ai_jobs (available_at, created_at)
  where status in ('queued', 'failed');
create index ai_jobs_stale_lock_idx
  on public.ai_jobs (locked_at)
  where status = 'running';
create index ai_jobs_organization_status_idx
  on public.ai_jobs (organization_id, status, updated_at desc);
create index ai_jobs_run_idx
  on public.ai_jobs (organization_id, ai_run_id);

create trigger ai_jobs_set_updated_at
  before update on public.ai_jobs
  for each row execute function public.set_updated_at();
create trigger ai_jobs_prevent_organization_move
  before update on public.ai_jobs
  for each row execute function private.prevent_organization_id_change();

alter table public.ai_jobs enable row level security;

revoke all on table public.ai_jobs from anon, authenticated;
grant select on table public.ai_jobs to authenticated;
grant select, insert, update, delete on table public.ai_jobs to service_role;

create policy "members may read their AI jobs"
  on public.ai_jobs
  for select
  to authenticated
  using (public.is_active_member(organization_id));

-- The caller is service_role, which already has the narrowly scoped table
-- privileges above and bypasses RLS. SECURITY INVOKER avoids elevating any
-- accidentally granted caller to the migration owner's privileges.
create or replace function public.claim_ai_job(
  target_job_id uuid,
  target_worker_id text
)
returns table (
  job_id uuid,
  job_organization_id uuid,
  job_ai_run_id uuid,
  claimed_job_type public.ai_job_type,
  job_payload jsonb,
  job_attempts integer,
  job_max_attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if char_length(btrim(target_worker_id)) not between 8 and 120 then
    raise exception 'Worker identity must contain between 8 and 120 characters.'
      using errcode = '22023';
  end if;

  update public.ai_jobs job
  set
    status = 'dead_letter',
    locked_at = null,
    locked_by = null,
    last_error_code = 'AI_JOB_LEASE_EXPIRED',
    completed_at = statement_timestamp()
  where job.id = target_job_id
    and job.status = 'running'
    and job.locked_at
      <= statement_timestamp() - interval '15 minutes'
    and job.attempts >= job.max_attempts;

  return query
  update public.ai_jobs job
  set
    status = 'running',
    attempts = job.attempts + 1,
    locked_at = statement_timestamp(),
    locked_by = btrim(target_worker_id),
    last_error_code = null
  where job.id = target_job_id
    and (
      (
        job.status in ('queued', 'failed')
        and job.available_at <= statement_timestamp()
      )
      or (
        job.status = 'running'
        and job.locked_at
          <= statement_timestamp() - interval '15 minutes'
      )
    )
    and job.attempts < job.max_attempts
  returning
    job.id,
    job.organization_id,
    job.ai_run_id,
    job.job_type,
    job.payload,
    job.attempts,
    job.max_attempts;
end;
$$;

create or replace function public.settle_ai_job(
  target_job_id uuid,
  target_worker_id text,
  target_succeeded boolean,
  target_error_code text,
  target_retry_delay_seconds integer
)
returns table (
  job_id uuid,
  job_status public.ai_job_status,
  job_attempts integer,
  job_available_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if char_length(btrim(target_worker_id)) not between 8 and 120 then
    raise exception 'Worker identity must contain between 8 and 120 characters.'
      using errcode = '22023';
  end if;
  if target_retry_delay_seconds not between 0 and 3600 then
    raise exception 'Retry delay must be between 0 and 3600 seconds.'
      using errcode = '22023';
  end if;
  if not target_succeeded
    and (
      target_error_code is null
      or char_length(btrim(target_error_code)) not between 3 and 120
    ) then
    raise exception 'A bounded error code is required for failed jobs.'
      using errcode = '22023';
  end if;

  return query
  update public.ai_jobs job
  set
    status = case
      when target_succeeded then 'succeeded'::public.ai_job_status
      when job.attempts >= job.max_attempts then 'dead_letter'::public.ai_job_status
      else 'failed'::public.ai_job_status
    end,
    available_at = case
      when not target_succeeded and job.attempts < job.max_attempts
        then statement_timestamp()
          + make_interval(secs => target_retry_delay_seconds)
      else job.available_at
    end,
    locked_at = null,
    locked_by = null,
    last_error_code = case
      when target_succeeded then null
      else btrim(target_error_code)
    end,
    completed_at = case
      when target_succeeded or job.attempts >= job.max_attempts
        then statement_timestamp()
      else null
    end
  where job.id = target_job_id
    and job.status = 'running'
    and job.locked_by = btrim(target_worker_id)
  returning
    job.id,
    job.status,
    job.attempts,
    job.available_at;
end;
$$;

revoke all on function public.claim_ai_job(uuid, text)
  from public, anon, authenticated;
revoke all on function public.settle_ai_job(uuid, text, boolean, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_ai_job(uuid, text)
  to service_role;
grant execute on function public.settle_ai_job(
  uuid,
  text,
  boolean,
  text,
  integer
) to service_role;
