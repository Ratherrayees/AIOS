-- User-private saved views within an active organization. The generic feature
-- and JSON filter shape can be adopted incrementally by each product module.

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null
    check (feature ~ '^[a-z][a-z0-9_]{1,49}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  filters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filters) = 'object'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index saved_views_user_feature_name_idx
  on public.saved_views (
    organization_id,
    user_id,
    feature,
    lower(btrim(name))
  );
create unique index saved_views_one_default_idx
  on public.saved_views (organization_id, user_id, feature)
  where is_default;
create index saved_views_user_feature_idx
  on public.saved_views (user_id, organization_id, feature, updated_at desc);

create trigger saved_views_set_updated_at
  before update on public.saved_views
  for each row execute function public.set_updated_at();
create trigger saved_views_prevent_organization_move
  before update on public.saved_views
  for each row execute function private.prevent_organization_id_change();

alter table public.saved_views enable row level security;
grant select, insert, update, delete on table public.saved_views
  to authenticated;

create policy "users may read their own saved views"
  on public.saved_views
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_active_member(organization_id)
  );
create policy "users may create their own saved views"
  on public.saved_views
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_member(organization_id)
  );
create policy "users may update their own saved views"
  on public.saved_views
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_active_member(organization_id)
  )
  with check (
    user_id = (select auth.uid())
    and public.is_active_member(organization_id)
  );
create policy "users may delete their own saved views"
  on public.saved_views
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_active_member(organization_id)
  );
create policy "verified MFA factors require aal2"
  on public.saved_views
  as restrictive
  for all
  to authenticated
  using (public.meets_mfa_requirement())
  with check (public.meets_mfa_requirement());
