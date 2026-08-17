-- Platform-managed account security with immediate application enforcement.
-- Supabase session revocation removes refresh sessions, while this state also
-- rejects already-issued access tokens at the application proxy boundary.

create type public.identity_access_status as enum ('active', 'suspended');

create table public.identity_security_controls (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status public.identity_access_status not null default 'active',
  sessions_valid_after timestamptz not null default '1970-01-01 00:00:00+00',
  password_reset_required boolean not null default false,
  version bigint not null default 1 check (version > 0),
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create trigger identity_security_controls_set_updated_at
  before update on public.identity_security_controls
  for each row execute function public.set_updated_at();

insert into public.identity_security_controls (user_id)
select profile.id from public.profiles profile
on conflict (user_id) do nothing;

update public.identity_security_controls control
set status = 'suspended',
    sessions_valid_after = statement_timestamp()
from auth.users identity
where identity.id = control.user_id
  and identity.banned_until > statement_timestamp();

create or replace function private.seed_identity_security_control()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.identity_security_controls (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.seed_identity_security_control() from public;

create trigger profiles_seed_identity_security_control
  after insert on public.profiles
  for each row execute function private.seed_identity_security_control();

create table public.identity_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 120),
  reason text not null check (char_length(reason) between 12 and 500),
  version bigint not null check (version > 1),
  created_at timestamptz not null default statement_timestamp()
);

create index identity_security_events_user_created_idx
  on public.identity_security_events (user_id, created_at desc);

alter table public.identity_security_controls enable row level security;
alter table public.identity_security_events enable row level security;

revoke all on table public.identity_security_controls
  from public, anon, authenticated, service_role;
revoke all on table public.identity_security_events
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.identity_security_controls to service_role;
grant select, insert on table public.identity_security_events to service_role;

create or replace function public.get_current_identity_security_control()
returns table (
  status public.identity_access_status,
  sessions_valid_after timestamptz,
  password_reset_required boolean,
  version bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    coalesce(control.status, 'active'::public.identity_access_status),
    coalesce(control.sessions_valid_after, '1970-01-01 00:00:00+00'::timestamptz),
    coalesce(control.password_reset_required, false),
    coalesce(control.version, 1::bigint)
  from (select auth.uid() as user_id) identity
  left join public.identity_security_controls control
    on control.user_id = identity.user_id
  where identity.user_id is not null;
$$;

revoke all on function public.get_current_identity_security_control()
  from public, anon;
grant execute on function public.get_current_identity_security_control()
  to authenticated;

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

create or replace function public.set_identity_security_status_service(
  target_user_id uuid,
  target_status public.identity_access_status,
  actor_id uuid,
  change_reason text,
  expected_version bigint
)
returns public.identity_security_controls
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  current_record public.identity_security_controls;
  updated_record public.identity_security_controls;
  normalized_reason text := btrim(coalesce(change_reason, ''));
begin
  perform private.require_identity_security_actor(actor_id);
  if actor_id = target_user_id then
    raise exception 'A superadmin cannot change their own account status.'
      using errcode = '42501';
  end if;
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A security reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;

  select control.* into current_record
  from public.identity_security_controls control
  where control.user_id = target_user_id
  for update;
  if not found then
    raise exception 'Identity security control was not found.' using errcode = 'P0002';
  end if;
  if current_record.status = target_status then
    return current_record;
  end if;
  if current_record.version <> expected_version then
    raise exception 'Identity security state changed. Refresh and try again.'
      using errcode = '40001';
  end if;
  if target_status = 'suspended' and exists (
    select 1 from public.platform_admins administrator
    where administrator.user_id = target_user_id
      and administrator.status = 'active'
  ) then
    raise exception 'Suspend platform authority before suspending this account.'
      using errcode = '42501';
  end if;

  update public.identity_security_controls control
  set status = target_status,
      sessions_valid_after = case
        when target_status = 'suspended' then statement_timestamp()
        else control.sessions_valid_after
      end,
      changed_by = actor_id,
      version = control.version + 1
  where control.user_id = target_user_id
  returning control.* into updated_record;

  if target_status = 'suspended' then
    delete from auth.sessions where user_id = target_user_id;
  end if;

  insert into public.identity_security_events (
    user_id, actor_id, event_type, reason, version
  ) values (
    target_user_id,
    actor_id,
    case when target_status = 'suspended' then 'identity.suspended' else 'identity.restored' end,
    normalized_reason,
    updated_record.version
  );
  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id,
    case when target_status = 'suspended' then 'identity.suspended' else 'identity.restored' end,
    'auth_user',
    target_user_id,
    jsonb_build_object('status', target_status, 'version', updated_record.version)
  );
  return updated_record;
