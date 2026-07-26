-- Explicit Data API privileges. RLS remains the row-level authorization layer.
-- This prevents anonymous access and makes authenticated access intentional.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table
  public.profiles,
  public.organizations,
  public.memberships,
  public.contacts,
  public.deals,
  public.tasks,
  public.audit_events,
  public.conversations,
  public.messages,
  public.approval_requests,
  public.ai_runs,
  public.ai_tool_calls,
  public.suppliers,
  public.quotes,
  public.quote_versions,
  public.trips,
  public.travelers,
  public.itinerary_items,
  public.bookings,
  public.payments,
  public.documents
to authenticated;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
