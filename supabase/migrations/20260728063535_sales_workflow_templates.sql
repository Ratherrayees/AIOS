create table public.qualification_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  description text check (description is null or char_length(description) <= 500),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, created_by)
    references public.memberships (organization_id, user_id)
    on delete restrict
);

create unique index qualification_templates_org_name_idx
  on public.qualification_checklist_templates (
    organization_id,
    lower(name)
  );
create index qualification_templates_creator_idx
  on public.qualification_checklist_templates (created_by);

create table public.qualification_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null,
  position smallint not null check (position between 1 and 20),
  label text not null check (char_length(label) between 2 and 180),
  guidance text check (guidance is null or char_length(guidance) <= 500),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (template_id, position),
  foreign key (organization_id, template_id)
    references public.qualification_checklist_templates (organization_id, id)
    on delete cascade
);

create index qualification_items_org_template_idx
  on public.qualification_checklist_items (
    organization_id,
    template_id,
    position
  );

create table public.deal_qualification_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null,
  template_item_id uuid not null,
  label text not null check (char_length(label) between 2 and 180),
  guidance text check (guidance is null or char_length(guidance) <= 500),
  is_required boolean not null default true,
  is_complete boolean not null default false,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (deal_id, template_item_id),
  check (
    (is_complete and completed_by is not null and completed_at is not null)
    or (not is_complete and completed_by is null and completed_at is null)
  ),
  foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete cascade,
  foreign key (organization_id, template_item_id)
    references public.qualification_checklist_items (organization_id, id)
    on delete restrict,
  foreign key (organization_id, completed_by)
    references public.memberships (organization_id, user_id)
    on delete set null (completed_by)
);

create index deal_qualification_checks_org_deal_idx
  on public.deal_qualification_checks (
    organization_id,
    deal_id,
    is_required,
    is_complete
  );
create index deal_qualification_checks_completed_by_idx
  on public.deal_qualification_checks (completed_by)
  where completed_by is not null;

create table public.follow_up_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  description text check (description is null or char_length(description) <= 500),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, created_by)
    references public.memberships (organization_id, user_id)
    on delete restrict
);

create unique index follow_up_sequences_org_name_idx
  on public.follow_up_sequences (organization_id, lower(name));
create index follow_up_sequences_creator_idx
  on public.follow_up_sequences (created_by);

create table public.follow_up_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sequence_id uuid not null,
  position smallint not null check (position between 1 and 20),
  title text not null check (char_length(title) between 2 and 500),
  delay_days smallint not null check (delay_days between 0 and 365),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (sequence_id, position),
  foreign key (organization_id, sequence_id)
    references public.follow_up_sequences (organization_id, id)
    on delete cascade
);

create index follow_up_steps_org_sequence_idx
  on public.follow_up_sequence_steps (
    organization_id,
    sequence_id,
    position
  );

create table public.deal_follow_up_sequence_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null,
  sequence_id uuid not null,
  enrolled_by uuid not null references public.profiles(id) on delete restrict,
  tasks_created smallint not null check (tasks_created between 1 and 20),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, deal_id, sequence_id),
  foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete cascade,
  foreign key (organization_id, sequence_id)
    references public.follow_up_sequences (organization_id, id)
    on delete restrict,
  foreign key (organization_id, enrolled_by)
    references public.memberships (organization_id, user_id)
    on delete restrict
);

create index follow_up_runs_org_deal_idx
  on public.deal_follow_up_sequence_runs (
    organization_id,
    deal_id,
    created_at desc
  );
create index follow_up_runs_enrolled_by_idx
  on public.deal_follow_up_sequence_runs (enrolled_by);

create trigger qualification_templates_set_updated_at
  before update on public.qualification_checklist_templates
  for each row execute function public.set_updated_at();
create trigger deal_qualification_checks_set_updated_at
  before update on public.deal_qualification_checks
  for each row execute function public.set_updated_at();
