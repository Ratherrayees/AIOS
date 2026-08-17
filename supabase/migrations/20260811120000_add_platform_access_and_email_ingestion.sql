-- Platform access and tenant-owned email ingestion.
--
-- Platform roles are deliberately separate from agency memberships. A platform
-- administrator does not become a member of, or gain access to, tenant data.
-- Tenant mailbox credentials remain in the existing encrypted integration vault.

create type public.platform_role as enum ('superadmin', 'platform_admin');
create type public.platform_access_status as enum ('active', 'suspended');

create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.platform_role not null,
  status public.platform_access_status not null default 'active',
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function public.set_updated_at();

alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from public, anon, authenticated, service_role;
grant select on table public.platform_admins to authenticated;
grant select, insert, update, delete on table public.platform_admins to service_role;

create policy platform_admins_read_own_access
  on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.has_platform_role(
  permitted_roles public.platform_role[] default array[
    'superadmin',
    'platform_admin'
  ]::public.platform_role[]
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.platform_admins administrator
    where administrator.user_id = (select auth.uid())
      and administrator.status = 'active'
      and administrator.role = any(permitted_roles)
  );
$$;

revoke all on function public.has_platform_role(public.platform_role[])
  from public, anon;
grant execute on function public.has_platform_role(public.platform_role[])
  to authenticated;

create table public.platform_integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('resend', 'custom_smtp')),
  is_enabled boolean not null default false,
  public_config jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(public_config) = 'object'
      and octet_length(public_config::text) <= 16000
    ),
  encrypted_secrets text not null
    check (char_length(encrypted_secrets) between 40 and 20000),
  credential_hint text not null
    check (char_length(credential_hint) between 4 and 48),
  encryption_version smallint not null default 1
    check (encryption_version = 1),
  connection_status text not null default 'not_tested'
    check (connection_status in ('not_tested', 'connected', 'failed')),
  last_tested_at timestamptz,
  last_test_message text
    check (
      last_test_message is null
      or char_length(last_test_message) between 1 and 240
    ),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (provider),
  constraint platform_integrations_test_state_check check (
    (connection_status = 'not_tested'
      and last_tested_at is null
      and last_test_message is null)
    or (connection_status in ('connected', 'failed')
      and last_tested_at is not null
      and last_test_message is not null)
  )
);

create trigger platform_integrations_set_updated_at
  before update on public.platform_integrations
  for each row execute function public.set_updated_at();

alter table public.platform_integrations enable row level security;
revoke all on table public.platform_integrations
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.platform_integrations
  to service_role;

create table public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 120),
  entity_type text not null check (char_length(entity_type) between 1 and 120),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp()
);

create index platform_audit_events_created_at_idx
  on public.platform_audit_events (created_at desc);

alter table public.platform_audit_events enable row level security;
revoke all on table public.platform_audit_events
  from public, anon, authenticated, service_role;
grant select on table public.platform_audit_events to authenticated;
grant select, insert on table public.platform_audit_events to service_role;

create policy platform_administrators_read_platform_audit
  on public.platform_audit_events for select to authenticated
  using (public.has_platform_role());

-- Inbound provider events are private infrastructure records. Tenant members
-- see the resulting CRM messages, not raw webhook envelopes or mailbox state.
create table public.email_inbound_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('resend', 'custom_imap')),
  provider_event_id text not null
    check (char_length(provider_event_id) between 1 and 512),
  external_message_id text not null
    check (char_length(external_message_id) between 1 and 998),
  sender_email text not null
    check (char_length(sender_email) between 3 and 320),
  recipient_email text not null
    check (char_length(recipient_email) between 3 and 320),
  subject text check (subject is null or char_length(subject) <= 500),
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  conversation_id uuid,
  message_id uuid,
  payload jsonb not null default '{}'::jsonb
    check (octet_length(payload::text) <= 1000000),
  failure_reason text
    check (failure_reason is null or char_length(failure_reason) <= 500),
  received_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, provider, provider_event_id),
  unique (organization_id, provider, external_message_id)
);

create index email_inbound_events_org_received_idx
  on public.email_inbound_events (organization_id, received_at desc);

alter table public.email_inbound_events enable row level security;
revoke all on table public.email_inbound_events
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.email_inbound_events to service_role;

create table public.email_ingestion_checkpoints (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  provider text not null check (provider = 'custom_imap'),
  mailbox text not null check (char_length(mailbox) between 1 and 255),
  uid_validity text,
  last_uid bigint not null default 0 check (last_uid >= 0),
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, provider, mailbox)
);

create trigger email_ingestion_checkpoints_set_updated_at
  before update on public.email_ingestion_checkpoints
  for each row execute function public.set_updated_at();

alter table public.email_ingestion_checkpoints enable row level security;
revoke all on table public.email_ingestion_checkpoints
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.email_ingestion_checkpoints
  to service_role;

alter table public.messages
  add column provider text
    check (provider is null or provider in ('resend', 'custom_smtp', 'custom_imap')),
  add column sender_address text
    check (sender_address is null or char_length(sender_address) <= 320),
  add column recipient_addresses text[] not null default '{}'::text[],
  add column subject text check (subject is null or char_length(subject) <= 500),
  add column metadata jsonb not null default '{}'::jsonb
    check (octet_length(metadata::text) <= 64000);

alter table public.messages
  add constraint messages_organization_id_id_key unique (organization_id, id);

alter table public.email_inbound_events
  add constraint email_inbound_events_conversation_same_organization_fkey
    foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id)
    on delete set null (conversation_id),
  add constraint email_inbound_events_message_same_organization_fkey
    foreign key (organization_id, message_id)
    references public.messages (organization_id, id)
    on delete set null (message_id);

