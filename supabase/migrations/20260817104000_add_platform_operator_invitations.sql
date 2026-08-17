-- Platform-only operator invitations.
--
-- The bearer token is stored only as SHA-256. Management RPCs are service-role
-- only and independently require an active superadmin actor; the application
-- additionally requires an authenticated aal2 session. Acceptance is a single
-- authenticated transaction requiring verified email, verified TOTP, and aal2.

create table public.platform_operator_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null
    check (
      email = lower(btrim(email))
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and char_length(email) <= 320
    ),
  role public.platform_role not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  reason text not null check (char_length(reason) between 12 and 500),
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_reason text check (
    revoked_reason is null or char_length(revoked_reason) between 12 and 500
  ),
  expires_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint platform_operator_invitations_expiry_check
    check (expires_at > created_at),
  constraint platform_operator_invitations_state_check check (
    (status = 'pending'
      and accepted_at is null
      and accepted_by is null
      and revoked_at is null
      and revoked_by is null
      and revoked_reason is null)
    or (status = 'accepted'
      and accepted_at is not null
      and revoked_at is null
      and revoked_by is null
      and revoked_reason is null)
    or (status = 'revoked'
      and accepted_at is null
      and accepted_by is null
      and revoked_at is not null
      and revoked_reason is not null)
  )
);

create trigger platform_operator_invitations_set_updated_at
  before update on public.platform_operator_invitations
  for each row execute function public.set_updated_at();

create unique index platform_operator_invitations_pending_email_idx
  on public.platform_operator_invitations (email)
  where status = 'pending';
create index platform_operator_invitations_created_idx
  on public.platform_operator_invitations (created_at desc);
create index platform_operator_invitations_expiry_idx
  on public.platform_operator_invitations (expires_at)
  where status = 'pending';

alter table public.platform_operator_invitations enable row level security;
revoke all on table public.platform_operator_invitations
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.platform_operator_invitations
  to service_role;

create or replace function private.validate_platform_invitation_input(
  invitation_email text,
  invitation_token_hash text,
  invitation_reason text,
  invitation_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_email text := lower(btrim(coalesce(invitation_email, '')));
  normalized_reason text := btrim(coalesce(invitation_reason, ''));
begin
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or char_length(normalized_email) > 320 then
    raise exception 'Invitation email is invalid.' using errcode = '22023';
  end if;
  if invitation_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invitation token hash is invalid.' using errcode = '22023';
  end if;
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'An invitation reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;
  if invitation_expires_at <= statement_timestamp() + interval '15 minutes'
    or invitation_expires_at > statement_timestamp() + interval '14 days' then
    raise exception 'Invitation expiry must be between 15 minutes and 14 days.'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.validate_platform_invitation_input(
  text, text, text, timestamptz
) from public;

create or replace function public.create_platform_operator_invitation_service(
  invitation_email text,
  target_role public.platform_role,
  invitation_token_hash text,
  actor_id uuid,
  invitation_reason text,
  invitation_expires_at timestamptz
)
returns public.platform_operator_invitations
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  normalized_email text := lower(btrim(coalesce(invitation_email, '')));
  normalized_reason text := btrim(coalesce(invitation_reason, ''));
  new_invitation public.platform_operator_invitations;
begin
  perform private.require_platform_access_actor(actor_id);
  perform private.validate_platform_invitation_input(
    normalized_email,
    invitation_token_hash,
    normalized_reason,
    invitation_expires_at
  );
  perform pg_advisory_xact_lock(hashtext('aios:platform:invite:' || normalized_email));

  if exists (
    select 1
    from auth.users identity
    join public.platform_admins administrator on administrator.user_id = identity.id
    where lower(btrim(identity.email)) = normalized_email
  ) then
    raise exception 'That account already has a platform access record. Review its access instead.'
      using errcode = '23505';
  end if;
  if exists (
    select 1 from public.platform_operator_invitations invitation
    where invitation.email = normalized_email and invitation.status = 'pending'
  ) then
    raise exception 'A pending platform invitation already exists for that email.'
      using errcode = '23505';
  end if;

  insert into public.platform_operator_invitations (
    email,
    role,
    token_hash,
    reason,
    invited_by,
    expires_at
  ) values (
    normalized_email,
    target_role,
    invitation_token_hash,
    normalized_reason,
    actor_id,
    invitation_expires_at
  ) returning * into new_invitation;

  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id,
    'platform.operator_invitation.created',
    'platform_operator_invitation',
    new_invitation.id,
    jsonb_build_object(
      'role', new_invitation.role,
      'status', new_invitation.status,
      'expiresAt', new_invitation.expires_at,
      'version', new_invitation.version,
      'reason', normalized_reason
    ) || coalesce(private.platform_actor_snapshot(actor_id), '{}'::jsonb)
  );
  return new_invitation;
