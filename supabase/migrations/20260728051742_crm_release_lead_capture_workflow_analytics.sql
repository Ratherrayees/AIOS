-- CRM release: governed public lead capture, enforceable pipeline transitions,
-- response/follow-up SLAs, and stage history for conversion analytics.

alter table public.deals
  add column source_campaign text,
  add column stage_entered_at timestamptz,
  add column first_response_due_at timestamptz,
  add column first_responded_at timestamptz,
  add column follow_up_due_at timestamptz,
  add column sla_escalation_level smallint not null default 0,
  add column sla_escalated_at timestamptz,
  add column won_at timestamptz,
  add column lost_at timestamptz,
  add constraint deals_source_campaign_length
    check (
      source_campaign is null
      or char_length(btrim(source_campaign)) between 1 and 120
    ),
  add constraint deals_sla_escalation_level_check
    check (sla_escalation_level between 0 and 3),
  add constraint deals_sla_escalation_state_check
    check (
      (sla_escalation_level = 0 and sla_escalated_at is null)
      or
      (sla_escalation_level > 0 and sla_escalated_at is not null)
    ),
  add constraint deals_response_timeline_check
    check (
      first_responded_at is null
      or first_response_due_at is null
      or first_responded_at >= created_at
    ),
  add constraint deals_close_timeline_check
    check (
      (stage = 'won' and won_at is not null and lost_at is null)
      or (stage = 'lost' and lost_at is not null and won_at is null)
      or (stage not in ('won', 'lost') and won_at is null and lost_at is null)
    ) not valid;

update public.deals
set
  stage_entered_at = created_at,
  first_response_due_at = case
    when stage in ('won', 'lost') then null
    else created_at + interval '15 minutes'
  end,
  won_at = case when stage = 'won' then updated_at else null end,
  lost_at = case when stage = 'lost' then updated_at else null end;

alter table public.deals
  alter column stage_entered_at set not null,
  alter column stage_entered_at set default now(),
  alter column first_response_due_at set default (now() + interval '15 minutes');
alter table public.deals validate constraint deals_close_timeline_check;

create index deals_open_response_sla_idx
  on public.deals (organization_id, first_response_due_at, sla_escalation_level)
  where archived_at is null
    and stage not in ('won', 'lost')
    and first_responded_at is null
    and first_response_due_at is not null;
create index deals_open_follow_up_sla_idx
  on public.deals (organization_id, follow_up_due_at, sla_escalation_level)
  where archived_at is null
    and stage not in ('won', 'lost')
    and follow_up_due_at is not null;
create index deals_source_conversion_idx
  on public.deals (organization_id, source, created_at desc, stage)
  where archived_at is null;
create index deals_owner_velocity_idx
  on public.deals (organization_id, owner_id, created_at desc, stage)
  where archived_at is null;

create table public.deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  deal_id uuid not null,
  from_stage public.deal_stage,
  to_stage public.deal_stage not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  duration_seconds bigint
    check (duration_seconds is null or duration_seconds >= 0),
  reason text check (reason is null or char_length(btrim(reason)) between 3 and 500),
  foreign key (organization_id, deal_id)
    references public.deals(organization_id, id) on delete cascade
);

create index deal_stage_history_org_changed_idx
  on public.deal_stage_history (organization_id, changed_at desc);
create index deal_stage_history_deal_changed_idx
  on public.deal_stage_history (deal_id, changed_at desc);
create index deal_stage_history_org_stage_idx
  on public.deal_stage_history (
    organization_id,
    from_stage,
    to_stage,
    changed_at desc
  );
create index deal_stage_history_changed_by_idx
  on public.deal_stage_history (changed_by)
  where changed_by is not null;

alter table public.deal_stage_history enable row level security;
grant select on table public.deal_stage_history to authenticated;
grant select, insert, update, delete on table public.deal_stage_history
  to service_role;

create policy "members may read deal stage history"
  on public.deal_stage_history
  for select
  to authenticated
  using (public.is_active_member(organization_id));
create policy "verified MFA factors require aal2"
  on public.deal_stage_history
  as restrictive
  for all
  to authenticated
  using (public.meets_mfa_requirement())
  with check (public.meets_mfa_requirement());

