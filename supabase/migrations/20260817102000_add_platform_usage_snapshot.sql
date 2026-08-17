-- Aggregate-only platform usage visibility. This is an operational snapshot,
-- not an invoice ledger: no customer record, prompt, message, file name, or
-- provider credential is returned.

create or replace function public.get_platform_usage_snapshot_service(
  actor_id uuid,
  target_since timestamptz
)
returns table (
  organization_id uuid,
  active_users bigint,
  ai_runs bigint,
  input_tokens bigint,
  output_tokens bigint,
  ai_costs jsonb,
  storage_bytes bigint,
  outbound_emails bigint,
  inbound_emails bigint,
  queued_ai_jobs bigint,
  failed_ai_jobs bigint,
  management_reports bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = actor_id
      and administrator.status = 'active'
  ) then
    raise exception 'Active platform authority is required.' using errcode = '42501';
  end if;
  if target_since is null
    or target_since > statement_timestamp()
    or target_since < statement_timestamp() - interval '366 days'
  then
    raise exception 'Usage window must be within the previous 366 days.' using errcode = '22023';
  end if;

  return query
  with
  member_usage as (
    select membership.organization_id, count(*)::bigint as active_users
    from public.memberships membership
    where membership.status = 'active'
    group by membership.organization_id
  ),
  ai_usage as (
    select
      run.organization_id,
      count(*)::bigint as ai_runs,
      coalesce(sum(run.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(run.output_tokens), 0)::bigint as output_tokens
    from public.ai_runs run
    where run.created_at >= target_since
    group by run.organization_id
  ),
  ai_currency_usage as (
    select
      run.organization_id,
      upper(run.estimated_cost_currency) as currency,
      sum(run.estimated_cost) as amount
    from public.ai_runs run
    where run.created_at >= target_since
      and run.estimated_cost is not null
      and run.estimated_cost_currency ~ '^[A-Za-z]{3}$'
    group by run.organization_id, upper(run.estimated_cost_currency)
  ),
  ai_cost_usage as (
    select
      currency_usage.organization_id,
      jsonb_object_agg(currency_usage.currency, currency_usage.amount order by currency_usage.currency) as ai_costs
    from ai_currency_usage currency_usage
    group by currency_usage.organization_id
  ),
  storage_usage as (
    select document.organization_id, coalesce(sum(document.byte_size), 0)::bigint as storage_bytes
    from public.documents document
    group by document.organization_id
  ),
  outbound_usage as (
    select delivery.organization_id, count(*)::bigint as outbound_emails
    from public.email_message_deliveries delivery
    where delivery.created_at >= target_since
    group by delivery.organization_id
  ),
  inbound_usage as (
    select inbound.organization_id, count(*)::bigint as inbound_emails
    from public.email_inbound_events inbound
    where inbound.received_at >= target_since
    group by inbound.organization_id
  ),
  job_usage as (
    select
      job.organization_id,
      count(*) filter (where job.status in ('queued', 'running'))::bigint as queued_ai_jobs,
      count(*) filter (where job.status in ('failed', 'dead_letter'))::bigint as failed_ai_jobs
    from public.ai_jobs job
    where job.created_at >= target_since
    group by job.organization_id
  ),
  report_usage as (
    select delivery.organization_id, count(*)::bigint as management_reports
    from public.analytics_report_deliveries delivery
    where delivery.created_at >= target_since
    group by delivery.organization_id
  )
  select
    organization.id,
    coalesce(member_usage.active_users, 0),
    coalesce(ai_usage.ai_runs, 0),
    coalesce(ai_usage.input_tokens, 0),
    coalesce(ai_usage.output_tokens, 0),
    coalesce(ai_cost_usage.ai_costs, '{}'::jsonb),
    coalesce(storage_usage.storage_bytes, 0),
    coalesce(outbound_usage.outbound_emails, 0),
    coalesce(inbound_usage.inbound_emails, 0),
    coalesce(job_usage.queued_ai_jobs, 0),
    coalesce(job_usage.failed_ai_jobs, 0),
    coalesce(report_usage.management_reports, 0)
  from public.organizations organization
  left join member_usage on member_usage.organization_id = organization.id
  left join ai_usage on ai_usage.organization_id = organization.id
  left join ai_cost_usage on ai_cost_usage.organization_id = organization.id
  left join storage_usage on storage_usage.organization_id = organization.id
  left join outbound_usage on outbound_usage.organization_id = organization.id
  left join inbound_usage on inbound_usage.organization_id = organization.id
  left join job_usage on job_usage.organization_id = organization.id
  left join report_usage on report_usage.organization_id = organization.id
  order by organization.id;
end;
$$;

revoke all on function public.get_platform_usage_snapshot_service(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_platform_usage_snapshot_service(uuid, timestamptz)
  to service_role;

comment on function public.get_platform_usage_snapshot_service(uuid, timestamptz) is
  'Aggregate-only operational usage by tenant. Currency values remain separated; output excludes customer content and is not an invoice ledger.';
