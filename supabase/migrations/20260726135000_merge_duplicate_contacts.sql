-- Human-reviewed contact merge. The selected primary survives, dependent rows
-- are re-linked atomically, and the duplicate is archived rather than deleted.

create or replace function public.merge_duplicate_contacts(
  target_organization_id uuid,
  primary_contact_id uuid,
  duplicate_contact_id uuid
)
returns table (
  surviving_contact_id uuid,
  archived_contact_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  primary_contact public.contacts%rowtype;
  duplicate_contact public.contacts%rowtype;
begin
  if actor_id is null then
    raise exception 'Sign in is required.'
      using errcode = '42501';
  end if;
  if primary_contact_id = duplicate_contact_id then
    raise exception 'Choose two different contacts.'
      using errcode = '22023';
  end if;
  if not public.meets_mfa_requirement() then
    raise exception 'Multi-factor verification is required.'
      using errcode = '42501';
  end if;
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'operations']::public.app_role[]
  ) then
    raise exception 'You do not have permission to merge contacts.'
      using errcode = '42501';
  end if;

  select contact.*
  into primary_contact
  from public.contacts contact
  where contact.id = primary_contact_id
    and contact.organization_id = target_organization_id
    and contact.archived_at is null
  for update;
  if not found then
    raise exception 'The primary contact is not available.'
      using errcode = 'P0002';
  end if;

  select contact.*
  into duplicate_contact
  from public.contacts contact
  where contact.id = duplicate_contact_id
    and contact.organization_id = target_organization_id
    and contact.archived_at is null
  for update;
  if not found then
    raise exception 'The duplicate contact is not available.'
      using errcode = 'P0002';
  end if;

  -- Release a duplicate email identity before copying it to an empty primary.
  update public.contacts
  set
    email = null,
    archived_at = statement_timestamp()
  where id = duplicate_contact.id;

  update public.contacts
  set
    last_name = coalesce(
      nullif(btrim(primary_contact.last_name), ''),
      nullif(btrim(duplicate_contact.last_name), '')
    ),
    email = coalesce(
      nullif(btrim(primary_contact.email), ''),
      nullif(btrim(duplicate_contact.email), '')
    ),
    phone = coalesce(
      nullif(btrim(primary_contact.phone), ''),
      nullif(btrim(duplicate_contact.phone), '')
    ),
    company_id = coalesce(
      primary_contact.company_id,
      duplicate_contact.company_id
    ),
    owner_id = coalesce(
      primary_contact.owner_id,
      duplicate_contact.owner_id
    ),
    communication_consent = case
      when primary_contact.communication_consent = 'unknown'
        then duplicate_contact.communication_consent
      else primary_contact.communication_consent
    end,
    consent_recorded_at = case
      when primary_contact.communication_consent = 'unknown'
        then duplicate_contact.consent_recorded_at
      else primary_contact.consent_recorded_at
    end,
    consent_source = case
      when primary_contact.communication_consent = 'unknown'
        then duplicate_contact.consent_source
      else primary_contact.consent_source
    end,
    preferred_locale = coalesce(
      primary_contact.preferred_locale,
      duplicate_contact.preferred_locale
    ),
    time_zone = coalesce(
      primary_contact.time_zone,
      duplicate_contact.time_zone
    )
  where id = primary_contact.id;

  update public.deals
    set contact_id = primary_contact.id
    where organization_id = target_organization_id
      and contact_id = duplicate_contact.id;
  update public.tasks
    set contact_id = primary_contact.id
    where organization_id = target_organization_id
      and contact_id = duplicate_contact.id;
  update public.activity_events
    set contact_id = primary_contact.id
    where organization_id = target_organization_id
      and contact_id = duplicate_contact.id;
  update public.conversations
    set contact_id = primary_contact.id
    where organization_id = target_organization_id
      and contact_id = duplicate_contact.id;
  update public.travelers
    set contact_id = primary_contact.id
    where organization_id = target_organization_id
      and contact_id = duplicate_contact.id;
  update public.documents
    set contact_id = primary_contact.id
    where organization_id = target_organization_id
      and contact_id = duplicate_contact.id;

  insert into public.activity_events (
    organization_id,
    contact_id,
    actor_id,
    activity_type,
    body,
    metadata
  )
  values (
    target_organization_id,
    primary_contact.id,
    actor_id,
    'contact_merged',
    'A reviewed duplicate contact was merged into this record.',
    jsonb_build_object('archived_contact_id', duplicate_contact.id)
  );

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_organization_id,
    actor_id,
    'record.updated',
    'contact',
    primary_contact.id,
    jsonb_build_object(
      'event',
      'contact.merged',
      'archived_contact_id',
      duplicate_contact.id
    )
  );

  return query
  select primary_contact.id, duplicate_contact.id;
end;
$$;

revoke all on function public.merge_duplicate_contacts(uuid, uuid, uuid)
  from public;
grant execute on function public.merge_duplicate_contacts(uuid, uuid, uuid)
  to authenticated;
