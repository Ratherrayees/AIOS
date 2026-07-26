-- Workspace-level model execution controls. These govern provider-backed
-- model runs independently from per-action autonomy policies.

create table public.ai_budget_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique
    references public.organizations(id) on delete cascade,
  daily_model_run_limit integer not null default 30
    check (daily_model_run_limit between 1 and 1000),
  model_execution_enabled boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_budget_policies_updater_same_organization_fkey
    foreign key (organization_id, updated_by)
    references public.memberships (organization_id, user_id)
    on delete set null (updated_by)
);

create trigger ai_budget_policies_set_updated_at
  before update on public.ai_budget_policies
  for each row execute function public.set_updated_at();
create trigger ai_budget_policies_prevent_organization_move
  before update on public.ai_budget_policies
  for each row execute function private.prevent_organization_id_change();

alter table public.ai_budget_policies enable row level security;
grant select, insert, update on table public.ai_budget_policies to authenticated;

create policy "members may read AI budget policies"
  on public.ai_budget_policies for select to authenticated
  using (public.is_active_member(organization_id));
create policy "owners and admins may create AI budget policies"
  on public.ai_budget_policies for insert to authenticated
  with check (
    updated_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  );
create policy "owners and admins may update AI budget policies"
  on public.ai_budget_policies for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  )
  with check (
    updated_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  );
create policy "verified MFA factors require aal2"
  on public.ai_budget_policies as restrictive for all to authenticated
  using (public.meets_mfa_requirement())
  with check (public.meets_mfa_requirement());
