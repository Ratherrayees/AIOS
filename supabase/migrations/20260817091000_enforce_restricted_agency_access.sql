-- Restricted agencies are retained for review but cannot operate the CRM.
-- Only the active lifecycle state resolves as an authorized tenant workspace.

create or replace function public.is_active_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.memberships membership
    join public.organization_lifecycle lifecycle
      on lifecycle.organization_id = membership.organization_id
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and lifecycle.status = 'active'
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  permitted_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.memberships membership
    join public.organization_lifecycle lifecycle
      on lifecycle.organization_id = membership.organization_id
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any(permitted_roles)
      and lifecycle.status = 'active'
  );
$$;