create table public.lead_capture_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  public_token uuid not null default gen_random_uuid() unique,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  headline text not null
    default 'Plan an extraordinary journey'
    check (char_length(btrim(headline)) between 3 and 140),
  source text not null default 'Website'
    check (char_length(btrim(source)) between 1 and 120),
  default_owner_id uuid,
  first_response_minutes smallint not null default 15
    check (first_response_minutes between 5 and 1440),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, default_owner_id)
    references public.memberships(organization_id, user_id)
);

create table public.lead_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  lead_capture_form_id uuid not null,
  dedupe_key text not null check (dedupe_key ~ '^[a-f0-9]{64}$'),
  submitted_on date not null default current_date,
  status text not null default 'captured'
    check (status in ('captured', 'converted', 'duplicate', 'rejected')),
  contact_id uuid,
  deal_id uuid,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 100),
  email text check (email is null or char_length(btrim(email)) between 3 and 320),
  phone text check (phone is null or char_length(btrim(phone)) between 5 and 40),
  destination text
    check (destination is null or char_length(btrim(destination)) between 1 and 180),
  budget_amount numeric(14, 2)
    check (budget_amount is null or budget_amount >= 0),
  currency char(3) not null default 'INR',
  notes text check (notes is null or char_length(btrim(notes)) between 1 and 2000),
  communication_consent boolean not null default false,
  utm_source text check (utm_source is null or char_length(utm_source) <= 120),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 120),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 120),
  landing_path text check (landing_path is null or char_length(landing_path) <= 500),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_capture_form_id, dedupe_key, submitted_on),
  foreign key (organization_id, lead_capture_form_id)
    references public.lead_capture_forms(organization_id, id) on delete restrict,
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, deal_id)
    references public.deals(organization_id, id) on delete set null (deal_id)
);

create index lead_capture_forms_org_active_idx
  on public.lead_capture_forms (organization_id, is_active, updated_at desc);
create index lead_capture_forms_owner_idx
  on public.lead_capture_forms (organization_id, default_owner_id)
  where default_owner_id is not null;
create index lead_submissions_org_created_idx
  on public.lead_submissions (organization_id, created_at desc);
create index lead_submissions_form_created_idx
  on public.lead_submissions (lead_capture_form_id, created_at desc);
create index lead_submissions_contact_idx
  on public.lead_submissions (organization_id, contact_id)
  where contact_id is not null;
create index lead_submissions_deal_idx
  on public.lead_submissions (organization_id, deal_id)
  where deal_id is not null;

create table private.lead_capture_rate_limits (
  lead_capture_form_id uuid not null
    references public.lead_capture_forms(id) on delete cascade,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts smallint not null default 1 check (attempts between 1 and 1000),
  primary key (lead_capture_form_id, request_fingerprint)
);

revoke all on table private.lead_capture_rate_limits from public;
revoke all on table private.lead_capture_rate_limits from anon;
revoke all on table private.lead_capture_rate_limits from authenticated;

create trigger lead_capture_forms_set_updated_at
  before update on public.lead_capture_forms
  for each row execute function public.set_updated_at();
create trigger lead_submissions_set_updated_at
  before update on public.lead_submissions
  for each row execute function public.set_updated_at();
create trigger lead_capture_forms_prevent_organization_move
  before update on public.lead_capture_forms
  for each row execute function private.prevent_organization_id_change();
create trigger lead_submissions_prevent_organization_move
  before update on public.lead_submissions
  for each row execute function private.prevent_organization_id_change();

alter table public.lead_capture_forms enable row level security;
alter table public.lead_submissions enable row level security;

grant select, insert, update on table public.lead_capture_forms
  to authenticated;
grant select, update on table public.lead_submissions
  to authenticated;
grant select, insert, update, delete on table public.lead_capture_forms
  to service_role;
grant select, insert, update, delete on table public.lead_submissions
  to service_role;

create policy "members may read lead capture forms"
  on public.lead_capture_forms
  for select
  to authenticated
  using (public.is_active_member(organization_id));
create policy "commercial managers may create lead capture forms"
  on public.lead_capture_forms
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales']::public.app_role[]
    )
  );
create policy "commercial managers may update lead capture forms"
  on public.lead_capture_forms
  for update
  to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales']::public.app_role[]
    )
  );
create policy "verified MFA factors require aal2"
  on public.lead_capture_forms
  as restrictive
  for all
  to authenticated
  using (public.meets_mfa_requirement())
  with check (public.meets_mfa_requirement());

