-- Convert an accepted exact-version customer payment schedule into internal
-- receivable obligations. This never issues or delivers an invoice, charges a
-- customer, records settlement, creates a booking, or marks a deal Won.

alter table public.quote_acceptances
  add constraint quote_acceptances_exact_identity_key
  unique (organization_id, quote_id, quote_version_id, id);

alter table public.quote_payment_schedules
  add constraint quote_payment_schedules_exact_identity_key
  unique (organization_id, quote_id, quote_version_id, id);

alter table public.payments
  add column quote_id uuid,
  add column quote_version_id uuid,
  add column quote_acceptance_id uuid,
  add column quote_payment_schedule_id uuid,
  add column quote_schedule_item_position smallint,
  add constraint payments_quote_receivable_provenance_check
    check (
      (
        quote_id is null
        and quote_version_id is null
        and quote_acceptance_id is null
        and quote_payment_schedule_id is null
        and quote_schedule_item_position is null
      )
      or
      (
        quote_id is not null
        and quote_version_id is not null
        and quote_acceptance_id is not null
        and quote_payment_schedule_id is not null
        and quote_schedule_item_position between 0 and 11
        and direction = 'receivable'
        and supplier_id is null
        and invoice_number is null
      )
    ),
  add constraint payments_quote_acceptance_exact_version_fkey
    foreign key (
      organization_id,
      quote_id,
      quote_version_id,
      quote_acceptance_id
    )
    references public.quote_acceptances (
      organization_id,
      quote_id,
      quote_version_id,
      id
    )
    on delete restrict,
  add constraint payments_quote_schedule_exact_version_fkey
    foreign key (
      organization_id,
      quote_id,
      quote_version_id,
      quote_payment_schedule_id
    )
    references public.quote_payment_schedules (
      organization_id,
      quote_id,
      quote_version_id,
      id
    )
    on delete restrict;

create unique index payments_quote_receivable_milestone_idx
  on public.payments (
    organization_id,
    quote_acceptance_id,
    quote_schedule_item_position
  )
  where quote_acceptance_id is not null;

create index payments_quote_receivable_status_idx
  on public.payments (organization_id, quote_id, status, due_at)
  where quote_acceptance_id is not null;