end;
$$;

create or replace function public.revoke_identity_sessions_service(
  target_user_id uuid,
  actor_id uuid,
  change_reason text,
  expected_version bigint
)
returns public.identity_security_controls
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  updated_record public.identity_security_controls;
  normalized_reason text := btrim(coalesce(change_reason, ''));
begin
  perform private.require_identity_security_actor(actor_id);
  if actor_id = target_user_id then
    raise exception 'Use self-service sign out for your own account.' using errcode = '42501';
  end if;
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A security reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;

  update public.identity_security_controls control
  set sessions_valid_after = statement_timestamp(),
      changed_by = actor_id,
      version = control.version + 1
  where control.user_id = target_user_id
    and control.version = expected_version
  returning control.* into updated_record;
  if not found then
    raise exception 'Identity security state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  delete from auth.sessions where user_id = target_user_id;
  insert into public.identity_security_events (
    user_id, actor_id, event_type, reason, version
  ) values (
    target_user_id, actor_id, 'identity.sessions_revoked', normalized_reason, updated_record.version
  );
  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id, 'identity.sessions_revoked', 'auth_user', target_user_id,
    jsonb_build_object('version', updated_record.version)
  );
  return updated_record;
end;
$$;

create or replace function public.require_identity_password_reset_service(
  target_user_id uuid,
  actor_id uuid,
  change_reason text,
  expected_version bigint
)
returns public.identity_security_controls
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  current_record public.identity_security_controls;
  updated_record public.identity_security_controls;
  normalized_reason text := btrim(coalesce(change_reason, ''));
begin
  perform private.require_identity_security_actor(actor_id);
  if actor_id = target_user_id then
    raise exception 'A superadmin cannot force their own password reset.' using errcode = '42501';
  end if;
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A security reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;

  select control.* into current_record
  from public.identity_security_controls control
  where control.user_id = target_user_id
  for update;
  if not found then
    raise exception 'Identity security control was not found.' using errcode = 'P0002';
  end if;
  if current_record.password_reset_required then
    return current_record;
  end if;
  if current_record.version <> expected_version then
    raise exception 'Identity security state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  update public.identity_security_controls control
  set password_reset_required = true,
      sessions_valid_after = statement_timestamp(),
      changed_by = actor_id,
      version = control.version + 1
  where control.user_id = target_user_id
  returning control.* into updated_record;

  delete from auth.sessions where user_id = target_user_id;
  insert into public.identity_security_events (
    user_id, actor_id, event_type, reason, version
  ) values (
    target_user_id, actor_id, 'identity.password_reset_required', normalized_reason, updated_record.version
  );
  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id, 'identity.password_reset_required', 'auth_user', target_user_id,
    jsonb_build_object('version', updated_record.version)
  );
  return updated_record;
end;
$$;

create or replace function public.complete_required_password_reset()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  updated_version bigint;
begin
  if current_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  update public.identity_security_controls control
  set password_reset_required = false,
      changed_by = current_user_id,
      version = control.version + 1
  where control.user_id = current_user_id
    and control.status = 'active'
    and control.password_reset_required
  returning control.version into updated_version;
  if updated_version is null then return false; end if;

  insert into public.identity_security_events (
    user_id, actor_id, event_type, reason, version
  ) values (
    current_user_id,
    current_user_id,
    'identity.password_reset_completed',
    'Password reset completed by the account owner.',
    updated_version
  );
  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    current_user_id,
    'identity.password_reset_completed',
    'auth_user',
    current_user_id,
    jsonb_build_object('version', updated_version)
  );
  return true;
end;
$$;

revoke all on function public.set_identity_security_status_service(
  uuid, public.identity_access_status, uuid, text, bigint
) from public, anon, authenticated;
revoke all on function public.revoke_identity_sessions_service(
  uuid, uuid, text, bigint
) from public, anon, authenticated;
revoke all on function public.require_identity_password_reset_service(
  uuid, uuid, text, bigint
) from public, anon, authenticated;
grant execute on function public.set_identity_security_status_service(
  uuid, public.identity_access_status, uuid, text, bigint
) to service_role;
grant execute on function public.revoke_identity_sessions_service(
  uuid, uuid, text, bigint
) to service_role;
grant execute on function public.require_identity_password_reset_service(
  uuid, uuid, text, bigint
) to service_role;

revoke all on function public.complete_required_password_reset() from public, anon;
grant execute on function public.complete_required_password_reset() to authenticated;

comment on table public.identity_security_controls is
  'Canonical platform-managed account security state. No credentials or session tokens are stored.';
comment on function public.get_current_identity_security_control() is
  'Returns only the signed-in account security state for immediate application enforcement.';
