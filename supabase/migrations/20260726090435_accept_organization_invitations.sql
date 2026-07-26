-- Invitation acceptance is a single, narrowly scoped security-definer
-- transaction. The caller must be authenticated with the same verified email
-- that was invited. Membership activation and invitation consumption cannot
-- be separated or raced.

create or replace function public.accept_organization_invitation(
  invitation_token_hash text
)
returns table (
  organization_id uuid,
  organization_name text,
  membership_role public.app_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepting_user_id uuid := (select auth.uid());
  accepting_email text;
  email_confirmed_at timestamptz;
  invitation_record public.organization_invitations%rowtype;
  membership_record public.memberships%rowtype;
begin
  if accepting_user_id is null then
    raise exception 'Sign in is required to accept an invitation.';
  end if;

  if invitation_token_hash is null
    or invitation_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'This invitation link is invalid.';
  end if;

  select lower(btrim(users.email)), users.email_confirmed_at
  into accepting_email, email_confirmed_at
  from auth.users as users
  where users.id = accepting_user_id;

  if accepting_email is null or email_confirmed_at is null then
    raise exception 'A verified email address is required.';
  end if;

  select invitation.*
  into invitation_record
  from public.organization_invitations as invitation
  where invitation.token_hash = invitation_token_hash
  for update of invitation;

  if not found or invitation_record.status <> 'pending' then
    raise exception 'This invitation is no longer available.';
  end if;

  if invitation_record.expires_at <= statement_timestamp() then
    raise exception 'This invitation has expired.';
  end if;

  if lower(btrim(invitation_record.email)) <> accepting_email then
    raise exception 'This invitation belongs to a different email address.';
  end if;

  select membership.*
  into membership_record
  from public.memberships as membership
  where membership.organization_id = invitation_record.organization_id
    and membership.user_id = accepting_user_id
  for update of membership;

  if found then
    if membership_record.status = 'active' then
      raise exception 'This account is already an active workspace member.';
    end if;
    if membership_record.status = 'suspended' then
      raise exception 'A suspended membership must be restored by an owner.';
    end if;

    update public.memberships
    set
      role = invitation_record.role,
      status = 'active'
    where id = membership_record.id;
  else
    insert into public.memberships (
      organization_id,
      user_id,
      role,
      status
    )
    values (
      invitation_record.organization_id,
      accepting_user_id,
      invitation_record.role,
      'active'
    );
  end if;

  update public.organization_invitations
  set
    status = 'accepted',
    accepted_by = accepting_user_id,
    accepted_at = statement_timestamp()
  where id = invitation_record.id;

  return query
  select
    invitation_record.organization_id,
    organization.name,
    invitation_record.role
  from public.organizations as organization
  where organization.id = invitation_record.organization_id;
end;
$$;

revoke all on function public.accept_organization_invitation(text)
  from public;
grant execute on function public.accept_organization_invitation(text)
  to authenticated;