end;
$$;

create or replace function public.resend_platform_operator_invitation_service(
  target_invitation_id uuid,
  replacement_token_hash text,
  actor_id uuid,
  resend_reason text,
  replacement_expires_at timestamptz,
  expected_version bigint
)
returns public.platform_operator_invitations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_invitation public.platform_operator_invitations;
  new_invitation public.platform_operator_invitations;
  normalized_reason text := btrim(coalesce(resend_reason, ''));
begin
  perform private.require_platform_access_actor(actor_id);

  select invitation.* into current_invitation
  from public.platform_operator_invitations invitation
  where invitation.id = target_invitation_id
  for update;
  if not found or current_invitation.status <> 'pending' then
    raise exception 'A pending platform invitation was not found.' using errcode = 'P0002';
  end if;
  if current_invitation.version <> expected_version then
    raise exception 'Platform invitation changed. Refresh and try again.'
      using errcode = '40001';
  end if;
  perform private.validate_platform_invitation_input(
    current_invitation.email,
    replacement_token_hash,
    normalized_reason,
    replacement_expires_at
  );

  update public.platform_operator_invitations invitation
  set status = 'revoked',
      revoked_by = actor_id,
      revoked_at = statement_timestamp(),
      revoked_reason = normalized_reason,
      version = invitation.version + 1
  where invitation.id = current_invitation.id
    and invitation.version = expected_version;

  insert into public.platform_operator_invitations (
    email,
    role,
    token_hash,
    reason,
    invited_by,
    expires_at
  ) values (
    current_invitation.email,
    current_invitation.role,
    replacement_token_hash,
    current_invitation.reason,
    actor_id,
    replacement_expires_at
  ) returning * into new_invitation;

  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id,
    'platform.operator_invitation.rotated',
    'platform_operator_invitation',
    new_invitation.id,
    jsonb_build_object(
      'previousInvitationId', current_invitation.id,
      'invitationId', new_invitation.id,
      'role', new_invitation.role,
      'expiresAt', new_invitation.expires_at,
      'version', new_invitation.version,
      'reason', normalized_reason
    ) || coalesce(private.platform_actor_snapshot(actor_id), '{}'::jsonb)
  );
  return new_invitation;
end;
$$;

create or replace function public.revoke_platform_operator_invitation_service(
  target_invitation_id uuid,
  actor_id uuid,
  revoke_reason text,
  expected_version bigint
)
returns public.platform_operator_invitations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated_invitation public.platform_operator_invitations;
  normalized_reason text := btrim(coalesce(revoke_reason, ''));
begin
  perform private.require_platform_access_actor(actor_id);
  if char_length(normalized_reason) < 12 or char_length(normalized_reason) > 500 then
    raise exception 'A revoke reason between 12 and 500 characters is required.'
      using errcode = '22023';
  end if;

  update public.platform_operator_invitations invitation
  set status = 'revoked',
      revoked_by = actor_id,
      revoked_at = statement_timestamp(),
      revoked_reason = normalized_reason,
      version = invitation.version + 1
  where invitation.id = target_invitation_id
    and invitation.status = 'pending'
    and invitation.version = expected_version
  returning invitation.* into updated_invitation;
  if not found then
    raise exception 'Platform invitation changed or is no longer pending. Refresh and try again.'
      using errcode = '40001';
  end if;

  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    actor_id,
    'platform.operator_invitation.revoked',
    'platform_operator_invitation',
    updated_invitation.id,
    jsonb_build_object(
      'role', updated_invitation.role,
      'status', updated_invitation.status,
      'version', updated_invitation.version,
      'reason', normalized_reason
    ) || coalesce(private.platform_actor_snapshot(actor_id), '{}'::jsonb)
  );
  return updated_invitation;
