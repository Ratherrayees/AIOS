-- RLS controls which rows a caller can see and mutate. Composite foreign keys
-- also make it impossible for a tenant-owned row to reference a record from a
-- different organization, even if a foreign UUID is guessed or supplied by a
-- privileged integration.

alter table public.companies
  add constraint companies_organization_id_id_key unique (organization_id, id);
alter table public.contacts
  add constraint contacts_organization_id_id_key unique (organization_id, id);
alter table public.deals
  add constraint deals_organization_id_id_key unique (organization_id, id);
alter table public.conversations
  add constraint conversations_organization_id_id_key unique (organization_id, id);
alter table public.approval_requests
  add constraint approval_requests_organization_id_id_key unique (organization_id, id);
alter table public.ai_runs
  add constraint ai_runs_organization_id_id_key unique (organization_id, id);
alter table public.quotes
  add constraint quotes_organization_id_id_key unique (organization_id, id);
alter table public.quote_versions
  add constraint quote_versions_organization_id_id_key unique (organization_id, id);
alter table public.trips
  add constraint trips_organization_id_id_key unique (organization_id, id);
alter table public.suppliers
  add constraint suppliers_organization_id_id_key unique (organization_id, id);
alter table public.bookings
  add constraint bookings_organization_id_id_key unique (organization_id, id);

alter table public.contacts
  drop constraint contacts_company_id_fkey,
  add constraint contacts_company_same_organization_fkey
    foreign key (organization_id, company_id)
    references public.companies (organization_id, id)
    on delete set null (company_id);

alter table public.deals
  drop constraint deals_contact_id_fkey,
  add constraint deals_contact_same_organization_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id)
    on delete set null (contact_id);

alter table public.tasks
  drop constraint tasks_contact_id_fkey,
  drop constraint tasks_deal_id_fkey,
  add constraint tasks_contact_same_organization_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id)
    on delete cascade,
  add constraint tasks_deal_same_organization_fkey
    foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete cascade;

alter table public.activity_events
  drop constraint activity_events_contact_id_fkey,
  drop constraint activity_events_company_id_fkey,
  drop constraint activity_events_deal_id_fkey,
  add constraint activity_events_contact_same_organization_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id)
    on delete cascade,
  add constraint activity_events_company_same_organization_fkey
    foreign key (organization_id, company_id)
    references public.companies (organization_id, id)
    on delete cascade,
  add constraint activity_events_deal_same_organization_fkey
    foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete cascade;

alter table public.conversations
  drop constraint conversations_contact_id_fkey,
  drop constraint conversations_deal_id_fkey,
  add constraint conversations_contact_same_organization_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id)
    on delete set null (contact_id),
  add constraint conversations_deal_same_organization_fkey
    foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete set null (deal_id);

alter table public.messages
  drop constraint messages_conversation_id_fkey,
  add constraint messages_conversation_same_organization_fkey
    foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id)
    on delete cascade;

alter table public.ai_runs
  drop constraint ai_runs_approval_request_id_fkey,
  add constraint ai_runs_approval_request_same_organization_fkey
    foreign key (organization_id, approval_request_id)
    references public.approval_requests (organization_id, id)
    on delete set null (approval_request_id);

alter table public.ai_tool_calls
  drop constraint ai_tool_calls_ai_run_id_fkey,
  add constraint ai_tool_calls_ai_run_same_organization_fkey
    foreign key (organization_id, ai_run_id)
    references public.ai_runs (organization_id, id)
    on delete cascade;

alter table public.ai_field_reviews
  drop constraint ai_field_reviews_ai_run_id_fkey,
  add constraint ai_field_reviews_ai_run_same_organization_fkey
    foreign key (organization_id, ai_run_id)
    references public.ai_runs (organization_id, id)
    on delete cascade;

alter table public.quotes
  drop constraint quotes_deal_id_fkey,
  add constraint quotes_deal_same_organization_fkey
    foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete cascade;

alter table public.quote_versions
  drop constraint quote_versions_quote_id_fkey,
  add constraint quote_versions_quote_same_organization_fkey
    foreign key (organization_id, quote_id)
    references public.quotes (organization_id, id)
    on delete cascade;

alter table public.quote_cost_estimates
  drop constraint quote_cost_estimates_quote_version_id_fkey,
  add constraint quote_cost_estimates_quote_version_same_organization_fkey
    foreign key (organization_id, quote_version_id)
    references public.quote_versions (organization_id, id)
    on delete cascade;

alter table public.trips
  drop constraint trips_deal_id_fkey,
  drop constraint trips_quote_id_fkey,
  add constraint trips_deal_same_organization_fkey
    foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete set null (deal_id),
  add constraint trips_quote_same_organization_fkey
    foreign key (organization_id, quote_id)
    references public.quotes (organization_id, id)
    on delete set null (quote_id);

alter table public.travelers
  drop constraint travelers_trip_id_fkey,
  drop constraint travelers_contact_id_fkey,
  add constraint travelers_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade,
  add constraint travelers_contact_same_organization_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id)
    on delete set null (contact_id);

alter table public.itinerary_items
  drop constraint itinerary_items_trip_id_fkey,
  drop constraint itinerary_items_booking_id_fkey,
  add constraint itinerary_items_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade,
  add constraint itinerary_items_booking_same_organization_fkey
    foreign key (organization_id, booking_id)
    references public.bookings (organization_id, id)
    on delete set null (booking_id);

alter table public.bookings
  drop constraint bookings_trip_id_fkey,
  drop constraint bookings_supplier_id_fkey,
  add constraint bookings_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade,
  add constraint bookings_supplier_same_organization_fkey
    foreign key (organization_id, supplier_id)
    references public.suppliers (organization_id, id)
    on delete set null (supplier_id);

alter table public.payments
  drop constraint payments_deal_id_fkey,
  drop constraint payments_trip_id_fkey,
  add constraint payments_deal_same_organization_fkey
    foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete set null (deal_id),
  add constraint payments_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete set null (trip_id);

alter table public.documents
  drop constraint documents_contact_id_fkey,
  drop constraint documents_trip_id_fkey,
  add constraint documents_contact_same_organization_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id)
    on delete cascade,
  add constraint documents_trip_same_organization_fkey
    foreign key (organization_id, trip_id)
    references public.trips (organization_id, id)
    on delete cascade;
