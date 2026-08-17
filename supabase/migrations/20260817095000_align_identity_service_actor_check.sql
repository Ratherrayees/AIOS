-- Identity service functions are service-role only. The application enforces
-- the explicit superadmin capability and MFA before calling them; this helper
-- independently validates that the recorded actor is an active operator.

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
    where administrator.user_id = actor_id
      and administrator.status = 'active'
  ) then
    raise exception 'An active platform operator is required.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_identity_security_actor(uuid) from public;

