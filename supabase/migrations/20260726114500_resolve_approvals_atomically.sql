-- Approval decisions are security boundaries. Requests may only be created as
-- pending, and resolution is exposed solely through a row-locked function so
-- concurrent approvers cannot both resume the same workflow.

drop policy if exists "members may request approvals"
  on public.approval_requests;
create policy "members may request pending approvals"
  on public.approval_requests
  for insert
  to authenticated
  with check (
    public.is_active_member(organization_id)
    and requester_id = (select auth.uid())
    and status = 'pending'
    and resolved_at is null
    and (
      approver_id is null
      or exists (
        select 1
        from public.memberships approver_membership
        where approver_membership.organization_id =
          approval_requests.organization_id
          and approver_membership.user_id =
            approval_requests.approver_id
          and approver_membership.status = 'active'
      )
    )
  );

drop policy if exists "authorized roles may resolve approvals"
  on public.approval_requests;
revoke update, delete on table public.approval_requests from authenticated;

create or replace function public.resolve_approval_request(
  target_organization_id uuid,
  target_approval_id uuid,
  target_decision public.approval_status
)
returns table (
  approval_id uuid,
  approval_action text,
  approval_entity_id uuid,
  approval_payload jsonb,
  resolved_status public.approval_status
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  approval_record public.approval_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Sign in is required.'
      using errcode = '42501';
  end if;
  if target_decision not in ('approved', 'rejected') then
    raise exception 'Only an approval or rejection decision is allowed.'
      using errcode = '22023';
  end if;
  if not public.meets_mfa_requirement() then
    raise exception 'Multi-factor verification is required.'
      using errcode = '42501';
  end if;

  select membership.role
  into actor_role
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = actor_id
    and membership.status = 'active'
    and membership.role in ('owner', 'admin', 'operations', 'finance');
  if actor_role is null then
    raise exception 'You do not have permission to resolve this approval.'
      using errcode = '42501';
  end if;

  select approval.*
  into approval_record
  from public.approval_requests approval
  where approval.id = target_approval_id
    and approval.organization_id = target_organization_id
  for update;
  if not found then
    raise exception 'This approval request is not available.'
      using errcode = 'P0002';
  end if;
  if approval_record.status <> 'pending' then
    raise exception 'This approval request has already been resolved.'
      using errcode = 'P0001';
  end if;

  if approval_record.expires_at is not null
    and approval_record.expires_at <= statement_timestamp() then
    update public.approval_requests
    set
      status = 'expired',
      resolved_at = statement_timestamp()
    where id = approval_record.id;

    insert into public.audit_events (
      organization_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    )
    values (
      target_organization_id,
      actor_id,
      'approval.expired',
      'approval_request',
      approval_record.id,
      jsonb_build_object('action', approval_record.action)
    );

    return query
    select
      approval_record.id,
      approval_record.action,
      approval_record.entity_id,
      approval_record.payload,
      'expired'::public.approval_status;
    return;
  end if;

  if approval_record.approver_id is not null
    and approval_record.approver_id <> actor_id
    and actor_role not in ('owner', 'admin') then
    raise exception 'This approval is assigned to another human approver.'
      using errcode = '42501';
  end if;

  update public.approval_requests
  set
    status = target_decision,
    approver_id = coalesce(approval_record.approver_id, actor_id),
    resolved_at = statement_timestamp()
  where id = approval_record.id;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_organization_id,
    actor_id,
    'approval.resolved',
    'approval_request',
    approval_record.id,
    jsonb_build_object(
      'action',
      approval_record.action,
      'decision',
      target_decision
    )
  );

  return query
  select
    approval_record.id,
    approval_record.action,
    approval_record.entity_id,
    approval_record.payload,
    target_decision;
end;
$$;

revoke all on function public.resolve_approval_request(
  uuid,
  uuid,
  public.approval_status
) from public;
grant execute on function public.resolve_approval_request(
  uuid,
  uuid,
  public.approval_status
) to authenticated;
