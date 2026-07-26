-- Store provider deliveries privately for idempotent, replay-safe webhook processing.
create table public.email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'resend' check (provider = 'resend'),
  provider_event_id text not null unique check (char_length(provider_event_id) between 1 and 256),
  event_type text not null check (char_length(event_type) between 1 and 128),
  event_created_at timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_reason text
);

create index email_webhook_events_event_type_created_at_idx
  on public.email_webhook_events (event_type, event_created_at desc);

alter table public.email_webhook_events enable row level security;

-- Webhook events contain delivery metadata and must be accessed only by
-- server-side infrastructure using the Supabase secret key. No Data API grants
-- or RLS policies are deliberately created for anon/authenticated users.
revoke all on table public.email_webhook_events from anon, authenticated;
