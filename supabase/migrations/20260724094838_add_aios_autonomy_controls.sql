create type public.ai_autonomy_mode as enum ('observe', 'assist', 'auto', 'approval_required');

create table public.ai_autonomy_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action text not null check (char_length(action) between 3 and 120),
  mode public.ai_autonomy_mode not null default 'assist',
  approval_roles public.app_role[] not null default array['owner', 'admin']::public.app_role[],
  escalation_after_minutes integer not null default 30 check (escalation_after_minutes between 1 and 10080),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, action)
);

create index ai_autonomy_policies_organization_action_idx
  on public.ai_autonomy_policies (organization_id, action);

create trigger ai_autonomy_policies_set_updated_at
  before update on public.ai_autonomy_policies
  for each row execute function public.set_updated_at();

alter table public.ai_autonomy_policies enable row level security;

create policy "members may read autonomy policies" on public.ai_autonomy_policies
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "owners and admins may insert autonomy policies" on public.ai_autonomy_policies
  for insert to authenticated
  with check (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins may update autonomy policies" on public.ai_autonomy_policies
  for update to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins may delete autonomy policies" on public.ai_autonomy_policies
  for delete to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.app_role[]));

grant select, insert, update, delete on table public.ai_autonomy_policies to authenticated;