create unique index organization_integrations_resend_inbound_route_idx
  on public.organization_integrations ((public_config ->> 'inboundRouteKey'))
  where provider = 'resend'
    and public_config ? 'inboundRouteKey';

-- One atomic, idempotent path converts a verified provider event into a CRM
-- contact, conversation, and inbound message. Only the service role may call it.
create or replace function public.ingest_inbound_email(
  target_organization_id uuid,
  target_provider text,
  target_provider_event_id text,
  target_external_message_id text,
  target_thread_key text,
  target_sender_email text,
  target_sender_name text,
  target_recipient_email text,
  target_subject text,
  target_body text,
  target_received_at timestamptz,
  target_payload jsonb default '{}'::jsonb,
  target_metadata jsonb default '{}'::jsonb
)
returns table (
  inbound_event_id uuid,
  conversation_id uuid,
  message_id uuid,
  contact_id uuid,
  duplicate boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_sender text := lower(btrim(target_sender_email));
  normalized_recipient text := lower(btrim(target_recipient_email));
  contact_record_id uuid;
  conversation_record_id uuid;
  message_record_id uuid;
  event_record_id uuid;
  display_name text := nullif(btrim(target_sender_name), '');
begin
  if target_provider not in ('resend', 'custom_imap') then
    raise exception 'Unsupported inbound email provider.' using errcode = '22023';
  end if;
  if normalized_sender !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or normalized_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Inbound email addresses are invalid.' using errcode = '22023';
  end if;
  if char_length(target_body) > 500000 then
    raise exception 'Inbound email body exceeds the supported size.' using errcode = '22023';
  end if;

  insert into public.email_inbound_events (
    organization_id,
    provider,
    provider_event_id,
    external_message_id,
    sender_email,
    recipient_email,
    subject,
    payload,
    received_at
  ) values (
    target_organization_id,
    target_provider,
    target_provider_event_id,
    target_external_message_id,
    normalized_sender,
    normalized_recipient,
    nullif(left(coalesce(target_subject, ''), 500), ''),
    coalesce(target_payload, '{}'::jsonb),
    target_received_at
  )
  on conflict (organization_id, provider, provider_event_id) do nothing
  returning id into event_record_id;

  if event_record_id is null then
    return query
    select
      event.id,
      event.conversation_id,
      event.message_id,
      conversation.contact_id,
      true
    from public.email_inbound_events event
    left join public.conversations conversation
      on conversation.organization_id = event.organization_id
      and conversation.id = event.conversation_id
    where event.organization_id = target_organization_id
      and event.provider = target_provider
      and event.provider_event_id = target_provider_event_id;
    return;
  end if;

  select contact.id
  into contact_record_id
  from public.contacts contact
  where contact.organization_id = target_organization_id
    and lower(btrim(contact.email)) = normalized_sender
    and contact.archived_at is null
  order by contact.created_at
  limit 1;

  if contact_record_id is null then
    begin
      insert into public.contacts (
        organization_id,
        first_name,
        email
      ) values (
        target_organization_id,
        left(
          coalesce(
            display_name,
            nullif(split_part(normalized_sender, '@', 1), ''),
            'Email contact'
          ),
          100
        ),
        normalized_sender
      )
      returning id into contact_record_id;
    exception when unique_violation then
      select contact.id
      into contact_record_id
      from public.contacts contact
      where contact.organization_id = target_organization_id
        and lower(btrim(contact.email)) = normalized_sender
      order by contact.created_at
      limit 1;
    end;
  end if;

  insert into public.conversations (
    organization_id,
    contact_id,
    channel,
    external_id,
    subject,
    status,
    last_message_at
  ) values (
    target_organization_id,
    contact_record_id,
    'email',
    target_thread_key,
    nullif(left(coalesce(target_subject, ''), 500), ''),
    'inbox',
    target_received_at
  )
  on conflict (organization_id, channel, external_id)
    where external_id is not null
  do update set
    contact_id = coalesce(public.conversations.contact_id, excluded.contact_id),
    subject = coalesce(excluded.subject, public.conversations.subject),
    status = 'inbox',
    last_message_at = greatest(
      coalesce(public.conversations.last_message_at, excluded.last_message_at),
      excluded.last_message_at
    )
  returning id into conversation_record_id;

  insert into public.messages (
    organization_id,
    conversation_id,
    direction,
    external_id,
    body,
    sent_at,
    provider,
    sender_address,
    recipient_addresses,
    subject,
    metadata
  ) values (
    target_organization_id,
    conversation_record_id,
    'inbound',
    target_external_message_id,
    left(target_body, 500000),
    target_received_at,
    target_provider,
    normalized_sender,
    array[normalized_recipient],
    nullif(left(coalesce(target_subject, ''), 500), ''),
    coalesce(target_metadata, '{}'::jsonb)
  )
  on conflict (conversation_id, external_id)
    where external_id is not null
  do nothing
  returning id into message_record_id;

  if message_record_id is null then
    select message.id
    into message_record_id
    from public.messages message
    where message.conversation_id = conversation_record_id
      and message.external_id = target_external_message_id;
  end if;

  update public.email_inbound_events
  set
    status = 'processed',
    conversation_id = conversation_record_id,
    message_id = message_record_id,
    processed_at = statement_timestamp()
  where id = event_record_id;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_organization_id,
    null,
    'record.created',
    'message',
    message_record_id,
    jsonb_build_object(
      'event', 'email.inbound_received',
      'provider', target_provider,
      'conversation_id', conversation_record_id,
      'provider_event_id', target_provider_event_id
    )
  );

  return query
  select
    event_record_id,
    conversation_record_id,
    message_record_id,
    contact_record_id,
    false;
end;
$$;

revoke all on function public.ingest_inbound_email(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_inbound_email(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to service_role;
