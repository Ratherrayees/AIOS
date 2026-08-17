-- Password-reset completion must follow a confirmed Auth password update in a
-- trusted server action. Authenticated browser clients cannot clear the flag.

drop function if exists public.complete_required_password_reset();

create or replace function public.complete_required_password_reset_service(
  target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_version bigint;
begin
  update public.identity_security_controls control
  set password_reset_required = false,
      changed_by = target_user_id,
      version = control.version + 1
  where control.user_id = target_user_id
    and control.status = 'active'
    and control.password_reset_required
  returning control.version into updated_version;
  if updated_version is null then return false; end if;

  insert into public.identity_security_events (
    user_id, actor_id, event_type, reason, version
  ) values (
    target_user_id,
    target_user_id,
    'identity.password_reset_completed',
    'Password reset completed by the account owner.',
    updated_version
  );
  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    target_user_id,
    'identity.password_reset_completed',
    'auth_user',
    target_user_id,
    jsonb_build_object('version', updated_version)
  );
  return true;
end;
$$;

revoke all on function public.complete_required_password_reset_service(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_required_password_reset_service(uuid)
  to service_role;

