-- Trip collaboration is internal, append-only, and tenant-bound at both the
-- foreign-key and RLS layers.
alter table public.trips
  add constraint trips_id_organization_key unique (id, organization_id);

create table public.itinerary_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trip_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint itinerary_comments_trip_organization_fkey
    foreign key (trip_id, organization_id)
    references public.trips(id, organization_id)
    on delete cascade
);

create index itinerary_comments_organization_trip_created_idx
  on public.itinerary_comments (organization_id, trip_id, created_at desc);

alter table public.itinerary_comments enable row level security;
grant select, insert on table public.itinerary_comments to authenticated;
revoke all on table public.itinerary_comments from anon;

create policy "members may read itinerary comments" on public.itinerary_comments
  for select to authenticated
  using (public.is_active_member(organization_id));

create policy "members may add their own itinerary comments" on public.itinerary_comments
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_active_member(organization_id)
  );
