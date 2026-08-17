-- Durable human escalation for overdue AIOS approval gates.

alter table public.approval_requests
  add column escalation_count integer not null default 0
    check (escalation_count >= 0),
  add column last_escalated_at timestamptz,
  add column last_escalation_outcome text
    check (
      last_escalation_outcome is null
      or last_escalation_outcome in ('assigned', 'rerouted', 'reminder')
    );

create index approval_requests_due_escalation_idx
  on public.approval_requests (expires_at, organization_id)
  where status = 'pending' and expires_at is not null;

create table public.approval_escalation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  approval_request_id uuid not null,
  escalation_number integer not null check (escalation_number > 0),
  outcome text not null
    check (outcome in ('assigned', 'rerouted', 'reminder')),
  previous_approver_id uuid references public.profiles(id) on delete set null,
  approver_id uuid not null references public.profiles(id) on delete restrict,
  escalated_by uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('operator', 'worker')),
  created_at timestamptz not null default now(),
  constraint approval_escalation_event_request_fkey
    foreign key (organization_id, approval_request_id)
    references public.approval_requests (organization_id, id)
    on delete cascade,
  constraint approval_escalation_event_number_key
    unique (organization_id, approval_request_id, escalation_number)
);

create index approval_escalation_events_org_created_idx
  on public.approval_escalation_events (organization_id, created_at desc);
create index approval_escalation_events_approver_idx
  on public.approval_escalation_events (approver_id);
create index approval_escalation_events_previous_approver_idx
  on public.approval_escalation_events (previous_approver_id)
  where previous_approver_id is not null;
create index approval_escalation_events_actor_idx
  on public.approval_escalation_events (escalated_by)
  where escalated_by is not null;

alter table public.approval_escalation_events enable row level security;

create policy "members may read approval escalation events"
  on public.approval_escalation_events
  for select
  to authenticated
  using (public.is_active_member(organization_id));

grant select on table public.approval_escalation_events to authenticated, service_role;
revoke insert, update, delete on table public.approval_escalation_events
  from authenticated;

create or replace function private.reject_approval_escalation_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'DELETE'
    and pg_trigger_depth() > 1
    and not exists (
      select 1
      from public.organizations
      where id = old.organization_id
    ) then
    return old;
  end if;

  raise exception 'Approval escalation evidence is immutable.'
    using errcode = '42501';
end;
$$;

create trigger approval_escalation_events_are_immutable
  before update or delete on public.approval_escalation_events
  for each row execute function private.reject_approval_escalation_event_mutation();

create or replace function private.escalate_approval_request(
  target_organization_id uuid,
  target_approval_id uuid,
  target_actor_id uuid,
  target_source text
)
returns table (
  escalation_event_id uuid,
  approval_id uuid,
  escalation_outcome text,
  escalation_number integer,
  previous_approver_id uuid,
  approver_id uuid,
  next_expires_at timestamptz,
  escalated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  approval_record public.approval_requests%rowtype;
  allowed_roles public.app_role[] :=
    array['owner', 'admin']::public.app_role[];
  escalation_minutes integer := 30;
  selected_approver_id uuid;
  selected_outcome text;
  escalation_time timestamptz := statement_timestamp();
  event_id uuid;
begin
  if target_source not in ('operator', 'worker') then
    raise exception 'Unknown approval escalation source.'
      using errcode = '22023';
  end if;

  select approval.*
  into approval_record
  from public.approval_requests approval
  where approval.organization_id = target_organization_id
    and approval.id = target_approval_id
  for update;
  if not found then
    raise exception 'This approval request is not available.'
      using errcode = 'P0002';
  end if;
  if approval_record.status <> 'pending' then
    raise exception 'Only a pending approval can be escalated.'
      using errcode = 'P0001';
  end if;
  if approval_record.expires_at is null
    or approval_record.expires_at > escalation_time then
    raise exception 'This approval is not yet due for escalation.'
      using errcode = '22023';
  end if;

  select
    policy.approval_roles,
    policy.escalation_after_minutes
  into allowed_roles, escalation_minutes
  from public.ai_autonomy_policies policy
  where policy.organization_id = target_organization_id
    and policy.action = approval_record.action;
  allowed_roles := coalesce(
    allowed_roles,
    array['owner', 'admin']::public.app_role[]
  );
  escalation_minutes := coalesce(escalation_minutes, 30);

  select membership.user_id
  into selected_approver_id
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role = any(allowed_roles)
    and membership.user_id is distinct from approval_record.approver_id
    and (
      approval_record.action not in (
        'invoice.issue',
        'payment.link.create',
        'payment.refund'
      )
      or membership.role in ('owner', 'admin', 'finance')
    )
  order by
    case membership.role
      when 'owner' then 1
      when 'admin' then 2
      when 'finance' then 3
      when 'operations' then 4
      else 5
    end,
    membership.created_at,
    membership.user_id
  limit 1;

  if selected_approver_id is null then
    select membership.user_id
    into selected_approver_id
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.status = 'active'
      and membership.role = any(allowed_roles)
      and (
        approval_record.action not in (
          'invoice.issue',
          'payment.link.create',
          'payment.refund'
        )
        or membership.role in ('owner', 'admin', 'finance')
      )
    order by
      case membership.role
        when 'owner' then 1
        when 'admin' then 2
        when 'finance' then 3
        when 'operations' then 4
        else 5
      end,
      membership.created_at,
      membership.user_id
    limit 1;
  end if;
  if selected_approver_id is null then
    raise exception 'No active human approver is configured for this action.'
      using errcode = 'P0002';
  end if;

  selected_outcome := case
    when approval_record.approver_id is null then 'assigned'
    when approval_record.approver_id = selected_approver_id then 'reminder'
    else 'rerouted'
  end;

  update public.approval_requests approval
  set
    approver_id = selected_approver_id,
    escalation_count = approval_record.escalation_count + 1,
    last_escalated_at = escalation_time,
    last_escalation_outcome = selected_outcome,
    expires_at = escalation_time + make_interval(mins => escalation_minutes)
  where approval.id = approval_record.id;

  insert into public.approval_escalation_events (
    organization_id,
    approval_request_id,
    escalation_number,
    outcome,
    previous_approver_id,
    approver_id,
    escalated_by,
    source,
    created_at
  )
  values (
    target_organization_id,
    approval_record.id,
    approval_record.escalation_count + 1,
    selected_outcome,
    approval_record.approver_id,
    selected_approver_id,
    target_actor_id,
    target_source,
    escalation_time
  )
  returning id into event_id;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    target_organization_id,
    target_actor_id,
    'approval.escalated',
    'approval_request',
    approval_record.id,
    jsonb_build_object(
      'action', approval_record.action,
      'outcome', selected_outcome,
      'escalation_number', approval_record.escalation_count + 1,
      'source', target_source
    ),
    escalation_time
  );

  return query
  select
    event_id,
    approval_record.id,
    selected_outcome,
    approval_record.escalation_count + 1,
    approval_record.approver_id,
    selected_approver_id,
    escalation_time + make_interval(mins => escalation_minutes),
    escalation_time;
