-- Atomically record an externally accepted email and append it to the Inbox.
-- Provider delivery happens before this call, so callers must use a provider
-- idempotency key derived from the durable delivery id.

create or replace function public.settle_email_message_delivery(
  target_organization_id uuid,
  target_delivery_id uuid,
  target_provider text,
  target_provider_message_id text,
  target_sender_address text,
  target_body text
)
returns public.email_message_deliveries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  delivery public.email_message_deliveries%rowtype;
  approval public.approval_requests%rowtype;
  outbound_message_id uuid;
begin
  if target_provider not in ('resend', 'custom_smtp') then
    raise exception 'Unsupported email provider.' using errcode = '22023';
  end if;
  if char_length(target_provider_message_id) not between 1 and 998
    or char_length(target_sender_address) not between 3 and 320
    or char_length(target_body) > 500000 then
    raise exception 'Invalid email delivery result.' using errcode = '22023';
  end if;

  select record.*
  into delivery
  from public.email_message_deliveries record
  where record.organization_id = target_organization_id
    and record.id = target_delivery_id
  for update;
  if not found then
    raise exception 'Email delivery is not available.' using errcode = 'P0002';
  end if;
  if delivery.status = 'sent' then
    return delivery;
  end if;
  if delivery.status <> 'sending' then
    raise exception 'Email delivery is not being dispatched.' using errcode = 'P0001';
  end if;

  select request.*
  into approval
  from public.approval_requests request
  where request.organization_id = target_organization_id
    and request.id = delivery.approval_request_id;
  if not found
    or approval.status <> 'approved'
    or approval.action <> 'external_message.send'
    or approval.entity_type <> 'message_draft'
    or approval.entity_id <> delivery.message_draft_id then
    raise exception 'The email delivery is not backed by a valid approval.'
      using errcode = '42501';
  end if;

  insert into public.messages (
    organization_id,
    conversation_id,
    author_id,
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
    delivery.conversation_id,
    delivery.sent_by,
    'outbound',
    target_provider_message_id,
    left(target_body, 500000),
    statement_timestamp(),
    target_provider,
    lower(btrim(target_sender_address)),
    array[lower(btrim(delivery.recipient))],
    delivery.subject,
    jsonb_build_object(
      'email_delivery_id', delivery.id,
      'approval_request_id', delivery.approval_request_id
    )
  )
  on conflict (conversation_id, external_id)
    where external_id is not null
  do update set external_id = excluded.external_id
  returning id into outbound_message_id;

  update public.conversations
  set
    status = 'pending',
    last_message_at = statement_timestamp()
  where organization_id = target_organization_id
    and id = delivery.conversation_id;

  update public.email_message_deliveries
  set
    provider = target_provider,
    provider_message_id = target_provider_message_id,
    status = 'sent',
    sent_at = statement_timestamp(),
    last_error_code = null
  where id = delivery.id
  returning * into delivery;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_organization_id,
    delivery.sent_by,
    'record.created',
    'message',
    outbound_message_id,
    jsonb_build_object(
      'event', 'email.outbound_sent',
      'delivery_id', delivery.id,
      'approval_id', delivery.approval_request_id,
      'provider', target_provider
    )
  );

  return delivery;
end;
$$;

revoke all on function public.settle_email_message_delivery(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.settle_email_message_delivery(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) to service_role;