create policy "members may read lead submissions"
  on public.lead_submissions
  for select
  to authenticated
  using (public.is_active_member(organization_id));
create policy "commercial managers may update lead submissions"
  on public.lead_submissions
  for update
  to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales']::public.app_role[]
    )
  );
create policy "verified MFA factors require aal2"
  on public.lead_submissions
  as restrictive
  for all
  to authenticated
  using (public.meets_mfa_requirement())
  with check (public.meets_mfa_requirement());

create or replace function private.enforce_deal_stage_transition_path()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.stage is distinct from old.stage
    and coalesce(
      current_setting('aios.allowed_deal_stage_transition', true),
      'false'
    ) <> 'true'
  then
    raise exception 'Use the governed deal stage transition workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_deal_stage_transition_path()
  from public;
create trigger deals_enforce_stage_transition
  before update of stage on public.deals
  for each row execute function private.enforce_deal_stage_transition_path();

create or replace function private.enforce_initial_deal_stage()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is not null and new.stage <> 'new' then
    raise exception 'New opportunities must enter at the New stage.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_initial_deal_stage() from public;
create trigger deals_enforce_initial_stage
  before insert on public.deals
  for each row execute function private.enforce_initial_deal_stage();

create or replace function private.record_initial_deal_stage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.deal_stage_history (
    organization_id,
    deal_id,
    from_stage,
    to_stage,
    changed_by,
    changed_at,
    duration_seconds
  )
  values (
    new.organization_id,
    new.id,
    null,
    new.stage,
    (select auth.uid()),
    new.created_at,
    null
  );
  return new;
end;
$$;

revoke all on function private.record_initial_deal_stage() from public;
create trigger deals_record_initial_stage
  after insert on public.deals
  for each row execute function private.record_initial_deal_stage();

insert into public.deal_stage_history (
  organization_id,
  deal_id,
  from_stage,
  to_stage,
  changed_by,
  changed_at,
  duration_seconds
)
select
  organization_id,
  id,
  null,
  stage,
  null,
  created_at,
  null
from public.deals;

create or replace function public.transition_deal_stage(
  target_organization_id uuid,
  target_deal_id uuid,
  target_stage public.deal_stage,
  target_lost_reason text default null
)
returns setof public.deals
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_deal public.deals%rowtype;
  changed_at timestamptz := statement_timestamp();
  actor_is_manager boolean;
