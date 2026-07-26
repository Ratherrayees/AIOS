-- Permanent job failure is a separate server-only operation so malformed,
-- stale, or unsafe work cannot consume retries or be replayed indefinitely.

create or replace function public.dead_letter_ai_job(
  target_job_id uuid,
  target_worker_id text,
  target_error_code text
)
returns table (
  job_id uuid,
  job_status public.ai_job_status,
  job_attempts integer
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
  if target_error_code is null
    or char_length(btrim(target_error_code)) not between 3 and 120 then
    raise exception 'A bounded error code is required for dead-letter jobs.'
      using errcode = '22023';
  end if;

  return query
  update public.ai_jobs job
  set
    status = 'dead_letter',
    locked_at = null,
    locked_by = null,
    last_error_code = btrim(target_error_code),
    completed_at = statement_timestamp()
  where job.id = target_job_id
    and job.status = 'running'
    and job.locked_by = btrim(target_worker_id)
  returning
    job.id,
    job.status,
    job.attempts;
end;
$$;

revoke all on function public.dead_letter_ai_job(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.dead_letter_ai_job(uuid, text, text)
  to service_role;
