-- Harden the independent platform-operator directory.
--
-- Browser clients retain self-only read access. Service-role platform actions
-- perform the authenticated role and MFA checks. The database independently
-- prevents removal or suspension of the final active superadmin.

create or replace function private.protect_last_active_platform_superadmin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_superadmin_count integer;
begin
  if old.role = 'superadmin'
    and old.status = 'active'
    and (
      tg_op = 'DELETE'
      or new.role <> 'superadmin'
      or new.status <> 'active'
    ) then
    perform pg_advisory_xact_lock(hashtext('aios:platform:last-superadmin'));

    select count(*)
    into active_superadmin_count
    from public.platform_admins administrator
    where administrator.role = 'superadmin'
      and administrator.status = 'active'
      and administrator.user_id <> old.user_id;

    if active_superadmin_count = 0 then
      raise exception 'At least one active platform superadmin is required.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_last_active_platform_superadmin()
  from public;

create trigger platform_admins_protect_last_superadmin
  before update or delete on public.platform_admins
  for each row execute function private.protect_last_active_platform_superadmin();

create index if not exists platform_admins_active_role_idx
  on public.platform_admins (role, status)
  where status = 'active';

comment on table public.platform_admins is
  'Independent platform-control-plane roles. These rows never grant agency membership or tenant-record access.';