create or replace function public.create_accepted_quote_receivables(
  target_organization_id uuid,
  target_quote_id uuid
)
returns table (
  quote_id uuid,
  quote_acceptance_id uuid,
  quote_payment_schedule_id uuid,
  receivable_count integer,
  total_amount numeric,
  currency text,
  already_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  quote_record public.quotes%rowtype;
  acceptance_record public.quote_acceptances%rowtype;
  schedule_record public.quote_payment_schedules%rowtype;
  schedule_item record;
  existing_count integer := 0;
  existing_total numeric := 0;
  existing_distinct_positions integer := 0;
  existing_min_position integer;
  existing_max_position integer;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'finance']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to create quote receivables.'
      using errcode = '42501';
  end if;

  select quote.*
  into quote_record
  from public.quotes quote
  where quote.organization_id = target_organization_id
    and quote.id = target_quote_id
  for update;

  if not found then
    raise exception 'This quote is not available.'
      using errcode = 'P0002';
  end if;
  if quote_record.status <> 'accepted' or quote_record.accepted_at is null then
    raise exception 'Only an accepted quote can create receivables.'
      using errcode = '22023';
  end if;

  select acceptance.*
  into acceptance_record
  from public.quote_acceptances acceptance
  where acceptance.organization_id = target_organization_id
    and acceptance.quote_id = quote_record.id
  for update;

  if not found
    or acceptance_record.quote_version_id is null
    or acceptance_record.quote_version_id <> (
      select version.id
      from public.quote_versions version
      where version.organization_id = target_organization_id
        and version.quote_id = quote_record.id
        and version.version = quote_record.current_version
    )
  then
    raise exception 'Exact current-version acceptance evidence is required.'
      using errcode = '22023';
  end if;

  select schedule.*
  into schedule_record
  from public.quote_payment_schedules schedule
  where schedule.organization_id = target_organization_id
    and schedule.quote_id = quote_record.id
    and schedule.quote_version_id = acceptance_record.quote_version_id
    and schedule.status = 'active'
  for update;

  if not found
    or round(schedule_record.total_amount, 2) <> round((
      select version.total_amount
      from public.quote_versions version
      where version.organization_id = target_organization_id
        and version.quote_id = quote_record.id
        and version.id = acceptance_record.quote_version_id
    ), 2)
  then
    raise exception 'An exact reconciled payment schedule is required.'
      using errcode = '22023';
  end if;

  select
    count(*)::integer,
    coalesce(sum(payment.amount), 0),
    count(distinct payment.quote_schedule_item_position)::integer,
    min(payment.quote_schedule_item_position),
    max(payment.quote_schedule_item_position)
  into
    existing_count,
    existing_total,
    existing_distinct_positions,
    existing_min_position,
    existing_max_position
  from public.payments payment
  where payment.organization_id = target_organization_id
    and payment.quote_acceptance_id = acceptance_record.id;

  if existing_count > 0 then
    if existing_count <> schedule_record.item_count
      or existing_distinct_positions <> schedule_record.item_count
      or existing_min_position <> 0
      or existing_max_position <> schedule_record.item_count - 1
      or round(existing_total, 2) <> round(schedule_record.total_amount, 2)
    then
      raise exception 'Existing quote receivables do not reconcile.'
        using errcode = '23514';
    end if;

    return query select
      quote_record.id,
      acceptance_record.id,
      schedule_record.id,
      existing_count,
      schedule_record.total_amount,
      schedule_record.currency::text,
      true;
    return;
  end if;

  for schedule_item in
    select item.value, item.ordinality - 1 as position
    from jsonb_array_elements(schedule_record.items)
      with ordinality as item(value, ordinality)
  loop
    insert into public.payments (
      organization_id,
      deal_id,
      direction,
      status,
      title,
      invoice_number,
      description,
      amount,
      paid_amount,
      currency,
      due_at,
      created_by,
      quote_id,
      quote_version_id,
      quote_acceptance_id,
      quote_payment_schedule_id,
      quote_schedule_item_position
    ) values (
      target_organization_id,
      quote_record.deal_id,
      'receivable',
      (
        case
          when (schedule_item.value ->> 'due_date')::date < current_date
            then 'overdue'
          else 'pending'
        end
      )::public.payment_status,
      schedule_item.value ->> 'label',
      null,
      format(
        'Accepted quote version %s · payment schedule revision %s',
        quote_record.current_version,
        schedule_record.revision
      ),
      (schedule_item.value ->> 'amount')::numeric,
      0,
      schedule_record.currency,
      (schedule_item.value ->> 'due_date')::date,
      actor_id,
      quote_record.id,
      acceptance_record.quote_version_id,
      acceptance_record.id,
      schedule_record.id,
      schedule_item.position
    );
  end loop;

  insert into public.audit_events (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_organization_id,
    actor_id,
    'record.created',
    'quote',
    quote_record.id,
    jsonb_build_object(
      'event', 'quote.receivables_created',
      'quote_version', quote_record.current_version,
      'acceptance_id', acceptance_record.id,
      'payment_schedule_id', schedule_record.id,
      'payment_schedule_revision', schedule_record.revision,
      'receivable_count', schedule_record.item_count,
      'total_amount', schedule_record.total_amount,
      'currency', schedule_record.currency,
      'invoice_issued', false,
      'invoice_delivered', false,
      'payment_collected', false,
      'booking_created', false,
      'opportunity_marked_won', false,
      'external_action_performed', false
    )
  );

  return query select
    quote_record.id,
    acceptance_record.id,
    schedule_record.id,
    schedule_record.item_count::integer,
    schedule_record.total_amount,
    schedule_record.currency::text,
    false;
end;
$$;

revoke all on function public.create_accepted_quote_receivables(uuid, uuid)
  from public, anon;
grant execute on function public.create_accepted_quote_receivables(uuid, uuid)
  to authenticated;
