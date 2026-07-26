-- Commercial and trip-operation core. Apply after the communications migration.

create type public.quote_status as enum ('draft', 'shared', 'accepted', 'rejected', 'expired', 'superseded');
create type public.trip_status as enum ('draft', 'confirmed', 'in_travel', 'completed', 'cancelled');
create type public.booking_status as enum ('draft', 'requested', 'confirmed', 'cancelled', 'failed');
create type public.payment_status as enum ('pending', 'partially_paid', 'paid', 'overdue', 'refunded', 'void');
create type public.document_sensitivity as enum ('normal', 'restricted');

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 180),
  category text,
  email text,
  phone text,
  terms jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive', 'pending_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  status public.quote_status not null default 'draft',
  current_version integer not null default 1 check (current_version > 0),
  currency char(3) not null default 'INR',
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version integer not null check (version > 0),
  itinerary_snapshot jsonb not null default '{}'::jsonb,
  cost_lines jsonb not null default '[]'::jsonb,
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  margin_amount numeric(14, 2),
  margin_percent numeric(7, 4),
  terms_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quote_id, version)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 1 and 180),
  status public.trip_status not null default 'draft',
  start_date date,
  end_date date,
  currency char(3) not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.travelers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text,
  email text,
  phone text,
  date_of_birth date,
  role text not null default 'traveler' check (role in ('lead_traveler', 'traveler', 'child')),
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  position integer not null default 0,
  item_type text not null check (item_type in ('flight', 'stay', 'transfer', 'activity', 'meal', 'free_time', 'note')),
  title text not null check (char_length(title) between 1 and 300),
  starts_at timestamptz,
  ends_at timestamptz,
  location jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, day_number, position)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  booking_type text not null check (booking_type in ('flight', 'hotel', 'transfer', 'activity', 'insurance', 'other')),
  status public.booking_status not null default 'draft',
  confirmation_reference text,
  service_start_at timestamptz,
  service_end_at timestamptz,
  cost_amount numeric(14, 2),
  currency char(3) not null default 'INR',
  details jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.itinerary_items
  add constraint itinerary_items_booking_id_fkey foreign key (booking_id) references public.bookings(id) on delete set null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  direction text not null check (direction in ('receivable', 'payable')),
  status public.payment_status not null default 'pending',
  amount numeric(14, 2) not null check (amount >= 0),
  currency char(3) not null default 'INR',
  due_at date,
  paid_at timestamptz,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 300),
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sensitivity public.document_sensitivity not null default 'normal',
  expires_at date,
  created_at timestamptz not null default now(),
  check (contact_id is not null or trip_id is not null)
);

create index suppliers_org_name_idx on public.suppliers (organization_id, lower(name));
create index quotes_deal_status_idx on public.quotes (deal_id, status, updated_at desc);
create index trips_org_status_dates_idx on public.trips (organization_id, status, start_date, end_date);
create index bookings_trip_status_idx on public.bookings (trip_id, status, service_start_at);
create index payments_org_due_idx on public.payments (organization_id, status, due_at) where status in ('pending', 'partially_paid', 'overdue');
create index documents_org_expiry_idx on public.documents (organization_id, expires_at) where expires_at is not null;

create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
create trigger quotes_set_updated_at before update on public.quotes for each row execute function public.set_updated_at();
create trigger trips_set_updated_at before update on public.trips for each row execute function public.set_updated_at();
create trigger travelers_set_updated_at before update on public.travelers for each row execute function public.set_updated_at();
create trigger itinerary_items_set_updated_at before update on public.itinerary_items for each row execute function public.set_updated_at();
create trigger bookings_set_updated_at before update on public.bookings for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_versions enable row level security;
alter table public.trips enable row level security;
alter table public.travelers enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.documents enable row level security;

create policy "members may access suppliers" on public.suppliers for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access quotes" on public.quotes for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access quote versions" on public.quote_versions for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access trips" on public.trips for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access travelers" on public.travelers for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access itinerary items" on public.itinerary_items for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));
create policy "members may access bookings" on public.bookings for all to authenticated using (public.is_active_member(organization_id)) with check (public.is_active_member(organization_id));

create policy "members may read payments" on public.payments for select to authenticated using (public.is_active_member(organization_id));
create policy "finance may manage payments" on public.payments for all to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.app_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.app_role[]));

create policy "members may read normal documents" on public.documents for select to authenticated
  using (public.is_active_member(organization_id) and (sensitivity = 'normal' or public.has_organization_role(organization_id, array['owner', 'admin', 'operations', 'finance']::public.app_role[])));
create policy "members may add normal documents" on public.documents for insert to authenticated
  with check (public.is_active_member(organization_id) and (sensitivity = 'normal' or public.has_organization_role(organization_id, array['owner', 'admin', 'operations', 'finance']::public.app_role[])));
create policy "authorized users may update documents" on public.documents for update to authenticated
  using (public.is_active_member(organization_id) and (sensitivity = 'normal' or public.has_organization_role(organization_id, array['owner', 'admin', 'operations', 'finance']::public.app_role[])))
  with check (public.is_active_member(organization_id) and (sensitivity = 'normal' or public.has_organization_role(organization_id, array['owner', 'admin', 'operations', 'finance']::public.app_role[])));
