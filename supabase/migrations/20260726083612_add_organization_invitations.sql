-- Tenant-owned invitation ledger. Delivery remains a separate external effect:
-- this table records intent and a one-way token hash, never a reusable secret.

create index if not exists memberships_active_user_organization_idx
  on public.memberships (user_id, organization_id)
  where status = 'active';

create or replace function public.shares_active_organization(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as viewer
    inner join public.memberships as teammate
      on teammate.organization_id = viewer.organization_id
    where viewer.user_id = (select auth.uid())
      and viewer.status = 'active'
      and teammate.user_id = target_user_id
      and teammate.status = 'active'
  );
$$;

revoke all on function public.shares_active_organization(uuid) from public;
grant execute on function public.shares_active_organization(uuid) to authenticated;

create policy "workspace members may read teammate profiles"
  on public.profiles
  for select
  to authenticated
  using (public.shares_active_organization(id));

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null
    check (char_length(btrim(email)) between 3 and 320)
    check (position('@' in email) > 1),
  role public.app_role not null default 'agent',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_invitations_expiry_after_creation
    check (expires_at > created_at),
  constraint organization_invitations_status_timestamps
    check (
      (status = 'pending' and accepted_at is null and revoked_at is null)
      or (status = 'accepted' and accepted_at is not null and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null and accepted_at is null)
      or (status = 'expired' and accepted_at is null and revoked_at is null)
    )
);

create unique index organization_invitations_pending_email_unique_idx
  on public.organization_invitations (organization_id, lower(btrim(email)))
  where status = 'pending';

create index organization_invitations_organization_created_idx
  on public.organization_invitations (organization_id, created_at desc);

create index organization_invitations_invited_by_idx
  on public.organization_invitations (invited_by)
  where invited_by is not null;

create index organization_invitations_accepted_by_idx
  on public.organization_invitations (accepted_by)
  where accepted_by is not null;

create trigger organization_invitations_set_updated_at
  before update on public.organization_invitations
  for each row execute function public.set_updated_at();

create or replace function private.protect_organization_invitation_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.organization_id <> new.organization_id
    or old.email <> new.email
    or old.role <> new.role
    or old.token_hash <> new.token_hash
    or old.invited_by is distinct from new.invited_by
    or old.created_at <> new.created_at
    or old.expires_at <> new.expires_at then
    raise exception 'Invitation identity fields are immutable.';
  end if;

  if old.status <> 'pending' then
    raise exception 'Only a pending invitation can change state.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_organization_invitation_update() from public;

create trigger organization_invitations_protect_update
  before update on public.organization_invitations
  for each row execute function private.protect_organization_invitation_update();

create or replace function private.audit_organization_invitation_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    new.organization_id,
    (select auth.uid()),
    case
      when tg_op = 'INSERT' then 'invitation.created'
      else 'invitation.' || new.status
    end,
    'organization_invitation',
    new.id,
    jsonb_build_object(
      'role', new.role,
      'status', new.status,
      'expires_at', new.expires_at
    )
  );
  return new;
end;
$$;

revoke all on function private.audit_organization_invitation_change() from public;

create trigger organization_invitations_audit_change
  after insert or update on public.organization_invitations
  for each row execute function private.audit_organization_invitation_change();

create or replace function private.expire_replaced_organization_invitation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.organization_invitations
  set status = 'expired'
  where organization_id = new.organization_id
    and lower(btrim(email)) = lower(btrim(new.email))
    and status = 'pending'
    and expires_at <= statement_timestamp();
  return new;
end;
$$;

revoke all on function private.expire_replaced_organization_invitation()
  from public;

create trigger organization_invitations_expire_replaced
  before insert on public.organization_invitations
  for each row execute function private.expire_replaced_organization_invitation();

alter table public.organization_invitations enable row level security;

create policy "workspace managers may read invitations"
  on public.organization_invitations
  for select
  to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  );

create policy "workspace managers may create invitations"
  on public.organization_invitations
  for insert
  to authenticated
  with check (
    invited_by = (select auth.uid())
    and status = 'pending'
    and accepted_by is null
    and accepted_at is null
    and revoked_at is null
    and (
      public.has_organization_role(
        organization_id,
        array['owner']::public.app_role[]
      )
      or (
        role <> 'owner'
        and public.has_organization_role(
          organization_id,
          array['owner', 'admin']::public.app_role[]
        )
      )
    )
  );

create policy "workspace managers may revoke invitations"
  on public.organization_invitations
  for update
  to authenticated
  using (
    status = 'pending'
    and (
      public.has_organization_role(
        organization_id,
        array['owner']::public.app_role[]
      )
      or (
        role <> 'owner'
        and public.has_organization_role(
          organization_id,
          array['owner', 'admin']::public.app_role[]
        )
      )
    )
  )
  with check (
    status = 'revoked'
    and revoked_at is not null
    and accepted_by is null
    and accepted_at is null
    and (
      public.has_organization_role(
        organization_id,
        array['owner']::public.app_role[]
      )
      or (
        role <> 'owner'
        and public.has_organization_role(
          organization_id,
          array['owner', 'admin']::public.app_role[]
        )
      )
    )
  );

grant select, insert, update on table public.organization_invitations
  to authenticated;
