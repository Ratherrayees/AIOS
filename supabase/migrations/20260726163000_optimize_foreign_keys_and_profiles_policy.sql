-- Added after all existing 26 July migrations; the CLI-generated timestamp
-- preceded already-created migrations in this workspace.

-- Cover every foreign-key lookup reported by the Supabase performance advisor.
-- These indexes protect joins, tenant checks, and cascading parent deletes.
create index if not exists activity_events_actor_idx
  on public.activity_events (actor_id);
create index if not exists activity_events_org_company_idx
  on public.activity_events (organization_id, company_id);
create index if not exists activity_events_org_contact_idx
  on public.activity_events (organization_id, contact_id);
create index if not exists activity_events_org_deal_idx
  on public.activity_events (organization_id, deal_id);

create index if not exists ai_budget_policies_org_updater_idx
  on public.ai_budget_policies (organization_id, updated_by);
create index if not exists ai_field_reviews_org_run_idx
  on public.ai_field_reviews (organization_id, ai_run_id);
create index if not exists ai_field_reviews_reviewer_idx
  on public.ai_field_reviews (reviewed_by);
create index if not exists ai_model_prices_org_approver_idx
  on public.ai_model_prices (organization_id, approved_by);
create index if not exists ai_runs_org_approval_idx
  on public.ai_runs (organization_id, approval_request_id);
create index if not exists ai_runs_initiator_idx
  on public.ai_runs (initiated_by);
create index if not exists ai_runs_org_model_price_idx
  on public.ai_runs (organization_id, model_price_id);
create index if not exists ai_tool_calls_org_run_idx
  on public.ai_tool_calls (organization_id, ai_run_id);
create index if not exists ai_tool_calls_org_idx
  on public.ai_tool_calls (organization_id);

create index if not exists approval_requests_approver_idx
  on public.approval_requests (approver_id);
create index if not exists approval_requests_requester_idx
  on public.approval_requests (requester_id);
create index if not exists audit_events_actor_idx
  on public.audit_events (actor_id);

create index if not exists bookings_org_supplier_idx
  on public.bookings (organization_id, supplier_id);
create index if not exists bookings_org_trip_idx
  on public.bookings (organization_id, trip_id);
create index if not exists contacts_org_company_idx
  on public.contacts (organization_id, company_id);
create index if not exists conversations_org_contact_idx
  on public.conversations (organization_id, contact_id);
create index if not exists conversations_org_deal_idx
  on public.conversations (organization_id, deal_id);
create index if not exists deals_org_contact_idx
  on public.deals (organization_id, contact_id);

create index if not exists documents_org_contact_idx
  on public.documents (organization_id, contact_id);
create index if not exists documents_org_trip_idx
  on public.documents (organization_id, trip_id);
create index if not exists documents_uploader_idx
  on public.documents (uploaded_by);
create index if not exists itinerary_comments_creator_idx
  on public.itinerary_comments (created_by);
create index if not exists itinerary_comments_trip_org_idx
  on public.itinerary_comments (trip_id, organization_id);
create index if not exists itinerary_items_org_booking_idx
  on public.itinerary_items (organization_id, booking_id);
create index if not exists itinerary_items_org_idx
  on public.itinerary_items (organization_id);
create index if not exists itinerary_items_org_trip_idx
  on public.itinerary_items (organization_id, trip_id);
create index if not exists itinerary_template_items_template_org_idx
  on public.itinerary_template_items (itinerary_template_id, organization_id);
create index if not exists itinerary_templates_creator_idx
  on public.itinerary_templates (created_by);

create index if not exists message_drafts_creator_idx
  on public.message_drafts (created_by);
create index if not exists message_drafts_org_template_idx
  on public.message_drafts (organization_id, template_id);
create index if not exists message_templates_creator_idx
  on public.message_templates (created_by);
create index if not exists messages_author_idx
  on public.messages (author_id);
create index if not exists messages_org_conversation_idx
  on public.messages (organization_id, conversation_id);
create index if not exists messages_org_idx
  on public.messages (organization_id);

create index if not exists payments_org_deal_idx
  on public.payments (organization_id, deal_id);
create index if not exists payments_org_trip_idx
  on public.payments (organization_id, trip_id);
create index if not exists quote_cost_estimates_creator_idx
  on public.quote_cost_estimates (created_by);
create index if not exists quote_versions_creator_idx
  on public.quote_versions (created_by);
create index if not exists quote_versions_org_quote_idx
  on public.quote_versions (organization_id, quote_id);
create index if not exists quotes_org_deal_idx
  on public.quotes (organization_id, deal_id);
create index if not exists tasks_org_contact_idx
  on public.tasks (organization_id, contact_id);
create index if not exists travelers_org_contact_idx
  on public.travelers (organization_id, contact_id);
create index if not exists travelers_org_idx
  on public.travelers (organization_id);
create index if not exists travelers_org_trip_idx
  on public.travelers (organization_id, trip_id);
create index if not exists trips_org_deal_idx
  on public.trips (organization_id, deal_id);
create index if not exists trips_org_quote_idx
  on public.trips (organization_id, quote_id);

-- Keep the more descriptive original task index and remove its duplicate.
drop index if exists public.tasks_assignee_active_idx;

-- One permissive SELECT policy avoids evaluating two equivalent profile paths.
drop policy if exists "profile owner may read profile" on public.profiles;
drop policy if exists "workspace members may read teammate profiles"
  on public.profiles;
create policy "profile owner or teammate may read profile"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select public.shares_active_organization(id))
  );