create trigger follow_up_sequences_set_updated_at
  before update on public.follow_up_sequences
  for each row execute function public.set_updated_at();

create trigger qualification_templates_prevent_organization_move
  before update on public.qualification_checklist_templates
  for each row execute function private.prevent_organization_id_change();
create trigger deal_qualification_checks_prevent_organization_move
  before update on public.deal_qualification_checks
  for each row execute function private.prevent_organization_id_change();
create trigger follow_up_sequences_prevent_organization_move
  before update on public.follow_up_sequences
  for each row execute function private.prevent_organization_id_change();

alter table public.qualification_checklist_templates enable row level security;
alter table public.qualification_checklist_items enable row level security;
alter table public.deal_qualification_checks enable row level security;
alter table public.follow_up_sequences enable row level security;
alter table public.follow_up_sequence_steps enable row level security;
alter table public.deal_follow_up_sequence_runs enable row level security;

create policy "members may read qualification templates"
  on public.qualification_checklist_templates
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "members may read qualification template items"
  on public.qualification_checklist_items
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "members may read deal qualification checks"
  on public.deal_qualification_checks
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "members may read follow up sequences"
  on public.follow_up_sequences
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "members may read follow up sequence steps"
  on public.follow_up_sequence_steps
  for select to authenticated
  using (public.is_active_member(organization_id));
create policy "members may read follow up sequence runs"
  on public.deal_follow_up_sequence_runs
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "verified MFA required for qualification templates"
  on public.qualification_checklist_templates
  as restrictive for select to authenticated
  using (public.meets_mfa_requirement());
create policy "verified MFA required for qualification items"
  on public.qualification_checklist_items
  as restrictive for select to authenticated
  using (public.meets_mfa_requirement());
create policy "verified MFA required for qualification checks"
  on public.deal_qualification_checks
  as restrictive for select to authenticated
  using (public.meets_mfa_requirement());
create policy "verified MFA required for follow up sequences"
  on public.follow_up_sequences
  as restrictive for select to authenticated
  using (public.meets_mfa_requirement());
create policy "verified MFA required for follow up steps"
  on public.follow_up_sequence_steps
  as restrictive for select to authenticated
  using (public.meets_mfa_requirement());
create policy "verified MFA required for follow up runs"
  on public.deal_follow_up_sequence_runs
  as restrictive for select to authenticated
  using (public.meets_mfa_requirement());

grant select on table
  public.qualification_checklist_templates,
  public.qualification_checklist_items,
  public.deal_qualification_checks,
  public.follow_up_sequences,
  public.follow_up_sequence_steps,
  public.deal_follow_up_sequence_runs
to authenticated;
grant select, insert, update, delete on table
  public.qualification_checklist_templates,
  public.qualification_checklist_items,
  public.deal_qualification_checks,
  public.follow_up_sequences,
  public.follow_up_sequence_steps,
  public.deal_follow_up_sequence_runs
to service_role;