end;
$$;

revoke all on function private.escalate_approval_request(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

create or replace function public.escalate_approval_request(
  target_organization_id uuid,
  target_approval_id uuid
)
returns table (
  escalation_event_id uuid,
  approval_id uuid,
  escalation_outcome text,
  escalation_number integer,
  previous_approver_id uuid,
  approver_id uuid,
  next_expires_at timestamptz,
  escalated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if not public.meets_mfa_requirement() then
    raise exception 'Multi-factor verification is required.'
      using errcode = '42501';
  end if;
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception 'Only an owner or admin can escalate this approval.'
      using errcode = '42501';
  end if;

  return query
  select *
  from private.escalate_approval_request(
    target_organization_id,
    target_approval_id,
    actor_id,
    'operator'
  );
end;
$$;

revoke all on function public.escalate_approval_request(uuid, uuid)
  from public, anon;
grant execute on function public.escalate_approval_request(uuid, uuid)
  to authenticated;

create or replace function public.escalate_overdue_approval_requests(
  target_limit integer default 25
)
returns table (
  inspected integer,
  assigned integer,
  rerouted integer,
  reminded integer,
  failed integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  approval_candidate record;
  escalation_result record;
  inspected_count integer := 0;
  assigned_count integer := 0;
  rerouted_count integer := 0;
  reminded_count integer := 0;
  failed_count integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the approval escalation worker may run this function.'
      using errcode = '42501';
  end if;
  if target_limit < 1 or target_limit > 100 then
    raise exception 'Approval escalation limit must be between 1 and 100.'
      using errcode = '22023';
  end if;

  for approval_candidate in
    select approval.organization_id, approval.id
    from public.approval_requests approval
    where approval.status = 'pending'
      and approval.expires_at is not null
      and approval.expires_at <= statement_timestamp()
    order by approval.expires_at, approval.created_at, approval.id
    limit target_limit
    for update skip locked
  loop
    inspected_count := inspected_count + 1;
    begin
      select *
      into escalation_result
      from private.escalate_approval_request(
        approval_candidate.organization_id,
        approval_candidate.id,
        null,
        'worker'
      );
      if escalation_result.escalation_outcome = 'assigned' then
        assigned_count := assigned_count + 1;
      elsif escalation_result.escalation_outcome = 'rerouted' then
        rerouted_count := rerouted_count + 1;
      else
        reminded_count := reminded_count + 1;
      end if;
    exception when others then
      failed_count := failed_count + 1;
    end;
  end loop;

  return query
  select
    inspected_count,
    assigned_count,
    rerouted_count,
    reminded_count,
    failed_count;
end;
$$;

revoke all on function public.escalate_overdue_approval_requests(integer)
  from public, anon, authenticated;
grant execute on function public.escalate_overdue_approval_requests(integer)
  to service_role;

comment on table public.approval_escalation_events is
  'Append-only tenant evidence for overdue approval routing; removed only with its workspace.';
comment on function public.escalate_approval_request(uuid, uuid) is
  'Owner/admin escalation of one due pending approval under its configured role policy.';
comment on function public.escalate_overdue_approval_requests(integer) is
  'Service-only bounded worker sweep for due pending approval gates.';
