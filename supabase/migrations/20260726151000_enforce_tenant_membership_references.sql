-- Owner and assignee fields represent workspace membership. Composite foreign
-- keys keep those references in the row's organization even when writes arrive
-- outside the application server actions.

alter table public.companies
  drop constraint companies_owner_id_fkey,
  add constraint companies_owner_same_organization_fkey
    foreign key (organization_id, owner_id)
    references public.memberships (organization_id, user_id)
    on delete set null (owner_id);

alter table public.deals
  drop constraint deals_owner_id_fkey,
  add constraint deals_owner_same_organization_fkey
    foreign key (organization_id, owner_id)
    references public.memberships (organization_id, user_id)
    on delete set null (owner_id);

alter table public.tasks
  drop constraint tasks_assignee_id_fkey,
  add constraint tasks_assignee_same_organization_fkey
    foreign key (organization_id, assignee_id)
    references public.memberships (organization_id, user_id)
    on delete set null (assignee_id);

alter table public.conversations
  drop constraint conversations_assignee_id_fkey,
  add constraint conversations_assignee_same_organization_fkey
    foreign key (organization_id, assignee_id)
    references public.memberships (organization_id, user_id)
    on delete set null (assignee_id);

alter table public.quotes
  drop constraint quotes_owner_id_fkey,
  add constraint quotes_owner_same_organization_fkey
    foreign key (organization_id, owner_id)
    references public.memberships (organization_id, user_id)
    on delete set null (owner_id);

alter table public.trips
  drop constraint trips_owner_id_fkey,
  add constraint trips_owner_same_organization_fkey
    foreign key (organization_id, owner_id)
    references public.memberships (organization_id, user_id)
    on delete set null (owner_id);

create index if not exists companies_owner_active_idx
  on public.companies (organization_id, owner_id, updated_at desc)
  where archived_at is null;
create index if not exists deals_owner_active_idx
  on public.deals (organization_id, owner_id, updated_at desc)
  where archived_at is null;
create index if not exists tasks_assignee_active_idx
  on public.tasks (organization_id, assignee_id, due_at)
  where status in ('open', 'in_progress');
create index if not exists conversations_assignee_active_idx
  on public.conversations (organization_id, assignee_id, last_message_at desc)
  where archived_at is null;
create index if not exists quotes_owner_active_idx
  on public.quotes (organization_id, owner_id, updated_at desc);
create index if not exists trips_owner_active_idx
  on public.trips (organization_id, owner_id, updated_at desc);