create or replace function public.create_qualification_checklist_template(
  target_organization_id uuid,
  target_name text,
  target_description text,
  target_items jsonb
)
returns setof public.qualification_checklist_templates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  created_template public.qualification_checklist_templates%rowtype;
  item_count integer;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to create qualification templates.'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(target_name, ''))) not between 2 and 100
    or char_length(coalesce(target_description, '')) > 500
    or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 20
  then
    raise exception 'The qualification template is invalid.'
      using errcode = '22023';
  end if;

  select count(*)
  into item_count
  from jsonb_array_elements(target_items) as item(value)
  where jsonb_typeof(item.value) <> 'object'
    or char_length(btrim(coalesce(item.value ->> 'label', ''))) not between 2 and 180
    or char_length(coalesce(item.value ->> 'guidance', '')) > 500
    or coalesce(item.value ->> 'required', '') not in ('true', 'false');
  if item_count > 0 then
    raise exception 'Every qualification item needs a valid label and requirement flag.'
      using errcode = '22023';
  end if;

  insert into public.qualification_checklist_templates (
    organization_id,
    name,
    description,
    created_by
  )
  values (
    target_organization_id,
    btrim(target_name),
    nullif(btrim(target_description), ''),
    actor_id
  )
  returning * into created_template;

  insert into public.qualification_checklist_items (
    organization_id,
    template_id,
    position,
    label,
    guidance,
    is_required
  )
  select
    target_organization_id,
    created_template.id,
    item.ordinality::smallint,
    btrim(item.value ->> 'label'),
    nullif(btrim(item.value ->> 'guidance'), ''),
    (item.value ->> 'required')::boolean
  from jsonb_array_elements(target_items)
    with ordinality as item(value, ordinality);

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
    'qualification_checklist_template',
    created_template.id,
    jsonb_build_object(
      'event',
      'qualification_template.created',
      'item_count',
      jsonb_array_length(target_items)
    )
  );

  return query
  select template.*
  from public.qualification_checklist_templates template
  where template.id = created_template.id;
end;
$$;

create or replace function public.create_follow_up_sequence(
  target_organization_id uuid,
  target_name text,
  target_description text,
  target_steps jsonb
)
returns setof public.follow_up_sequences
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  created_sequence public.follow_up_sequences%rowtype;
  invalid_count integer;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to create follow-up sequences.'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(target_name, ''))) not between 2 and 100
    or char_length(coalesce(target_description, '')) > 500
    or jsonb_typeof(target_steps) <> 'array'
    or jsonb_array_length(target_steps) not between 1 and 20
  then
    raise exception 'The follow-up sequence is invalid.'
      using errcode = '22023';
  end if;

  select count(*)
  into invalid_count
  from jsonb_array_elements(target_steps) as step(value)
  where jsonb_typeof(step.value) <> 'object'
    or char_length(btrim(coalesce(step.value ->> 'title', ''))) not between 2 and 500
    or coalesce(step.value ->> 'delayDays', '') !~ '^[0-9]{1,3}$'
    or (step.value ->> 'delayDays')::integer not between 0 and 365;
  if invalid_count > 0 then
    raise exception 'Every sequence step needs a valid title and delay.'
      using errcode = '22023';
  end if;

  insert into public.follow_up_sequences (
    organization_id,
    name,
    description,
    created_by
  )
  values (
    target_organization_id,
    btrim(target_name),
    nullif(btrim(target_description), ''),
    actor_id
  )
  returning * into created_sequence;

  insert into public.follow_up_sequence_steps (
    organization_id,
    sequence_id,
    position,
    title,
    delay_days
  )
  select
    target_organization_id,
    created_sequence.id,
    step.ordinality::smallint,
    btrim(step.value ->> 'title'),
    (step.value ->> 'delayDays')::smallint
  from jsonb_array_elements(target_steps)
    with ordinality as step(value, ordinality);

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
    'follow_up_sequence',
    created_sequence.id,
    jsonb_build_object(
      'event',
      'follow_up_sequence.created',
      'step_count',
      jsonb_array_length(target_steps)
    )
  );

  return query
  select sequence.*
  from public.follow_up_sequences sequence
  where sequence.id = created_sequence.id;
end;
$$;

