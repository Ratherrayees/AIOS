-- Preserve the final-owner invariant while allowing a privileged deletion of
-- the parent organization to cascade through memberships. During an
-- organization cascade the parent row is no longer visible, so there is no
-- workspace left to orphan and no surviving audit stream to append to.

create or replace function private.prevent_last_active_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1
      from public.organizations organization
      where organization.id = old.organization_id
    ) then
      return old;
    end if;

    if old.role = 'owner'
      and old.status = 'active'
      and not exists (
        select 1
        from public.memberships membership
        where membership.organization_id = old.organization_id
          and membership.role = 'owner'
          and membership.status = 'active'
          and membership.id <> old.id
      ) then
      raise exception 'An organization must retain at least one active owner.';
    end if;
    return old;
  end if;

  if old.role = 'owner'
    and old.status = 'active'
    and (new.role <> 'owner' or new.status <> 'active')
    and not exists (
      select 1
      from public.memberships membership
      where membership.organization_id = old.organization_id
        and membership.role = 'owner'
        and membership.status = 'active'
        and membership.id <> old.id
    ) then
    raise exception 'An organization must retain at least one active owner.';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_last_active_owner_removal() from public;

create or replace function private.audit_membership_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  membership_id uuid := coalesce(new.id, old.id);
  organization_id_value uuid := coalesce(new.organization_id, old.organization_id);
  before_value jsonb := case when tg_op = 'INSERT' then null else jsonb_build_object('role', old.role, 'status', old.status, 'user_id', old.user_id) end;
  after_value jsonb := case when tg_op = 'DELETE' then null else jsonb_build_object('role', new.role, 'status', new.status, 'user_id', new.user_id) end;
begin
  if not exists (
    select 1
    from public.organizations organization
    where organization.id = organization_id_value
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  insert into public.audit_events (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (
    organization_id_value,
    auth.uid(),
    'membership.changed',
    'membership',
    membership_id,
    jsonb_build_object('operation', lower(tg_op), 'before', before_value, 'after', after_value)
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_membership_change() from public;
