-- Durable, approval-gated outbound email delivery. A saved draft is not an
-- external effect; only an approved delivery record may be dispatched.

create table public.email_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  message_draft_id uuid not null,
  approval_request_id uuid not null,
  provider text check (provider is null or provider in ('resend', 'custom_smtp')),
  recipient text not null check (char_length(recipient) between 3 and 320),
  subject text not null check (char_length(subject) between 1 and 180),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  draft_revision_at timestamptz not null,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'sending', 'sent', 'failed', 'cancelled')),
  provider_message_id text,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (approval_request_id),
  unique (organization_id, message_draft_id, draft_revision_at),
  constraint email_message_deliveries_conversation_same_organization_fkey
    foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id)
    on delete cascade,
  constraint email_message_deliveries_draft_same_organization_fkey
    foreign key (organization_id, message_draft_id)
    references public.message_drafts (organization_id, id)
    on delete cascade,
  constraint email_message_deliveries_approval_same_organization_fkey
    foreign key (organization_id, approval_request_id)
    references public.approval_requests (organization_id, id)
    on delete cascade,
  constraint email_message_deliveries_state_check check (
    (status in ('pending_approval', 'sending')
      and sent_at is null
      and provider_message_id is null)
    or (status = 'sent'
      and sent_at is not null
      and provider_message_id is not null
      and provider is not null)
    or (status in ('failed', 'cancelled') and sent_at is null)
  )
);

create index email_message_deliveries_org_created_idx
  on public.email_message_deliveries (organization_id, created_at desc);
create index email_message_deliveries_pending_idx
  on public.email_message_deliveries (organization_id, status, created_at)
  where status in ('pending_approval', 'sending', 'failed');

create trigger email_message_deliveries_set_updated_at
  before update on public.email_message_deliveries
  for each row execute function public.set_updated_at();
create trigger email_message_deliveries_prevent_organization_move
  before update on public.email_message_deliveries
  for each row execute function private.prevent_organization_id_change();

alter table public.email_message_deliveries enable row level security;
revoke all on table public.email_message_deliveries
  from public, anon, authenticated, service_role;
grant select on table public.email_message_deliveries to authenticated;
grant select, insert, update on table public.email_message_deliveries to service_role;

create policy members_read_email_message_deliveries
  on public.email_message_deliveries for select to authenticated
  using (public.is_active_member(organization_id));

