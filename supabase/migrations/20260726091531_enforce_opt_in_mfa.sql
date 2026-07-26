-- Opt-in MFA enforcement follows Supabase's documented AAL model: accounts
-- without a verified factor may use aal1 or aal2, while accounts that enrolled
-- a verified factor must present an aal2 JWT. A restrictive policy composes
-- this requirement with every existing tenant/role policy.

create or replace function public.meets_mfa_requirement()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    array[(select auth.jwt() ->> 'aal')] <@ (
      select
        case
          when count(factor.id) > 0 then array['aal2']
          else array['aal1', 'aal2']
        end
      from auth.mfa_factors as factor
      where factor.user_id = (select auth.uid())
        and factor.status = 'verified'
    );
$$;

revoke all on function public.meets_mfa_requirement() from public;
grant execute on function public.meets_mfa_requirement() to authenticated;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles',
    'organizations',
    'memberships',
    'contacts',
    'deals',
    'tasks',
    'audit_events',
    'conversations',
    'messages',
    'approval_requests',
    'ai_runs',
    'ai_tool_calls',
    'ai_autonomy_policies',
    'email_webhook_events',
    'suppliers',
    'quotes',
    'quote_versions',
    'quote_cost_estimates',
    'trips',
    'travelers',
    'itinerary_items',
    'itinerary_templates',
    'itinerary_template_items',
    'itinerary_comments',
    'bookings',
    'payments',
    'documents',
    'companies',
    'activity_events',
    'ai_field_reviews',
    'organization_invitations'
  ]
  loop
    execute format(
      'create policy "verified MFA factors require aal2" on public.%I as restrictive for all to authenticated using (public.meets_mfa_requirement()) with check (public.meets_mfa_requirement())',
      target_table
    );
  end loop;
end;
$$;

create or replace function private.enforce_mfa_membership_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.uid()) is not null
    and not public.meets_mfa_requirement() then
    raise exception 'Multi-factor verification is required for membership changes.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_mfa_membership_mutation() from public;

create trigger memberships_enforce_mfa_mutation
  before insert or update or delete on public.memberships
  for each row execute function private.enforce_mfa_membership_mutation();
