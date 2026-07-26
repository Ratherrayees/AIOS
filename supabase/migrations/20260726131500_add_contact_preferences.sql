-- Jurisdiction-neutral communication preferences. These fields record what a
-- contact stated and when; they are not a substitute for a legal-basis review.

create type public.contact_consent_status
  as enum ('unknown', 'granted', 'withdrawn');
create type public.contact_channel_preference
  as enum ('email', 'phone', 'whatsapp', 'none');

alter table public.contacts
  add column communication_consent public.contact_consent_status
    not null default 'unknown',
  add column consent_recorded_at timestamptz,
  add column consent_source text,
  add column preferred_channel public.contact_channel_preference
    not null default 'email',
  add column preferred_locale text,
  add column time_zone text,
  add constraint contacts_consent_source_length
    check (
      consent_source is null
      or char_length(btrim(consent_source)) between 2 and 120
    ),
  add constraint contacts_preferred_locale_length
    check (
      preferred_locale is null
      or char_length(btrim(preferred_locale)) between 2 and 35
    ),
  add constraint contacts_time_zone_length
    check (
      time_zone is null
      or char_length(btrim(time_zone)) between 1 and 80
    ),
  add constraint contacts_consent_evidence_is_coherent
    check (
      (
        communication_consent = 'unknown'
        and consent_recorded_at is null
        and consent_source is null
      )
      or (
        communication_consent in ('granted', 'withdrawn')
        and consent_recorded_at is not null
        and consent_source is not null
      )
    );

create index contacts_organization_consent_idx
  on public.contacts (organization_id, communication_consent);
