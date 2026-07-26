-- Reusable itinerary patterns stay internal to each tenant. Items are copied
-- only through security-invoker functions after an explicit planner action.
create table public.itinerary_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 1200),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id)
);

create unique index itinerary_templates_live_name_idx
  on public.itinerary_templates (organization_id, lower(name))
  where archived_at is null;

create index itinerary_templates_organization_updated_idx
  on public.itinerary_templates (organization_id, updated_at desc)
  where archived_at is null;

create table public.itinerary_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  itinerary_template_id uuid not null,
  day_number integer not null check (day_number between 1 and 365),
  position integer not null check (position >= 0),
  item_type text not null check (item_type in ('flight', 'stay', 'transfer', 'activity', 'meal', 'free_time', 'note')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  location jsonb not null default '{}'::jsonb check (jsonb_typeof(location) = 'object'),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_template_items_template_organization_fkey
    foreign key (itinerary_template_id, organization_id)
    references public.itinerary_templates(id, organization_id)
    on delete cascade,
  unique (itinerary_template_id, day_number, position)
);

create index itinerary_template_items_organization_template_idx
  on public.itinerary_template_items (organization_id, itinerary_template_id, day_number, position);

create trigger itinerary_templates_set_updated_at
  before update on public.itinerary_templates
  for each row execute function public.set_updated_at();

create trigger itinerary_template_items_set_updated_at
  before update on public.itinerary_template_items
  for each row execute function public.set_updated_at();

alter table public.itinerary_templates enable row level security;
alter table public.itinerary_template_items enable row level security;

grant select, insert, update, delete on table
  public.itinerary_templates,
  public.itinerary_template_items
to authenticated;
revoke all on table public.itinerary_templates, public.itinerary_template_items from anon;

create policy "members may read itinerary templates" on public.itinerary_templates
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "planning roles may add itinerary templates" on public.itinerary_templates
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );

create policy "planning roles may update itinerary templates" on public.itinerary_templates
  for update to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );

create policy "planning roles may delete itinerary templates" on public.itinerary_templates
  for delete to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );

create policy "members may read itinerary template items" on public.itinerary_template_items
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "planning roles may manage itinerary template items" on public.itinerary_template_items
  for all to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
    )
  );

create function public.create_itinerary_template_from_trip(
  target_organization_id uuid,
  source_trip_id uuid,
  template_name text,
  template_description text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  created_template_id uuid;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
  ) then
    raise exception 'You do not have permission to save itinerary templates.';
  end if;

  perform 1 from public.trips
  where id = source_trip_id and organization_id = target_organization_id;
  if not found then
    raise exception 'This trip is not available in this workspace.';
  end if;

  insert into public.itinerary_templates (
    organization_id, name, description, created_by
  ) values (
    target_organization_id, btrim(template_name), btrim(coalesce(template_description, '')),
    (select auth.uid())
  ) returning id into created_template_id;

  insert into public.itinerary_template_items (
    organization_id, itinerary_template_id, day_number, position, item_type,
    title, location, content
  )
  select
    target_organization_id, created_template_id, day_number, position, item_type,
    title, location, content
  from public.itinerary_items
  where organization_id = target_organization_id and trip_id = source_trip_id
  order by day_number, position;

  return created_template_id;
end;
$$;

create function public.append_itinerary_template_to_trip(
  target_organization_id uuid,
  target_template_id uuid,
  target_trip_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  copied_item_count integer;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'sales', 'trip_designer', 'operations']::public.app_role[]
  ) then
    raise exception 'You do not have permission to apply itinerary templates.';
  end if;

  perform 1 from public.trips
  where id = target_trip_id and organization_id = target_organization_id
  for update;
  if not found then
    raise exception 'This trip is not available in this workspace.';
  end if;

  perform 1 from public.itinerary_templates
  where id = target_template_id
    and organization_id = target_organization_id
    and archived_at is null;
  if not found then
    raise exception 'This itinerary template is not available in this workspace.';
  end if;

  insert into public.itinerary_items (
    organization_id, trip_id, day_number, position, item_type, title, location,
    content, booking_id
  )
  select
    target_organization_id,
    target_trip_id,
    source.day_number,
    source.base_position + source.day_offset,
    source.item_type,
    source.title,
    source.location,
    source.content,
    null
  from (
    select
      template_item.day_number,
      template_item.item_type,
      template_item.title,
      template_item.location,
      template_item.content,
      coalesce((
        select max(existing_item.position) + 1
        from public.itinerary_items as existing_item
        where existing_item.organization_id = target_organization_id
          and existing_item.trip_id = target_trip_id
          and existing_item.day_number = template_item.day_number
      ), 0) as base_position,
      row_number() over (
        partition by template_item.day_number
        order by template_item.position, template_item.id
      ) - 1 as day_offset
    from public.itinerary_template_items as template_item
    where template_item.organization_id = target_organization_id
      and template_item.itinerary_template_id = target_template_id
  ) as source
  order by source.day_number, source.day_offset;

  get diagnostics copied_item_count = row_count;
  return copied_item_count;
end;
$$;

revoke all on function public.create_itinerary_template_from_trip(uuid, uuid, text, text) from public;
revoke all on function public.append_itinerary_template_to_trip(uuid, uuid, uuid) from public;
grant execute on function public.create_itinerary_template_from_trip(uuid, uuid, text, text) to authenticated;
grant execute on function public.append_itinerary_template_to_trip(uuid, uuid, uuid) to authenticated;
