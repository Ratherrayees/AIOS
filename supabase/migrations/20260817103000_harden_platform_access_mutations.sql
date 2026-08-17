-- Harden high-impact platform authority mutations without changing tenant RLS.
--
-- Identity security service operations require a superadmin actor. Platform
-- authority changes are serialized, optimistic-concurrency checked, and
-- audited in the same transaction as the mutation.

create or replace function private.require_identity_security_actor(actor_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.platform_admins administrator
    join public.identity_security_controls control
      on control.user_id = administrator.user_id
    where administrator.user_id = actor_id
      and administrator.status = 'active'
      and administrator.role = 'superadmin'
      and control.status = 'active'
      and not control.password_reset_required
  ) then
    raise exception 'An active platform superadmin is required.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_identity_security_actor(uuid) from public;

alter table public.platform_admins
  add column version bigint not null default 1 check (version > 0);

create or replace function private.platform_actor_snapshot(target_actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'actorUserId', target_actor_id,
    'actorName', profile.full_name,
    'actorEmail', lower(btrim(identity.email))
  ))
  from public.profiles profile
  left join auth.users identity on identity.id = profile.id
  where profile.id = target_actor_id;
$$;

revoke all on function private.platform_actor_snapshot(uuid) from public;

create or replace function private.require_platform_access_actor(actor_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.platform_admins administrator
    join public.identity_security_controls control
      on control.user_id = administrator.user_id
    where administrator.user_id = actor_id
      and administrator.status = 'active'
      and administrator.role = 'superadmin'
      and control.status = 'active'
      and not control.password_reset_required
  ) then
    raise exception 'An active platform superadmin is required.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_platform_access_actor(uuid) from public;

create or replace function public.set_platform_access_service(
  target_user_id uuid,
  target_role public.platform_role,
  target_status public.platform_access_status,
  actor_id uuid,
  change_reason text,
  expected_version bigint default null
)
returns public.platform_admins
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_record public.platform_admins;
  updated_record public.platform_admins;
  normalized_reason text := btrim(coalesce(change_reason, ''));
  audit_event_type text;
begin
  perform private.require_platform_access_actor(actor_id);

  if actor_id = target_user_id then
    raise exception 'Use another active superadmin to change your own platform access.'
      using errcode = '42501';
  end if;
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A platform access reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles profile where profile.id = target_user_id
  ) then
    raise exception 'The target account does not exist.' using errcode = 'P0002';
  end if;
  if target_status = 'active' and not exists (
    select 1
    from auth.users identity
    join public.identity_security_controls control
      on control.user_id = identity.id
    where identity.id = target_user_id
      and identity.email_confirmed_at is not null
      and control.status = 'active'
      and not control.password_reset_required
      and exists (
        select 1
        from auth.mfa_factors factor
        where factor.user_id = target_user_id
          and factor.factor_type = 'totp'
          and factor.status = 'verified'
      )
  ) then
    raise exception 'Active platform access requires an eligible identity with verified email and authenticator.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('aios:platform:access:' || target_user_id::text)
  );

  select administrator.* into current_record
  from public.platform_admins administrator
  where administrator.user_id = target_user_id
  for update;

  if not found then
    if expected_version is not null then
      raise exception 'Platform access state changed. Refresh and try again.'
        using errcode = '40001';
    end if;
    if target_status <> 'active' then
      raise exception 'New platform access must be granted as active.'
        using errcode = '22023';
    end if;

    insert into public.platform_admins (
      user_id,
      role,
      status,
      granted_by,
      version
    ) values (
      target_user_id,
      target_role,
      target_status,
      actor_id,
      1
    )
    returning * into updated_record;
    audit_event_type := 'access.granted';
  else
    if expected_version is null or current_record.version <> expected_version then
      raise exception 'Platform access state changed. Refresh and try again.'
        using errcode = '40001';
    end if;
    if current_record.role = target_role and current_record.status = target_status then
      return current_record;
    end if;

    -- Keep the invariant inside the service contract as well as in the table
    -- trigger so future callers cannot accidentally bypass the preflight.
    if current_record.role = 'superadmin'
      and current_record.status = 'active'
      and (target_role <> 'superadmin' or target_status <> 'active') then
      perform pg_advisory_xact_lock(hashtext('aios:platform:last-superadmin'));
      if not exists (
        select 1
        from public.platform_admins administrator
        where administrator.user_id <> target_user_id
          and administrator.role = 'superadmin'
          and administrator.status = 'active'
      ) then
        raise exception 'At least one active platform superadmin is required.'
          using errcode = '23514';
      end if;
    end if;

    update public.platform_admins administrator
    set role = target_role,
        status = target_status,
        granted_by = case
          when current_record.status = 'suspended' and target_status = 'active'
            then actor_id
          else administrator.granted_by
        end,
        granted_at = case
          when current_record.status = 'suspended' and target_status = 'active'
            then statement_timestamp()
          else administrator.granted_at
        end,
        version = administrator.version + 1
    where administrator.user_id = target_user_id
      and administrator.version = expected_version
    returning administrator.* into updated_record;

    if not found then
      raise exception 'Platform access state changed. Refresh and try again.'
        using errcode = '40001';
    end if;
    audit_event_type := case
      when current_record.status = 'suspended' and target_status = 'active'
        then 'access.restored'
      when current_record.status = 'active' and target_status = 'suspended'
        then 'access.suspended'
      else 'access.updated'
    end;
  end if;

  insert into public.platform_audit_events (
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    actor_id,
    audit_event_type,
    'platform_admin',
    target_user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'previousRole', case when current_record.user_id is null then null else current_record.role end,
      'previousStatus', case when current_record.user_id is null then null else current_record.status end,
      'nextRole', updated_record.role,
      'nextStatus', updated_record.status,
      'version', updated_record.version,
      'reason', normalized_reason
    )) || coalesce(private.platform_actor_snapshot(actor_id), '{}'::jsonb)
  );

  return updated_record;
end;
$$;

revoke all on function public.set_platform_access_service(
  uuid,
  public.platform_role,
  public.platform_access_status,
  uuid,
  text,
  bigint
) from public, anon, authenticated;
grant execute on function public.set_platform_access_service(
  uuid,
  public.platform_role,
  public.platform_access_status,
  uuid,
  text,
  bigint
) to service_role;

comment on function public.set_platform_access_service(
  uuid,
  public.platform_role,
  public.platform_access_status,
  uuid,
  text,
  bigint
) is
  'Service-role-only atomic platform authority mutation. The application caller must require an authenticated aal2 superadmin session before invocation.';