create or replace function public.apply_qualification_checklist(
  target_organization_id uuid,
  target_deal_id uuid,
  target_template_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  target_contact_id uuid;
  created_count integer;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'agent']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to apply qualification checklists.'
      using errcode = '42501';
  end if;

  select deal.contact_id
  into target_contact_id
  from public.deals deal
  where deal.organization_id = target_organization_id
    and deal.id = target_deal_id
    and deal.archived_at is null
  for update;
  if not found then
    raise exception 'That opportunity is not available.'
      using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.qualification_checklist_templates template
    where template.organization_id = target_organization_id
      and template.id = target_template_id
      and template.is_active
  ) then
    raise exception 'That qualification template is not active.'
      using errcode = 'P0002';
  end if;

  insert into public.deal_qualification_checks (
    organization_id,
    deal_id,
    template_item_id,
    label,
    guidance,
    is_required
  )
  select
    item.organization_id,
    target_deal_id,
    item.id,
    item.label,
    item.guidance,
    item.is_required
  from public.qualification_checklist_items item
  where item.organization_id = target_organization_id
    and item.template_id = target_template_id
  on conflict (deal_id, template_item_id) do nothing;
  get diagnostics created_count = row_count;
  if created_count = 0 then
    raise exception 'This qualification checklist is already applied.'
      using errcode = 'P0001';
  end if;

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
    'qualification_checklist_applied',
    format('Qualification checklist applied with %s items.', created_count),
    jsonb_build_object(
      'template_id',
      target_template_id,
      'item_count',
      created_count
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
      'deal.qualification_checklist_applied',
      'template_id',
      target_template_id,
      'item_count',
      created_count
    )
  );
  return created_count;
end;
$$;

create or replace function public.set_deal_qualification_check(
  target_organization_id uuid,
  target_check_id uuid,
  target_is_complete boolean
)
returns setof public.deal_qualification_checks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_check public.deal_qualification_checks%rowtype;
  target_contact_id uuid;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'agent']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to update qualification checks.'
      using errcode = '42501';
  end if;

  select check_record.*
  into current_check
  from public.deal_qualification_checks check_record
  where check_record.organization_id = target_organization_id
    and check_record.id = target_check_id
  for update;
  if not found then
    raise exception 'That qualification check is not available.'
      using errcode = 'P0002';
  end if;
  if current_check.is_complete = target_is_complete then
    return query
    select check_record.*
    from public.deal_qualification_checks check_record
    where check_record.id = current_check.id;
    return;
  end if;

  update public.deal_qualification_checks
  set
    is_complete = target_is_complete,
    completed_by = case when target_is_complete then actor_id else null end,
    completed_at = case
      when target_is_complete then statement_timestamp()
      else null
    end
  where id = current_check.id;

  select deal.contact_id
  into target_contact_id
  from public.deals deal
  where deal.organization_id = target_organization_id
    and deal.id = current_check.deal_id;

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
    current_check.deal_id,
    actor_id,
    'qualification_check_updated',
    format(
      'Qualification check %s: %s',
      case when target_is_complete then 'completed' else 'reopened' end,
      current_check.label
    ),
    jsonb_build_object(
      'check_id',
      current_check.id,
      'is_complete',
      target_is_complete
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
    'deal_qualification_check',
    current_check.id,
    jsonb_build_object(
      'event',
      'deal.qualification_check_updated',
      'deal_id',
      current_check.deal_id,
      'is_complete',
      target_is_complete
    )
  );

  return query
  select check_record.*
  from public.deal_qualification_checks check_record
  where check_record.id = current_check.id;
end;
$$;

