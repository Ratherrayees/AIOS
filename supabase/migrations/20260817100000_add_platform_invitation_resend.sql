-- Rotate an approved agency owner invitation without ever returning or storing
-- a reusable plaintext token. The previous pending token becomes invalid in
-- the same transaction that records its replacement.

create or replace function public.resend_organization_invitation_service(
  target_organization_id uuid,
  target_invitation_id uuid,
  replacement_token_hash text,
  actor_id uuid,
  resend_reason text
)
returns table (
  invitation_id uuid,
  invitation_email text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_invitation public.organization_invitations;
  new_invitation_id uuid;
  normalized_reason text := btrim(coalesce(resend_reason, ''));
begin
  if not exists (
    select 1 from public.platform_admins administrator
    where administrator.user_id = actor_id
      and administrator.role = 'superadmin'
      and administrator.status = 'active'
  ) then
    raise exception 'An active platform superadmin is required.' using errcode = '42501';
  end if;
  if replacement_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invitation token hash is invalid.' using errcode = '22023';
  end if;
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A resend reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;

  select invitation.* into current_invitation
  from public.organization_invitations invitation
  where invitation.id = target_invitation_id
    and invitation.organization_id = target_organization_id
    and invitation.role = 'owner'
    and invitation.status in ('pending', 'expired')
  for update;
  if not found then
    raise exception 'An approved owner invitation was not found.' using errcode = 'P0002';
  end if;

  if current_invitation.status = 'pending' then
    update public.organization_invitations
    set status = 'revoked', revoked_at = statement_timestamp()
    where id = current_invitation.id;
  end if;

  insert into public.organization_invitations (
    organization_id, email, role, token_hash, invited_by
  ) values (
    target_organization_id,
    current_invitation.email,
    'owner',
    replacement_token_hash,
    actor_id
  ) returning id into new_invitation_id;

  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id,
    'agency.owner_invitation.rotated',
    'organization',
    target_organization_id,
    jsonb_build_object(
      'previousInvitationId', target_invitation_id,
      'invitationId', new_invitation_id,
      'reason', normalized_reason
    )
  );

  return query select new_invitation_id, current_invitation.email;
end;
$$;

revoke all on function public.resend_organization_invitation_service(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.resend_organization_invitation_service(
  uuid, uuid, text, uuid, text
) to service_role;
