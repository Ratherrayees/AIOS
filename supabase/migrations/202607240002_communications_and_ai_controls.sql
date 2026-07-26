-- Communications, approval, and AI control-plane tables.
-- Apply after 202607240001_initial_security.sql.

create type public.conversation_channel as enum ('email', 'whatsapp', 'web_form', 'phone', 'manual');
create type public.conversation_status as enum ('inbox', 'open', 'pending', 'closed');
create type public.message_direction as enum ('inbound', 'outbound', 'internal');
create type public.ai_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'cancelled', 'expired');

alter table public.deals
  add column source text,
  add column destination text,
  add column travel_start date,
  add column travel_end date,
  add column traveller_count integer check (traveller_count is null or traveller_count between 1 and 500),
  add column notes text;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  channel public.conversation_channel not null,
  external_id text,
  subject text,
  status public.conversation_status not null default 'inbox',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index conversations_external_identity_idx
  on public.conversations (organization_id, channel, external_id)
  where external_id is not null;
create index conversations_inbox_idx on public.conversations (organization_id, status, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  direction public.message_direction not null,
  external_id text,
  body text not null default '',
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index messages_external_identity_idx
  on public.messages (conversation_id, external_id)
  where external_id is not null;
create index messages_conversation_sent_idx on public.messages (conversation_id, sent_at);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  approver_id uuid references public.profiles(id) on delete set null,
  action text not null check (char_length(action) between 3 and 120),
  status public.approval_status not null default 'pending',
  entity_type text not null check (char_length(entity_type) between 1 and 120),
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  rationale text,
  resolved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index approval_requests_open_idx
  on public.approval_requests (organization_id, status, created_at desc)
  where status = 'pending';

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  initiated_by uuid references public.profiles(id) on delete set null,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  agent_type text not null check (char_length(agent_type) between 1 and 120),
  agent_version text not null check (char_length(agent_version) between 1 and 80),
  status public.ai_run_status not null default 'queued',
  input_reference jsonb not null default '{}'::jsonb,
  result jsonb,
  citations jsonb not null default '[]'::jsonb,
  error_code text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost numeric(12, 6) check (estimated_cost is null or estimated_cost >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ai_runs_organization_created_idx on public.ai_runs (organization_id, created_at desc);

create table public.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ai_run_id uuid not null references public.ai_runs(id) on delete cascade,
  tool_name text not null check (char_length(tool_name) between 1 and 120),
  requested_action text not null check (char_length(requested_action) between 1 and 120),
  decision text not null check (decision in ('allowed', 'approval_required', 'blocked', 'failed')),
  arguments jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now()
);

create index ai_tool_calls_run_idx on public.ai_tool_calls (ai_run_id, created_at);

create trigger conversations_set_updated_at before update on public.conversations for each row execute function public.set_updated_at();
create trigger approval_requests_set_updated_at before update on public.approval_requests for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.approval_requests enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_tool_calls enable row level security;

create policy "members may access conversations" on public.conversations for all to authenticated
  using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access messages" on public.messages for all to authenticated
  using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may read approval requests" on public.approval_requests for select to authenticated
  using (public.is_active_member(organization_id));
create policy "members may request approvals" on public.approval_requests for insert to authenticated
  with check (public.is_active_member(organization_id) and requester_id = auth.uid());
create policy "authorized roles may resolve approvals" on public.approval_requests for update to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations', 'finance']::public.app_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations', 'finance']::public.app_role[]));

-- AI execution records are visible to tenant members but server-only workers
-- create/update them. No authenticated client write policy is granted.
create policy "members may read ai runs" on public.ai_runs for select to authenticated
  using (public.is_active_member(organization_id));
create policy "members may read ai tool calls" on public.ai_tool_calls for select to authenticated
  using (public.is_active_member(organization_id));