begin
  if actor_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if not public.meets_mfa_requirement() then
    raise exception 'Multi-factor verification is required.'
      using errcode = '42501';
  end if;
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'agent']::public.app_role[]
  ) then
    raise exception 'You do not have permission to move opportunities.'
      using errcode = '42501';
  end if;

  actor_is_manager := public.has_organization_role(
    target_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  select deal.*
  into current_deal
  from public.deals deal
  where deal.id = target_deal_id
    and deal.organization_id = target_organization_id
    and deal.archived_at is null
  for update;
  if not found then
    raise exception 'That opportunity is not available.'
      using errcode = 'P0002';
  end if;
  if current_deal.stage = target_stage then
    return query select deal.* from public.deals deal where deal.id = target_deal_id;
    return;
  end if;

  if not (
    (current_deal.stage = 'new' and target_stage in ('qualified', 'lost'))
    or (current_deal.stage = 'qualified' and target_stage in ('new', 'proposal', 'lost'))
    or (current_deal.stage = 'proposal' and target_stage in ('qualified', 'decision', 'lost'))
    or (current_deal.stage = 'decision' and target_stage in ('proposal', 'won', 'lost'))
    or (
      current_deal.stage in ('won', 'lost')
      and target_stage = 'decision'
      and actor_is_manager
    )
  ) then
    raise exception 'That pipeline transition is not allowed.'
      using errcode = '22023';
  end if;

  if target_stage = 'qualified'
    and (
      current_deal.owner_id is null
      or nullif(btrim(current_deal.destination), '') is null
      or nullif(btrim(current_deal.next_step), '') is null
      or current_deal.expected_close_at is null
      or current_deal.probability < 20
    )
  then
    raise exception 'Qualification requires an owner, destination, next step, expected close date, and probability of at least 20%%.'
      using errcode = '23514';
  end if;
  if target_stage = 'proposal'
    and (
      coalesce(current_deal.value_amount, 0) <= 0
      or nullif(btrim(current_deal.next_step), '') is null
      or current_deal.expected_close_at is null
    )
  then
    raise exception 'Proposal requires a positive value, next step, and expected close date.'
      using errcode = '23514';
  end if;
  if target_stage = 'decision'
    and (
      coalesce(current_deal.value_amount, 0) <= 0
      or current_deal.probability < 50
      or nullif(btrim(current_deal.next_step), '') is null
    )
  then
    raise exception 'Decision requires a positive value, probability of at least 50%%, and a next step.'
      using errcode = '23514';
  end if;
  if target_stage = 'won'
    and (coalesce(current_deal.value_amount, 0) <= 0 or current_deal.contact_id is null)
  then
    raise exception 'A won opportunity requires a contact and positive value.'
      using errcode = '23514';
  end if;
  if target_stage = 'lost'
    and char_length(btrim(coalesce(target_lost_reason, ''))) < 3
  then
    raise exception 'A loss reason is required.'
      using errcode = '23514';
  end if;

  perform set_config('aios.allowed_deal_stage_transition', 'true', true);
  update public.deals
  set
    stage = target_stage,
    stage_entered_at = changed_at,
    last_activity_at = changed_at,
    first_responded_at = coalesce(first_responded_at, changed_at),
    qualified_at = case
      when target_stage = 'qualified' then coalesce(qualified_at, changed_at)
      else qualified_at
    end,
    lost_reason = case
      when target_stage = 'lost' then btrim(target_lost_reason)
      else null
    end,
    won_at = case when target_stage = 'won' then changed_at else null end,
    lost_at = case when target_stage = 'lost' then changed_at else null end
  where id = target_deal_id;

  insert into public.deal_stage_history (
    organization_id,
    deal_id,
    from_stage,
    to_stage,
    changed_by,
    changed_at,
    duration_seconds,
    reason
  )
  values (
    target_organization_id,
    target_deal_id,
    current_deal.stage,
    target_stage,
    actor_id,
    changed_at,
    greatest(
      0,
      floor(extract(epoch from changed_at - current_deal.stage_entered_at))::bigint
    ),
    case when target_stage = 'lost' then btrim(target_lost_reason) else null end
  );

  insert into public.activity_events (
    organization_id,
    contact_id,
    deal_id,
    actor_id,
    activity_type,
    body,
    metadata
  )
  values (
    target_organization_id,
    current_deal.contact_id,
    target_deal_id,
    actor_id,
    'deal_stage_changed',
    format('Deal moved from %s to %s.', current_deal.stage, target_stage),
    jsonb_build_object(
      'from_stage',
      current_deal.stage,
      'stage',
      target_stage,
      'lost_reason',
      case when target_stage = 'lost' then btrim(target_lost_reason) else null end
    )
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
    'deal',
    target_deal_id,
    jsonb_build_object(
      'event',
      'deal.stage_updated',
      'from_stage',
      current_deal.stage,
      'stage',
      target_stage,
      'lost_reason',
      case when target_stage = 'lost' then btrim(target_lost_reason) else null end
    )
  );

  return query select deal.* from public.deals deal where deal.id = target_deal_id;
end;
$$;

revoke all on function public.transition_deal_stage(
  uuid,
  uuid,
  public.deal_stage,
  text
) from public;
grant execute on function public.transition_deal_stage(
  uuid,
  uuid,
  public.deal_stage,
  text
) to authenticated;

create or replace function public.acknowledge_lead_response(
  target_organization_id uuid,
  target_deal_id uuid
)
returns setof public.deals
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_deal public.deals%rowtype;
  responded_at timestamptz := statement_timestamp();
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'agent']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to record a lead response.'
      using errcode = '42501';
  end if;

  select deal.*
  into current_deal
  from public.deals deal
  where deal.id = target_deal_id
    and deal.organization_id = target_organization_id
    and deal.archived_at is null
  for update;
  if not found then
    raise exception 'That opportunity is not available.'
      using errcode = 'P0002';
  end if;
  if current_deal.first_responded_at is not null then
    return query select deal.* from public.deals deal where deal.id = target_deal_id;
    return;
  end if;

  update public.deals
  set
    first_responded_at = responded_at,
    last_activity_at = responded_at,
    sla_escalation_level = 0,
    sla_escalated_at = null
  where id = target_deal_id;

  insert into public.activity_events (
    organization_id,
    contact_id,
    deal_id,
    actor_id,
    activity_type,
    body,
    metadata
  )
  values (
    target_organization_id,
    current_deal.contact_id,
    target_deal_id,
    actor_id,
    'deal_response_recorded',
    'The first traveller response was recorded.',
    jsonb_build_object(
      'first_response_due_at',
      current_deal.first_response_due_at,
      'responded_at',
      responded_at,
      'within_sla',
      current_deal.first_response_due_at is null
        or responded_at <= current_deal.first_response_due_at
    )
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
    'deal',
    target_deal_id,
    jsonb_build_object(
      'event',
      'deal.first_response_recorded',
      'responded_at',
      responded_at
    )
  );

  return query select deal.* from public.deals deal where deal.id = target_deal_id;