end;
$$;

create or replace function public.get_platform_operator_invitation_snapshot(
  invitation_token_hash text
)
returns table (
  email_hint text,
  invitation_role public.platform_role,
  invitation_status text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    left(split_part(invitation.email, '@', 1), 2)
      || repeat('•', greatest(3, char_length(split_part(invitation.email, '@', 1)) - 2))
      || '@' || split_part(invitation.email, '@', 2),
    invitation.role,
    case
      when invitation.status = 'pending'
        and invitation.expires_at <= statement_timestamp() then 'expired'
      else invitation.status
    end,
    invitation.expires_at
  from public.platform_operator_invitations invitation
  where invitation.token_hash = encode(
      extensions.digest(convert_to(invitation_token_hash, 'UTF8'), 'sha256'),
      'hex'
    )
    and invitation_token_hash ~ '^[A-Za-z0-9_-]{43}$';
$$;

create or replace function public.accept_platform_operator_invitation(
  invitation_token_hash text
)
returns table (
  user_id uuid,
  platform_role public.platform_role,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  accepting_user_id uuid := (select auth.uid());
  accepting_email text;
  accepting_email_confirmed_at timestamptz;
  accepting_identity_control public.identity_security_controls;
  invitation_record public.platform_operator_invitations;
  accepted_timestamp timestamptz := statement_timestamp();
  issued_at_claim text := auth.jwt() ->> 'iat';
  issued_at_timestamp timestamptz;
begin
  if accepting_user_id is null then
    raise exception 'Sign in is required to accept this invitation.'
      using errcode = '42501', detail = 'platform_invite_auth_required';
  end if;
  if invitation_token_hash is null or invitation_token_hash !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'This invitation link is invalid.'
      using errcode = '22023', detail = 'platform_invite_invalid';
  end if;
  if issued_at_claim is null or issued_at_claim !~ '^[0-9]+$' then
    raise exception 'The current session cannot be verified.'
      using errcode = '42501', detail = 'platform_invite_session_invalid';
  end if;
  issued_at_timestamp := to_timestamp(issued_at_claim::double precision);
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Multi-factor verification is required.'
      using errcode = '42501', detail = 'platform_invite_aal2_required';
  end if;
  if not exists (
    select 1 from auth.mfa_factors factor
    where factor.user_id = accepting_user_id
      and factor.factor_type = 'totp'
      and factor.status = 'verified'
  ) then
    raise exception 'A verified authenticator is required.'
      using errcode = '42501', detail = 'platform_invite_totp_required';
  end if;
  select control.* into accepting_identity_control
  from public.identity_security_controls control
  where control.user_id = accepting_user_id;
  if not found
    or accepting_identity_control.status <> 'active'
    or accepting_identity_control.password_reset_required
    or issued_at_timestamp <= accepting_identity_control.sessions_valid_after then
    raise exception 'This account is not eligible for platform access.'
      using errcode = '42501', detail = 'platform_invite_identity_ineligible';
  end if;

  select lower(btrim(identity.email)), identity.email_confirmed_at
  into accepting_email, accepting_email_confirmed_at
  from auth.users identity
  where identity.id = accepting_user_id;
  if accepting_email is null or accepting_email_confirmed_at is null then
    raise exception 'A verified email address is required.'
      using errcode = '42501', detail = 'platform_invite_email_unverified';
  end if;

  select invitation.* into invitation_record
  from public.platform_operator_invitations invitation
  where invitation.token_hash = encode(
    extensions.digest(convert_to(invitation_token_hash, 'UTF8'), 'sha256'),
    'hex'
  )
  for update;
  if not found or invitation_record.status <> 'pending' then
    raise exception 'This invitation is no longer available.'
      using errcode = 'P0002', detail = 'platform_invite_terminal';
  end if;
  if invitation_record.expires_at <= accepted_timestamp then
    raise exception 'This invitation has expired.'
      using errcode = '22023', detail = 'platform_invite_expired';
  end if;
  if invitation_record.email <> accepting_email then
    raise exception 'This invitation belongs to a different verified email.'
      using errcode = '42501', detail = 'platform_invite_wrong_email';
  end if;
  if invitation_record.invited_by is null or not exists (
    select 1
    from public.platform_admins administrator
    join public.identity_security_controls control
      on control.user_id = administrator.user_id
    where administrator.user_id = invitation_record.invited_by
      and administrator.role = 'superadmin'
      and administrator.status = 'active'
      and control.status = 'active'
      and not control.password_reset_required
  ) then
    raise exception 'The inviting superadmin is no longer authorized. Ask another superadmin to resend this invitation.'
      using errcode = '42501', detail = 'platform_invite_inviter_inactive';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('aios:platform:access:' || accepting_user_id::text)
  );
  if exists (
    select 1 from public.platform_admins administrator
    where administrator.user_id = accepting_user_id
  ) then
    raise exception 'This account already has a platform access record.'
      using errcode = '23505', detail = 'platform_invite_existing_access';
  end if;

  insert into public.platform_admins (
    user_id, role, status, granted_by, version
  ) values (
    accepting_user_id,
    invitation_record.role,
    'active',
    invitation_record.invited_by,
    1
  );

  update public.platform_operator_invitations invitation
  set status = 'accepted',
      accepted_by = accepting_user_id,
      accepted_at = accepted_timestamp,
      version = invitation.version + 1
  where invitation.id = invitation_record.id
    and invitation.status = 'pending';

  insert into public.platform_audit_events (
    actor_id, event_type, entity_type, entity_id, metadata
  ) values
  (
    accepting_user_id,
    'platform.operator_invitation.accepted',
    'platform_operator_invitation',
    invitation_record.id,
    jsonb_build_object(
      'role', invitation_record.role,
      'status', 'accepted',
      'version', invitation_record.version + 1
    ) || coalesce(private.platform_actor_snapshot(accepting_user_id), '{}'::jsonb)
  ),
  (
    invitation_record.invited_by,
    'access.granted',
    'platform_admin',
    accepting_user_id,
    jsonb_build_object(
      'role', invitation_record.role,
      'status', 'active',
      'version', 1,
      'reason', invitation_record.reason,
      'invitationId', invitation_record.id,
      'source', 'platform_operator_invitation'
    ) || coalesce(
      private.platform_actor_snapshot(invitation_record.invited_by),
      '{}'::jsonb
    )
  );

  return query select accepting_user_id, invitation_record.role, accepted_timestamp;
end;
$$;

revoke all on function public.create_platform_operator_invitation_service(
  text, public.platform_role, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_platform_operator_invitation_service(
  text, public.platform_role, text, uuid, text, timestamptz
) to service_role;

revoke all on function public.resend_platform_operator_invitation_service(
  uuid, text, uuid, text, timestamptz, bigint
) from public, anon, authenticated;
grant execute on function public.resend_platform_operator_invitation_service(
  uuid, text, uuid, text, timestamptz, bigint
) to service_role;

revoke all on function public.revoke_platform_operator_invitation_service(
  uuid, uuid, text, bigint
) from public, anon, authenticated;
grant execute on function public.revoke_platform_operator_invitation_service(
  uuid, uuid, text, bigint
) to service_role;

revoke all on function public.get_platform_operator_invitation_snapshot(text)
  from public;
grant execute on function public.get_platform_operator_invitation_snapshot(text)
  to anon, authenticated;

revoke all on function public.accept_platform_operator_invitation(text)
  from public, anon;
grant execute on function public.accept_platform_operator_invitation(text)
  to authenticated;

comment on table public.platform_operator_invitations is
  'Platform-control-plane invitations only. Rows never create an organization or agency membership.';
comment on function public.accept_platform_operator_invitation(text) is
  'Consumes one verified-email platform invitation at aal2 with verified TOTP and atomically grants platform-only authority.';
