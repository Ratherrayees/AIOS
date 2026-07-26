-- Workspace-approved model prices. No vendor rate is seeded or inferred:
-- estimates remain absent until an owner/admin records a reviewed rate.

create table public.ai_model_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  provider text not null
    check (provider in ('glm', 'openai', 'gemini', 'anthropic', 'qwen')),
  model text not null
    check (char_length(model) between 1 and 120),
  currency char(3) not null
    check (currency = upper(currency)),
  input_price_per_million numeric(18, 6) not null
    check (input_price_per_million >= 0),
  output_price_per_million numeric(18, 6) not null
    check (output_price_per_million >= 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  approved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_model_prices_organization_id_id_key
    unique (organization_id, id),
  constraint ai_model_prices_version_key
    unique (organization_id, provider, model, effective_from),
  constraint ai_model_prices_effective_window_check
    check (effective_to is null or effective_to > effective_from),
  constraint ai_model_prices_approver_same_organization_fkey
    foreign key (organization_id, approved_by)
    references public.memberships (organization_id, user_id)
    on delete set null (approved_by)
);

create index ai_model_prices_lookup_idx
  on public.ai_model_prices (
    organization_id,
    provider,
    model,
    effective_from desc
  );

create trigger ai_model_prices_set_updated_at
  before update on public.ai_model_prices
  for each row execute function public.set_updated_at();
create trigger ai_model_prices_prevent_organization_move
  before update on public.ai_model_prices
  for each row execute function private.prevent_organization_id_change();

create or replace function private.preserve_ai_model_price_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.provider <> new.provider
    or old.model <> new.model
    or old.currency <> new.currency
    or old.input_price_per_million <> new.input_price_per_million
    or old.output_price_per_million <> new.output_price_per_million
    or old.effective_from <> new.effective_from
    or old.approved_by is distinct from new.approved_by then
    raise exception 'Model price versions are immutable; add a new version.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.preserve_ai_model_price_version() from public;

create trigger ai_model_prices_preserve_version
  before update on public.ai_model_prices
  for each row execute function private.preserve_ai_model_price_version();

alter table public.ai_model_prices enable row level security;
grant select, insert, update on table public.ai_model_prices to authenticated;

create policy "members may read model prices"
  on public.ai_model_prices
  for select
  to authenticated
  using (public.is_active_member(organization_id));
create policy "owners and admins may add model prices"
  on public.ai_model_prices
  for insert
  to authenticated
  with check (
    approved_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  );
create policy "owners and admins may retire model prices"
  on public.ai_model_prices
  for update
  to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    )
  );
create policy "verified MFA factors require aal2"
  on public.ai_model_prices
  as restrictive
  for all
  to authenticated
  using (public.meets_mfa_requirement())
  with check (public.meets_mfa_requirement());

alter table public.ai_runs
  add column estimated_cost_currency char(3)
    check (
      estimated_cost_currency is null
      or estimated_cost_currency = upper(estimated_cost_currency)
    ),
  add column model_price_id uuid,
  add constraint ai_runs_model_price_same_organization_fkey
    foreign key (organization_id, model_price_id)
    references public.ai_model_prices (organization_id, id)
    on delete set null (model_price_id);
