-- Enforce the reviewed lifecycle graph at the database boundary as well as in
-- the application. The service RPC remains the only lifecycle mutation path.

create or replace function public.set_organization_lifecycle_service(
  target_organization_id uuid,
  target_status public.organization_lifecycle_status,
  actor_id uuid,
  change_reason text,
  expected_version bigint
)
returns public.organization_lifecycle
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_record public.organization_lifecycle;
  updated_record public.organization_lifecycle;
  normalized_reason text := btrim(coalesce(change_reason, ''));
  transition_is_allowed boolean := false;
begin
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A lifecycle reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = actor_id
      and administrator.status = 'active'
  ) then
    raise exception 'An active platform operator is required.'
      using errcode = '42501';
  end if;

  select lifecycle.*
  into current_record
  from public.organization_lifecycle lifecycle
  where lifecycle.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'Organization lifecycle record was not found.'
      using errcode = 'P0002';
  end if;

  if current_record.version <> expected_version then
    raise exception 'Organization lifecycle changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  transition_is_allowed := case current_record.status
    when 'provisioning' then target_status in ('active', 'suspended')
    when 'active' then target_status in ('restricted', 'suspended', 'archived')
    when 'restricted' then target_status in ('active', 'suspended', 'archived')
    when 'suspended' then target_status in ('active', 'restricted', 'archived')
    when 'archived' then target_status = 'active'
    else false
  end;

  if not transition_is_allowed then
    raise exception 'The requested organization lifecycle transition is not allowed.'
      using errcode = '22023';
  end if;

  update public.organization_lifecycle lifecycle
  set status = target_status,
      reason = normalized_reason,
      changed_by = actor_id,
      version = lifecycle.version + 1
  where lifecycle.organization_id = target_organization_id
    and lifecycle.version = expected_version
  returning lifecycle.* into updated_record;

  if not found then
    raise exception 'Organization lifecycle changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  insert into public.organization_lifecycle_events (
    organization_id,
    previous_status,
    next_status,
    reason,
    actor_id,
    version
  ) values (
    target_organization_id,
    current_record.status,
    updated_record.status,
    normalized_reason,
    actor_id,
    updated_record.version
  );

  insert into public.platform_audit_events (
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    actor_id,
    'agency.lifecycle_changed',
    'organization',
    target_organization_id,
    jsonb_build_object(
      'previousStatus', current_record.status,
      'nextStatus', updated_record.status,
      'version', updated_record.version
    )
  );

  return updated_record;
end;
$$;

revoke all on function public.set_organization_lifecycle_service(
  uuid,
  public.organization_lifecycle_status,
  uuid,
  text,
  bigint
) from public, anon, authenticated;
grant execute on function public.set_organization_lifecycle_service(
  uuid,
  public.organization_lifecycle_status,
  uuid,
  text,
  bigint
) to service_role;

