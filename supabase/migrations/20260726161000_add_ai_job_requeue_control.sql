-- Dead letters require an explicit, separately audited human decision before
-- they can return to the runnable queue. Browser roles cannot call this RPC.

create or replace function public.requeue_ai_job(
  target_job_id uuid
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
  return query
  update public.ai_jobs job
  set
    status = 'queued',
    attempts = 0,
    available_at = statement_timestamp(),
    locked_at = null,
    locked_by = null,
    last_error_code = null,
    completed_at = null
  where job.id = target_job_id
    and job.status = 'dead_letter'
  returning
    job.id,
    job.status,
    job.attempts,
    job.available_at;
end;
$$;

revoke all on function public.requeue_ai_job(uuid)
  from public, anon, authenticated;
grant execute on function public.requeue_ai_job(uuid)
  to service_role;