create or replace function public.apply_follow_up_sequence(
  target_organization_id uuid,
  target_deal_id uuid,
  target_sequence_id uuid
)
returns table (
  run_id uuid,
  tasks_created integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  current_deal public.deals%rowtype;
  created_run_id uuid;
  created_count integer;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'sales', 'agent']::public.app_role[]
    )
  then
    raise exception 'You do not have permission to apply follow-up sequences.'
      using errcode = '42501';
  end if;

  select deal.*
  into current_deal
  from public.deals deal
  where deal.organization_id = target_organization_id
    and deal.id = target_deal_id
    and deal.archived_at is null
  for update;
  if not found then
    raise exception 'That opportunity is not available.'
      using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.follow_up_sequences sequence
    where sequence.organization_id = target_organization_id
      and sequence.id = target_sequence_id
      and sequence.is_active
  ) then
    raise exception 'That follow-up sequence is not active.'
      using errcode = 'P0002';
  end if;

  select count(*)
  into created_count
  from public.follow_up_sequence_steps step
  where step.organization_id = target_organization_id
    and step.sequence_id = target_sequence_id;
  if created_count = 0 then
    raise exception 'That follow-up sequence has no steps.'
      using errcode = '22023';
  end if;

  insert into public.deal_follow_up_sequence_runs (
    organization_id,
    deal_id,
    sequence_id,
    enrolled_by,
    tasks_created
  )
  values (
    target_organization_id,
    target_deal_id,
    target_sequence_id,
    actor_id,
    created_count
  )
  returning id into created_run_id;

  insert into public.tasks (
    organization_id,
    contact_id,
    deal_id,
    title,
    due_at,
    assignee_id
  )
  select
    target_organization_id,
    current_deal.contact_id,
    target_deal_id,
    step.title,
    statement_timestamp() + step.delay_days * interval '1 day',
    current_deal.owner_id
  from public.follow_up_sequence_steps step
  where step.organization_id = target_organization_id
    and step.sequence_id = target_sequence_id
  order by step.position;

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
    'follow_up_sequence_applied',
    format('Internal follow-up sequence created %s tasks.', created_count),
    jsonb_build_object(
      'sequence_id',
      target_sequence_id,
      'run_id',
      created_run_id,
      'tasks_created',
      created_count
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
    'deal_follow_up_sequence_run',
    created_run_id,
    jsonb_build_object(
      'event',
      'deal.follow_up_sequence_applied',
      'deal_id',
      target_deal_id,
      'sequence_id',
      target_sequence_id,
      'tasks_created',
      created_count
    )
  );

  return query select created_run_id, created_count;
exception
  when unique_violation then
    raise exception 'This follow-up sequence is already applied to the opportunity.'
      using errcode = '23505';
end;
$$;

create or replace function private.enforce_required_qualification_checks()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.stage is distinct from new.stage
    and new.stage in ('proposal', 'decision', 'won')
    and exists (
      select 1
      from public.deal_qualification_checks check_record
      where check_record.organization_id = new.organization_id
        and check_record.deal_id = new.id
        and check_record.is_required
        and not check_record.is_complete
    )
  then
    raise exception 'Complete every required qualification check before advancing this opportunity.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_required_qualification_checks()
  from public;
create trigger deals_enforce_required_qualification_checks
  before update of stage on public.deals
  for each row execute function private.enforce_required_qualification_checks();

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
      'qualification_checklist_applied',
      'qualification_check_updated',
      'follow_up_sequence_applied',
      'task_created',
      'task_status_changed',
      'conversation_sla_updated',
      'conversation_sla_escalated',
      'message_draft_created',
      'ai_observation'
    )
  );

revoke all on function public.create_qualification_checklist_template(
  uuid,
  text,
  text,
  jsonb
) from public, anon;
grant execute on function public.create_qualification_checklist_template(
  uuid,
  text,
  text,
  jsonb
) to authenticated, service_role;

revoke all on function public.create_follow_up_sequence(
  uuid,
  text,
  text,
  jsonb
) from public, anon;
grant execute on function public.create_follow_up_sequence(
  uuid,
  text,
  text,
  jsonb
) to authenticated, service_role;

revoke all on function public.apply_qualification_checklist(
  uuid,
  uuid,
  uuid
) from public, anon;
grant execute on function public.apply_qualification_checklist(
  uuid,
  uuid,
  uuid
) to authenticated, service_role;

revoke all on function public.set_deal_qualification_check(
  uuid,
  uuid,
  boolean
) from public, anon;
grant execute on function public.set_deal_qualification_check(
  uuid,
  uuid,
  boolean
) to authenticated, service_role;

revoke all on function public.apply_follow_up_sequence(
  uuid,
  uuid,
  uuid
) from public, anon;
grant execute on function public.apply_follow_up_sequence(
  uuid,
  uuid,
  uuid
) to authenticated, service_role;
