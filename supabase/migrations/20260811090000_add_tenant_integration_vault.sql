-- Tenant integration metadata and encrypted credentials. Plaintext credentials
-- are encrypted in the application with AES-256-GCM before they reach Postgres.
-- The Data API deliberately exposes no access to authenticated browser clients.

create table public.organization_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  category text not null
    check (category in ('email', 'payment', 'whatsapp', 'ai')),
  provider text not null
    check (provider in (
      'resend',
      'custom_smtp',
      'stripe',
      'razorpay',
      'whatsapp_cloud',
      'openai',
      'anthropic'
    )),
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
  unique (organization_id, provider),
  constraint organization_integrations_category_provider_check check (
    (category = 'email' and provider in ('resend', 'custom_smtp'))
    or (category = 'payment' and provider in ('stripe', 'razorpay'))
    or (category = 'whatsapp' and provider = 'whatsapp_cloud')
    or (category = 'ai' and provider in ('openai', 'anthropic'))
  ),
  constraint organization_integrations_test_state_check check (
    (connection_status = 'not_tested'
      and last_tested_at is null
      and last_test_message is null)
    or (connection_status in ('connected', 'failed')
      and last_tested_at is not null
      and last_test_message is not null)
  )
);

create index organization_integrations_organization_category_idx
  on public.organization_integrations (organization_id, category, provider);

create trigger organization_integrations_set_updated_at
  before update on public.organization_integrations
  for each row execute function public.set_updated_at();

alter table public.organization_integrations enable row level security;

-- Credentials must never be selected through the authenticated or anonymous
-- Data API. Server Actions re-authorize the user, then use a narrowly scoped
-- service client and return only masked metadata.
revoke all on table public.organization_integrations
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.organization_integrations
  to service_role;

