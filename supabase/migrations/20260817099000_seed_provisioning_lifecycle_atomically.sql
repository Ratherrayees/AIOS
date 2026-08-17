-- Permit the dedicated service transaction to choose an initial provisioning
-- lifecycle while preserving `active` as the default for every ordinary
-- organization insert. This avoids pretending that provisioning is a later
-- active->provisioning transition.

create or replace function private.seed_organization_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  requested_status text := coalesce(
    nullif(current_setting('aios.organization_seed_status', true), ''),
    'active'
  );
  initial_status public.organization_lifecycle_status := 'active';
begin
  if requested_status = 'provisioning' then
    initial_status := 'provisioning';
  end if;
  insert into public.organization_lifecycle (organization_id, status)
  values (new.id, initial_status)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function private.seed_organization_lifecycle() from public;

create or replace function public.provision_organization_service(
  organization_name text,
  organization_slug text,
  owner_email text,
  invitation_token_hash text,
  actor_id uuid,
  provision_reason text
)
returns table (
  organization_id uuid,
  invitation_id uuid,
  lifecycle_status public.organization_lifecycle_status
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := btrim(coalesce(organization_name, ''));
  normalized_slug text := lower(btrim(coalesce(organization_slug, '')));
  normalized_email text := lower(btrim(coalesce(owner_email, '')));
  normalized_reason text := btrim(coalesce(provision_reason, ''));
  new_organization_id uuid;
  new_invitation_id uuid;
begin
  if not exists (
    select 1 from public.platform_admins administrator
    where administrator.user_id = actor_id
      and administrator.role = 'superadmin'
      and administrator.status = 'active'
  ) then
    raise exception 'An active platform superadmin is required.' using errcode = '42501';
  end if;
  if char_length(normalized_name) < 2 or char_length(normalized_name) > 120 then
    raise exception 'Agency name must contain 2 to 120 characters.' using errcode = '22023';
  end if;
  if normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(normalized_slug) > 120 then
    raise exception 'Agency slug is invalid.' using errcode = '22023';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or char_length(normalized_email) > 320 then
    raise exception 'Owner email is invalid.' using errcode = '22023';
  end if;
  if invitation_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invitation token hash is invalid.' using errcode = '22023';
  end if;
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A provisioning reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;

  perform set_config('aios.organization_seed_status', 'provisioning', true);
  insert into public.organizations (name, slug)
  values (normalized_name, normalized_slug)
  returning id into new_organization_id;
  perform set_config('aios.organization_seed_status', 'active', true);

  update public.organization_lifecycle lifecycle
  set reason = normalized_reason,
      changed_by = actor_id
  where lifecycle.organization_id = new_organization_id;

  insert into public.organization_invitations (
    organization_id, email, role, token_hash, invited_by
  ) values (
    new_organization_id, normalized_email, 'owner', invitation_token_hash, actor_id
  ) returning id into new_invitation_id;

  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id, 'agency.provisioned', 'organization', new_organization_id,
    jsonb_build_object(
      'status', 'provisioning',
      'invitationId', new_invitation_id,
      'reason', normalized_reason
    )
  );

  return query select
    new_organization_id,
    new_invitation_id,
    'provisioning'::public.organization_lifecycle_status;
end;
$$;

revoke all on function public.provision_organization_service(
  text, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.provision_organization_service(
  text, text, text, text, uuid, text
) to service_role;
