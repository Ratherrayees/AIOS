-- Reusable content and scheduled drafts are internal planning records. This
-- schema deliberately has no sent/delivered state and no delivery function.

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  channel text not null default 'email'
    check (channel in ('email', 'whatsapp')),
  subject text check (subject is null or char_length(subject) <= 300),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_by uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index message_templates_org_name_idx
  on public.message_templates (organization_id, lower(btrim(name)));
create index message_templates_org_active_idx
  on public.message_templates (organization_id, channel, updated_at desc)
  where is_active;

create table public.message_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  template_id uuid,
  created_by uuid not null references public.profiles(id) on delete restrict,
  channel text not null default 'email'
    check (channel in ('email', 'whatsapp')),
  recipient text check (recipient is null or char_length(recipient) <= 320),
  subject text check (subject is null or char_length(subject) <= 300),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  status text not null default 'draft'
    check (status in ('draft', 'ready_for_review')),
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint message_drafts_conversation_same_organization_fkey
    foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id)
    on delete cascade,
  constraint message_drafts_template_same_organization_fkey
    foreign key (organization_id, template_id)
    references public.message_templates (organization_id, id)
    on delete set null (template_id)
);

create index message_drafts_conversation_idx
  on public.message_drafts (
    organization_id,
    conversation_id,
    status,
    scheduled_for,
    updated_at desc
  )
  where archived_at is null;

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();
create trigger message_templates_prevent_organization_move
  before update on public.message_templates
  for each row execute function private.prevent_organization_id_change();
create trigger message_drafts_set_updated_at
  before update on public.message_drafts
  for each row execute function public.set_updated_at();
create trigger message_drafts_prevent_organization_move
  before update on public.message_drafts
  for each row execute function private.prevent_organization_id_change();

alter table public.message_templates enable row level security;
alter table public.message_drafts enable row level security;

grant select, insert, update on table public.message_templates to authenticated;
grant select, insert, update on table public.message_drafts to authenticated;

create policy "members may read message templates"
  on public.message_templates for select to authenticated
  using (public.is_active_member(organization_id));
create policy "inbox roles may create message templates"
  on public.message_templates for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'operations', 'agent']::public.app_role[]
    )
  );
create policy "inbox roles may update message templates"
  on public.message_templates for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'operations', 'agent']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'operations', 'agent']::public.app_role[]
    )
  );
create policy "verified MFA factors require aal2"
  on public.message_templates as restrictive for all to authenticated
  using (public.meets_mfa_requirement())
  with check (public.meets_mfa_requirement());

create policy "members may read message drafts"
  on public.message_drafts for select to authenticated
  using (public.is_active_member(organization_id));
create policy "inbox roles may create message drafts"
  on public.message_drafts for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'operations', 'agent']::public.app_role[]
    )
  );
create policy "inbox roles may update message drafts"
  on public.message_drafts for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'operations', 'agent']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'operations', 'agent']::public.app_role[]
    )
  );
create policy "verified MFA factors require aal2"
  on public.message_drafts as restrictive for all to authenticated
  using (public.meets_mfa_requirement())
  with check (public.meets_mfa_requirement());

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
      'task_created',
      'task_status_changed',
      'conversation_sla_updated',
      'message_draft_created',
      'ai_observation'
    )
  );
