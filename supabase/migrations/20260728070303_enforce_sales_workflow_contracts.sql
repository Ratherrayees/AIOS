create or replace function private.enforce_follow_up_step_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.follow_up_sequence_steps existing
    where existing.organization_id = new.organization_id
      and existing.sequence_id = new.sequence_id
      and existing.id <> new.id
      and (
        (
          existing.position < new.position
          and existing.delay_days > new.delay_days
        )
        or (
          existing.position > new.position
          and existing.delay_days < new.delay_days
        )
      )
  ) then
    raise exception 'Sequence delays must not move backwards.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_follow_up_step_order()
  from public;

create trigger follow_up_steps_enforce_order
  before insert or update of organization_id, sequence_id, position, delay_days
  on public.follow_up_sequence_steps
  for each row execute function private.enforce_follow_up_step_order();

create or replace function private.enforce_follow_up_run_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.deals deal
    where deal.organization_id = new.organization_id
      and deal.id = new.deal_id
      and deal.owner_id is not null
      and deal.archived_at is null
  ) then
    raise exception 'Assign an opportunity owner before applying a follow-up sequence.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_follow_up_run_owner()
  from public;

create trigger follow_up_runs_require_owner
  before insert or update of organization_id, deal_id
  on public.deal_follow_up_sequence_runs
  for each row execute function private.enforce_follow_up_run_owner();