end;
$$;

revoke all on function public.acknowledge_lead_response(uuid, uuid)
  from public;
grant execute on function public.acknowledge_lead_response(uuid, uuid)
  to authenticated;

create or replace function public.capture_public_lead(
  target_form_token uuid,
  target_full_name text,
  target_email text,
  target_phone text,
  target_destination text,
  target_budget_amount numeric,
  target_currency text,
  target_notes text,
  target_communication_consent boolean,
  target_utm_source text,
  target_utm_medium text,
  target_utm_campaign text,
  target_landing_path text,
  target_referrer_host text,
  target_dedupe_key text,
  target_request_fingerprint text
)
returns table (
  submission_id uuid,
  contact_id uuid,
  deal_id uuid,
  duplicate boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  capture_form public.lead_capture_forms%rowtype;
  captured_submission_id uuid;
  captured_contact_id uuid;
  captured_deal_id uuid;
  attempt_count smallint;
  normalized_email text := nullif(lower(btrim(target_email)), '');
  normalized_phone text := nullif(btrim(target_phone), '');
  captured_at timestamptz := statement_timestamp();
begin
  if char_length(btrim(coalesce(target_full_name, ''))) not between 1 and 100
    or (
      normalized_email is null
      and normalized_phone is null
    )
    or target_dedupe_key !~ '^[a-f0-9]{64}$'
    or target_request_fingerprint !~ '^[a-f0-9]{64}$'
  then
    raise exception 'The lead submission is invalid.'
      using errcode = '22023';
  end if;

  select form.*
  into capture_form
  from public.lead_capture_forms form
  where form.public_token = target_form_token
    and form.is_active
  for share;
  if not found then
    raise exception 'This lead form is not available.'
      using errcode = 'P0002';
  end if;

  insert into private.lead_capture_rate_limits (
    lead_capture_form_id,
    request_fingerprint,
    window_started_at,
    attempts
  )
  values (
    capture_form.id,
    target_request_fingerprint,
    captured_at,
    1
  )
  on conflict (lead_capture_form_id, request_fingerprint)
  do update set
    window_started_at = case
      when private.lead_capture_rate_limits.window_started_at
        < captured_at - interval '15 minutes'
      then captured_at
      else private.lead_capture_rate_limits.window_started_at
    end,
    attempts = case
      when private.lead_capture_rate_limits.window_started_at
        < captured_at - interval '15 minutes'
      then 1
      else private.lead_capture_rate_limits.attempts + 1
    end
  returning attempts into attempt_count;
  if attempt_count > 8 then
    raise exception 'Too many lead submissions. Try again later.'
      using errcode = 'P0001';
  end if;

  insert into public.lead_submissions (
    organization_id,
    lead_capture_form_id,
    dedupe_key,
    full_name,
    email,
    phone,
    destination,
    budget_amount,
    currency,
    notes,
    communication_consent,
    utm_source,
    utm_medium,
    utm_campaign,
    landing_path,
    referrer_host
  )
  values (
    capture_form.organization_id,
    capture_form.id,
    target_dedupe_key,
    btrim(target_full_name),
    normalized_email,
    normalized_phone,
    nullif(btrim(target_destination), ''),
    target_budget_amount,
    upper(coalesce(nullif(btrim(target_currency), ''), 'INR')),
    nullif(btrim(target_notes), ''),
    coalesce(target_communication_consent, false),
    nullif(btrim(target_utm_source), ''),
    nullif(btrim(target_utm_medium), ''),
    nullif(btrim(target_utm_campaign), ''),
    nullif(btrim(target_landing_path), ''),
    nullif(btrim(target_referrer_host), '')
  )
  on conflict (lead_capture_form_id, dedupe_key, submitted_on)
  do nothing
  returning id into captured_submission_id;

  if captured_submission_id is null then
    return query
    select
      submission.id,
      submission.contact_id,
      submission.deal_id,
      true
    from public.lead_submissions submission
    where submission.lead_capture_form_id = capture_form.id
      and submission.dedupe_key = target_dedupe_key
      and submission.submitted_on = current_date
    limit 1;
    return;
  end if;

  if normalized_email is not null then
    select contact.id
    into captured_contact_id
    from public.contacts contact
    where contact.organization_id = capture_form.organization_id
      and lower(btrim(contact.email)) = normalized_email
      and contact.archived_at is null
    order by contact.created_at
    limit 1;
  end if;

  if captured_contact_id is null then
    begin
      insert into public.contacts (
        organization_id,
        first_name,
        email,
        phone,
        owner_id,
        communication_consent,
        consent_recorded_at,
        consent_source,
        preferred_channel
      )
      values (
        capture_form.organization_id,
        btrim(target_full_name),
        normalized_email,
        normalized_phone,
        capture_form.default_owner_id,
        case
          when target_communication_consent then 'granted'::public.contact_consent_status
          else 'unknown'::public.contact_consent_status
        end,
        case when target_communication_consent then captured_at else null end,
        case
          when target_communication_consent
          then 'Website lead form: ' || capture_form.name
          else null
        end,
        case
          when normalized_email is not null then 'email'::public.contact_channel_preference
          when normalized_phone is not null then 'phone'::public.contact_channel_preference
          else 'none'::public.contact_channel_preference
        end
      )
      returning id into captured_contact_id;
    exception
      when unique_violation then
        select contact.id
        into captured_contact_id
        from public.contacts contact
        where contact.organization_id = capture_form.organization_id
          and lower(btrim(contact.email)) = normalized_email
          and contact.archived_at is null
        order by contact.created_at
        limit 1;
    end;
  end if;

  insert into public.deals (
    organization_id,
    contact_id,
    owner_id,
    title,
    stage,
    value_amount,
    currency,
    source,
    source_campaign,
    destination,
    probability,
    next_step,
    last_activity_at,
    first_response_due_at
  )
  values (
    capture_form.organization_id,
    captured_contact_id,
    capture_form.default_owner_id,
    left(
      btrim(target_full_name)
        || case
          when nullif(btrim(target_destination), '') is not null
          then ' · ' || btrim(target_destination)
          else ' · New travel inquiry'
        end,
      180
    ),
    'new',
    target_budget_amount,
    upper(coalesce(nullif(btrim(target_currency), ''), 'INR')),
    coalesce(nullif(btrim(target_utm_source), ''), capture_form.source),
    nullif(btrim(target_utm_campaign), ''),
    nullif(btrim(target_destination), ''),
    10,
    'Review captured inquiry and contact traveller',
    captured_at,
    captured_at + make_interval(mins => capture_form.first_response_minutes)
  )
  returning id into captured_deal_id;

  update public.lead_submissions
  set
    contact_id = captured_contact_id,
    deal_id = captured_deal_id,
    status = 'converted'
  where id = captured_submission_id;

  insert into public.activity_events (
    organization_id,
    contact_id,
    deal_id,
    activity_type,
    body,
    metadata
  )
  values (
    capture_form.organization_id,
    captured_contact_id,
    captured_deal_id,
    'lead_captured',
    'A traveller submitted a governed lead capture form.',
    jsonb_build_object(
      'lead_capture_form_id',
      capture_form.id,
      'lead_submission_id',
      captured_submission_id,
      'source',
      coalesce(nullif(btrim(target_utm_source), ''), capture_form.source),
      'campaign',
      nullif(btrim(target_utm_campaign), '')
    )
  );

  insert into public.audit_events (
    organization_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    capture_form.organization_id,
    'record.created',
    'deal',
    captured_deal_id,
    jsonb_build_object(
      'event',
      'lead.publicly_captured',
      'lead_capture_form_id',
      capture_form.id,
      'lead_submission_id',
      captured_submission_id
    )
  );

  return query
  select captured_submission_id, captured_contact_id, captured_deal_id, false;
end;
$$;

revoke all on function public.capture_public_lead(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public;
revoke all on function public.capture_public_lead(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from anon;
revoke all on function public.capture_public_lead(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from authenticated;
grant execute on function public.capture_public_lead(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

alter table public.activity_events
  drop constraint activity_events_activity_type_check,
  add constraint activity_events_activity_type_check
  check (
    activity_type in (
      'note',
      'contact_created',
      'contact_preferences_updated',
      'contact_owner_changed',
      'contact_merged',
      'company_created',
      'deal_created',
      'deal_stage_changed',
      'deal_commercial_plan_updated',
      'deal_response_recorded',
      'deal_sla_escalated',
      'lead_captured',
      'document_uploaded',
      'task_created',
      'task_status_changed',
      'conversation_sla_updated',
      'conversation_sla_escalated',
      'message_draft_created',
      'ai_observation'
    )
  );

create or replace function public.record_travel_document(
  target_organization_id uuid,
  target_deal_id uuid,
  target_contact_id uuid,
  target_document_id uuid,
  target_storage_path text,
  target_file_name text,
  target_mime_type text,
  target_byte_size bigint
)
returns public.documents
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  linked_contact_id uuid;
  created_document public.documents;
begin
  if actor_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if not public.meets_mfa_requirement() then
    raise exception 'Multi-factor verification is required.'
      using errcode = '42501';
  end if;
  if not public.has_organization_role(
    target_organization_id,
    array[
      'owner',
      'admin',
      'sales',
      'trip_designer',
      'operations',
      'finance',
      'agent'
    ]::public.app_role[]
  ) then
    raise exception 'You do not have permission to upload travel documents.'
      using errcode = '42501';
  end if;
  if target_file_name is null
    or char_length(target_file_name) not between 1 and 300
    or target_byte_size not between 1 and 15728640
    or target_mime_type not in (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif'
    )
    or target_storage_path not like
      target_organization_id::text || '/' || target_document_id::text || '/%'
  then
    raise exception 'The travel document metadata is invalid.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'travel-documents'
      and object.name = target_storage_path
      and object.owner_id = actor_id::text
  ) then
    raise exception 'The private travel document has not been uploaded.'
      using errcode = '22023';
  end if;

  select deal.contact_id
  into linked_contact_id
  from public.deals deal
  where deal.organization_id = target_organization_id
    and deal.id = target_deal_id;
  if linked_contact_id is null or linked_contact_id <> target_contact_id then
    raise exception 'The traveller is not linked to this opportunity.'
      using errcode = '22023';
  end if;

  insert into public.documents (
    id,
    organization_id,
    contact_id,
    uploaded_by,
    storage_path,
    file_name,
    mime_type,
    byte_size,
    sensitivity
  )
  values (
    target_document_id,
    target_organization_id,
    target_contact_id,
    actor_id,
    target_storage_path,
    target_file_name,
    target_mime_type,
    target_byte_size,
    'normal'
  )
  returning * into created_document;

  insert into public.activity_events (
    organization_id,
    contact_id,
    deal_id,
    actor_id,
    activity_type,
    body,
    metadata
  )
  values (
    target_organization_id,
    target_contact_id,
    target_deal_id,
    actor_id,
    'document_uploaded',
    'Private travel document uploaded: ' || target_file_name,
    jsonb_build_object(
      'document_id',
      target_document_id,
      'mime_type',
      target_mime_type,
      'byte_size',
      target_byte_size
    )
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
    'record.created',
    'document',
    target_document_id,
    jsonb_build_object(
      'event',
      'document.uploaded',
      'contact_id',
      target_contact_id,
      'deal_id',
      target_deal_id,
      'mime_type',
      target_mime_type,
      'byte_size',
      target_byte_size
    )
  );

  return created_document;
end;
$$;

revoke all on function public.record_travel_document(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
) from public, anon;
grant execute on function public.record_travel_document(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
) to authenticated, service_role;

-- Supabase no longer auto-exposes new or existing public tables to Data API
-- roles. The service role is the deliberate server-only administrative
-- boundary used by lead capture, webhooks, and authorization verification.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public
  to service_role;
grant usage, select on all sequences in schema public to service_role;
