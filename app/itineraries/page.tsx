"use client";

import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import {
  createItineraryReadinessTask,
  getLatestItineraryDrafts,
  prepareItineraryDraft,
} from "../actions/agents";
import {
  addItineraryComment,
  addItineraryItem,
  applyItineraryTemplate,
  createItineraryTemplateFromTrip,
  createTripDraft,
  reorderItineraryItem,
} from "../actions/crm";
import type { ItineraryDraft } from "../../lib/ai/contracts";
import { assessItineraryConflicts } from "../../lib/crm/itinerary-conflicts";
import { assessItineraryReadiness } from "../../lib/crm/itinerary-readiness";
import { COMMON_TRAVEL_TIME_ZONES } from "../../lib/crm/time-zones";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionNotice,
} from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { OperationalPageHeader } from "../../components/ui/operational-page-header";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import "./itineraries.css";

type Trip = {
  id: string;
  deal_id: string | null;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  time_zone: string | null;
};
type Item = {
  id: string;
  trip_id: string;
  day_number: number;
  position: number;
  item_type: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  time_zone: string | null;
  location: unknown;
};
type ItineraryTemplate = {
  id: string;
  name: string;
  description: string;
};
type TemplateItem = {
  id: string;
  itinerary_template_id: string;
  day_number: number;
  item_type: string;
  title: string;
};
type ItineraryComment = {
  id: string;
  trip_id: string;
  body: string;
  created_at: string;
};

const planningRoles = new Set([
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
]);

function itineraryDayLabel(startDate: string | null, dayNumber: number) {
  if (!startDate) return "Date not set";
  const date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Date not set";
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function itineraryItemTime(value: string | null, timeZone: string | null) {
  if (!value) return "Time open";
  if (!timeZone) return "Zone needed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time open";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return "Zone needed";
  }
}

function itineraryItemLocation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name.trim() : "";
}

function formLocalDateTime(form: FormData, name: string) {
  const rawValue = String(form.get(name) || "").trim();
  return rawValue || null;
}

export default function ItinerariesPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [focusedDealId, setFocusedDealId] = useState("");
  const [focusedDealName, setFocusedDealName] = useState("");
  const [selectedTripId, setSelectedTripId] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<ItineraryTemplate[]>([]);
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [comments, setComments] = useState<ItineraryComment[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ItineraryDraft>>({});
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const canPlan = role ? planningRoles.has(role) : false;
  const focusedTrip = focusedDealId
    ? trips.find((trip) => trip.deal_id === focusedDealId) ?? null
    : null;
  const activeTrip =
    trips.find((trip) => trip.id === selectedTripId) ??
    focusedTrip ??
    trips[0] ??
    null;

  const readinessByTrip = useMemo(
    () =>
      new Map(
        trips.map((trip) => [
          trip.id,
          assessItineraryReadiness({
            startDate: trip.start_date,
            endDate: trip.end_date,
            items: items
              .filter((item) => item.trip_id === trip.id)
              .map((item) => ({
                dayNumber: item.day_number,
                itemType: item.item_type,
              })),
          }),
        ]),
      ),
    [items, trips],
  );
  const conflictsByTrip = useMemo(
    () =>
      new Map(
        trips.map((trip) => [
          trip.id,
          assessItineraryConflicts({
            startDate: trip.start_date,
            endDate: trip.end_date,
            items: items
              .filter((item) => item.trip_id === trip.id)
              .map((item) => ({
                id: item.id,
                dayNumber: item.day_number,
                itemType: item.item_type,
                title: item.title,
                startsAt: item.starts_at,
                endsAt: item.ends_at,
              })),
          }),
        ]),
      ),
    [items, trips],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError("");
      const supabase = createSupabaseBrowserClient();
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setLoadError("No active workspace is available for this account.");
        setLoading(false);
        return;
      }

      setOrganizationId(membership.organization_id);
      setRole(membership.role);
      const requestedDealId = new URLSearchParams(window.location.search).get(
        "deal",
      );
      const requestedDealName = new URLSearchParams(window.location.search).get(
        "name",
      );
      setFocusedDealId(requestedDealId || "");
      setFocusedDealName(requestedDealName || "");
      const [
        { data: tripRows, error: tripError },
        { data: itemRows, error: itemError },
        { data: templateRows, error: templateError },
        { data: templateItemRows, error: templateItemError },
        { data: commentRows, error: commentError },
      ] = await Promise.all([
        supabase
          .from("trips")
          .select("id, deal_id, name, status, start_date, end_date, time_zone")
          .eq("organization_id", membership.organization_id)
          .order("created_at", { ascending: false }),
        supabase
          .from("itinerary_items")
          .select(
            "id, trip_id, day_number, position, item_type, title, starts_at, ends_at, time_zone, location",
          )
          .eq("organization_id", membership.organization_id)
          .order("day_number")
          .order("position"),
        supabase
          .from("itinerary_templates")
          .select("id, name, description")
          .eq("organization_id", membership.organization_id)
          .is("archived_at", null)
          .order("updated_at", { ascending: false }),
        supabase
          .from("itinerary_template_items")
          .select("id, itinerary_template_id, day_number, item_type, title")
          .eq("organization_id", membership.organization_id)
          .order("day_number"),
        supabase
          .from("itinerary_comments")
          .select("id, trip_id, body, created_at")
          .eq("organization_id", membership.organization_id)
          .order("created_at", { ascending: true }),
      ]);
      const loadFailure =
        tripError ??
        itemError ??
        templateError ??
        templateItemError ??
        commentError;
      if (loadFailure) throw loadFailure;

      const hydratedTrips = [...((tripRows || []) as Trip[])].sort(
        (left, right) =>
          Number(right.deal_id === requestedDealId) -
          Number(left.deal_id === requestedDealId),
      );
      setTrips(hydratedTrips);
      setSelectedTripId(
        hydratedTrips.find((trip) => trip.deal_id === requestedDealId)?.id ||
          hydratedTrips[0]?.id ||
          "",
      );
      setItems((itemRows || []) as Item[]);
      setTemplates((templateRows || []) as ItineraryTemplate[]);
      setTemplateItems((templateItemRows || []) as TemplateItem[]);
      setComments((commentRows || []) as ItineraryComment[]);
      if (hydratedTrips.length > 0) {
        const latestDrafts = await getLatestItineraryDrafts({
          organizationId: membership.organization_id,
          tripIds: hydratedTrips.map((trip) => trip.id),
        });
        setDrafts(
          Object.fromEntries(
            latestDrafts.map(({ tripId, draft }) => [tripId, draft]),
          ),
        );
      }
      setLoading(false);
    };
    void load().catch(() => {
      setLoadError("The itinerary workspace could not be loaded.");
      setLoading(false);
    });
  }, [reloadKey]);

  async function refreshTemplateData(currentOrganizationId: string) {
    const supabase = createSupabaseBrowserClient();
    const [{ data: templateRows }, { data: templateItemRows }] = await Promise.all([
      supabase
        .from("itinerary_templates")
        .select("id, name, description")
        .eq("organization_id", currentOrganizationId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false }),
      supabase
        .from("itinerary_template_items")
        .select("id, itinerary_template_id, day_number, item_type, title")
        .eq("organization_id", currentOrganizationId)
        .order("day_number"),
    ]);
    setTemplates((templateRows || []) as ItineraryTemplate[]);
    setTemplateItems((templateItemRows || []) as TemplateItem[]);
  }

  function createTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      try {
        const trip = await createTripDraft({
          organizationId,
          name: String(form.get("name") || ""),
          startDate: String(form.get("startDate") || "") || null,
          endDate: String(form.get("endDate") || "") || null,
          timeZone: String(form.get("timeZone") || ""),
          currency: "INR",
          dealId: focusedDealId || null,
        });
        setTrips((current) => [trip as Trip, ...current]);
        setSelectedTripId(trip.id);
        formElement.reset();
        setNotice("Internal trip draft created. Nothing has been booked or shared.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create this trip draft.",
        );
      }
    });
  }

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      try {
        const item = await addItineraryItem({
          organizationId,
          tripId: String(form.get("tripId")),
          dayNumber: Number(form.get("dayNumber")),
          itemType: String(form.get("itemType")) as "activity",
          title: String(form.get("title") || ""),
          locationName: String(form.get("location") || "") || null,
          startsAtLocal: formLocalDateTime(form, "startsAt"),
          endsAtLocal: formLocalDateTime(form, "endsAt"),
          timeZone: String(form.get("timeZone") || "") || null,
        });
        setItems((current) => [...current, item as Item]);
        formElement.reset();
        setNotice(
          "Internal itinerary item added. It is not a booking or customer-facing plan.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not add this itinerary item.",
        );
      }
    });
  }

  function moveItineraryItem(
    tripId: string,
    itineraryItemId: string,
    direction: "up" | "down",
  ) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const reorderedItems = await reorderItineraryItem({
          organizationId,
          tripId,
          itineraryItemId,
          direction,
        });
        const positions = new Map(
          reorderedItems.map((item) => [
            item.itinerary_item_id,
            item.item_position,
          ]),
        );
        setItems((current) =>
          current.map((item) => {
            const position = positions.get(item.id);
            return item.trip_id === tripId && position !== undefined
              ? { ...item, position }
              : item;
          }),
        );
        setNotice(`Itinerary item moved ${direction}.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The itinerary item could not be moved.",
        );
      }
    });
  }

  function createReadinessTask(tripId: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const result = await createItineraryReadinessTask({
          organizationId,
          tripId,
        });
        setNotice(
          result.status === "created"
            ? "AIOS created one internal itinerary follow-up."
            : result.status === "already_open"
              ? "An AIOS itinerary follow-up is already open."
              : result.status === "ready"
                ? "This itinerary is ready; AIOS did not create a task."
                : result.status === "approval_required"
                  ? "AIOS requested human approval before creating the follow-up."
                  : "AIOS did not create a follow-up under the current policy.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create the itinerary follow-up.",
        );
      }
    });
  }

  function draftWithAios(tripId: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const result = await prepareItineraryDraft({ organizationId, tripId });
        if (result.status === "succeeded") {
          setDrafts((current) => ({ ...current, [tripId]: result.draft }));
          setNotice(
            "AIOS prepared an internal planning preview. Review it and add only the items you choose.",
          );
          return;
        }
        setNotice(result.message);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not prepare an itinerary preview.",
        );
      }
    });
  }

  function addSuggestedItem(
    tripId: string,
    suggestion: ItineraryDraft["suggestedItems"][number],
  ) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const item = await addItineraryItem({
          organizationId,
          tripId,
          dayNumber: suggestion.dayNumber,
          itemType: suggestion.itemType,
          title: suggestion.title,
          locationName: null,
          timeZone:
            trips.find((trip) => trip.id === tripId)?.time_zone ?? null,
        });
        setItems((current) => [...current, item as Item]);
        setNotice(
          `Added "${suggestion.title}" as an internal itinerary item after your review.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not add this reviewed itinerary item.",
        );
      }
    });
  }

  function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      try {
        const template = await createItineraryTemplateFromTrip({
          organizationId,
          sourceTripId: String(form.get("sourceTripId")),
          name: String(form.get("templateName") || ""),
          description: String(form.get("templateDescription") || ""),
        });
        await refreshTemplateData(organizationId);
        formElement.reset();
        setNotice(`Saved "${template.name}" as an internal reusable itinerary template.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save this itinerary template.",
        );
      }
    });
  }

  function applyTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      try {
        const result = await applyItineraryTemplate({
          organizationId,
          templateId: String(form.get("templateId")),
          targetTripId: String(form.get("targetTripId")),
        });
        const supabase = createSupabaseBrowserClient();
        const { data: itemRows } = await supabase
          .from("itinerary_items")
          .select(
            "id, trip_id, day_number, position, item_type, title, starts_at, ends_at, time_zone, location",
          )
          .eq("organization_id", organizationId)
          .order("day_number")
          .order("position");
        setItems((itemRows || []) as Item[]);
        formElement.reset();
        setNotice(
          result.copiedItemCount > 0
            ? `Added ${result.copiedItemCount} internal items from the selected template.`
            : "The selected template has no items to add.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not apply this itinerary template.",
        );
      }
    });
  }

  function addComment(event: FormEvent<HTMLFormElement>, tripId: string) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      try {
        const comment = await addItineraryComment({
          organizationId,
          tripId,
          body: String(form.get("comment") || ""),
        });
        setComments((current) => [...current, comment as ItineraryComment]);
        formElement.reset();
        setNotice("Internal itinerary comment added for the team.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not add this itinerary comment.",
        );
      }
    });
  }

  return (
    <main className="itinerary-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/", label: "Command center" },
          { href: "/quotes", label: "Quotes" },
          { href: "/trips", label: "Trip Operations" },
          { href: "/aios/activity", label: "AI Activity" },
        ]}
      />
      <OperationalPageHeader
        section="Travel"
        title="Itineraries"
        meta={`${trips.length} active drafts · ${templates.length} templates`}
      />
      <datalist id="travel-time-zones">
        {COMMON_TRAVEL_TIME_ZONES.map((timeZone) => (
          <option key={timeZone} value={timeZone} />
        ))}
      </datalist>
      {focusedDealId ? (
        <section
          className="itinerary-opportunity-context"
          aria-label="Opportunity context"
        >
          <div>
            <p>OPPORTUNITY CONTEXT</p>
            <h2>{focusedDealName || "Selected opportunity"}</h2>
            <span>
              {focusedTrip
                ? `${focusedTrip.name} is linked to this opportunity.`
                : "No itinerary is linked yet. Create the first internal trip draft below."}
            </span>
          </div>
          <a href={`/leads/${focusedDealId}`}>Back to opportunity</a>
        </section>
      ) : null}
      {notice && (
        <p className="itinerary-notice" role="status">
          {notice}
        </p>
      )}
      {loadError ? (
        <ErrorState
          title="Itineraries are unavailable"
          description={loadError}
          onRetry={() => setReloadKey((current) => current + 1)}
        />
      ) : (
      <>
      {!canPlan && role ? (
        <PermissionNotice description="You can inspect itinerary drafts and their readiness. Creating trips, applying templates, and accepting AI suggestions requires a planning role." />
      ) : null}
      {canPlan && (
        <details className="crm-action-drawer">
          <summary>Create or update an itinerary</summary>
          <div className="crm-action-drawer-body">
        <section className="itinerary-forms" aria-label="Trip planning forms">
          <form onSubmit={createTrip} key={`new-trip-${focusedDealId}`}>
            <b>New trip draft</b>
            <input
              name="name"
              required
              maxLength={180}
              defaultValue={focusedDealName}
              placeholder="Japan family journey"
              aria-label="Trip name"
            />
            <input
              name="startDate"
              type="date"
              aria-label="Trip start date"
            />
            <input name="endDate" type="date" aria-label="Trip end date" />
            <input
              name="timeZone"
              required
              maxLength={80}
              list="travel-time-zones"
              placeholder="Destination time zone, e.g. Asia/Tokyo"
              aria-label="Trip time zone"
            />
            <button disabled={pending}>{pending ? "Saving..." : "Create draft"}</button>
          </form>
          <form onSubmit={addItem}>
            <b>Add day item</b>
            <select
              name="tripId"
              required
              defaultValue={activeTrip?.id || ""}
              key={`item-trip-${activeTrip?.id || "none"}`}
              aria-label="Trip for itinerary item"
            >
              <option value="" disabled>
                Select a trip
              </option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
            <input
              name="dayNumber"
              type="number"
              min="1"
              defaultValue="1"
              required
              aria-label="Itinerary day number"
            />
            <select
              name="itemType"
              defaultValue="activity"
              aria-label="Itinerary item type"
            >
              <option value="activity">Activity</option>
              <option value="stay">Stay</option>
              <option value="flight">Flight</option>
              <option value="transfer">Transfer</option>
              <option value="meal">Meal</option>
              <option value="free_time">Free time</option>
              <option value="note">Note</option>
            </select>
            <input
              name="title"
              required
              maxLength={300}
              placeholder="Old Kyoto walk"
              aria-label="Itinerary item title"
            />
            <input
              name="location"
              maxLength={180}
              placeholder="Location (optional)"
              aria-label="Itinerary item location"
            />
            <input
              name="startsAt"
              type="datetime-local"
              aria-label="Itinerary item start"
            />
            <input
              name="endsAt"
              type="datetime-local"
              aria-label="Itinerary item end"
            />
            <input
              name="timeZone"
              maxLength={80}
              list="travel-time-zones"
              defaultValue={activeTrip?.time_zone ?? ""}
              key={`item-zone-${activeTrip?.id || "none"}`}
              placeholder="IANA time zone for timed items"
              aria-label="Itinerary item time zone"
            />
            <button disabled={pending || trips.length === 0}>
              {pending ? "Saving..." : "Add item"}
            </button>
          </form>
          <form onSubmit={saveTemplate}>
            <b>Save a reusable template</b>
            <select
              name="sourceTripId"
              required
              defaultValue={activeTrip?.id || ""}
              key={`source-trip-${activeTrip?.id || "none"}`}
              aria-label="Source trip for template"
            >
              <option value="" disabled>
                Select a trip to copy
              </option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
            <input
              name="templateName"
              required
              maxLength={180}
              placeholder="Kyoto long weekend"
              aria-label="Itinerary template name"
            />
            <input
              name="templateDescription"
              maxLength={1200}
              placeholder="Internal notes (optional)"
              aria-label="Itinerary template description"
            />
            <button disabled={pending || trips.length === 0}>
              {pending ? "Saving..." : "Save template"}
            </button>
          </form>
          <form onSubmit={applyTemplate}>
            <b>Use a saved template</b>
            <select
              name="templateId"
              required
              defaultValue=""
              aria-label="Saved itinerary template"
            >
              <option value="" disabled>
                Select a template
              </option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <select
              name="targetTripId"
              required
              defaultValue={activeTrip?.id || ""}
              key={`target-trip-${activeTrip?.id || "none"}`}
              aria-label="Target trip for template"
            >
              <option value="" disabled>
                Select a target trip
              </option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
            <button disabled={pending || templates.length === 0 || trips.length === 0}>
              {pending ? "Applying..." : "Apply internally"}
            </button>
          </form>
        </section>
          </div>
        </details>
      )}
      <section className="itinerary-list" aria-labelledby="trip-drafts-title">
        <div className="section-heading">
          <div>
            <p>TEAM WORKSPACE</p>
            <h2 id="trip-drafts-title">Trip drafts</h2>
          </div>
          <span>{trips.length} active</span>
        </div>
        {!loading && trips.length > 0 ? (
          <div
            className="itinerary-record-switcher"
            role="tablist"
            aria-label="Trip drafts"
          >
            {trips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                role="tab"
                aria-selected={trip.id === activeTrip?.id}
                aria-controls="active-itinerary"
                onClick={() => setSelectedTripId(trip.id)}
              >
                <span>
                  <b>{trip.name}</b>
                  <small>
                    {trip.start_date || "Dates unplanned"}
                    {trip.end_date ? ` to ${trip.end_date}` : ""}
                    {` · ${trip.time_zone || "Time zone not set"}`}
                  </small>
                </span>
                <em>{trip.status}</em>
              </button>
            ))}
          </div>
        ) : null}
        {loading ? (
          <LoadingState label="Loading trip drafts" rows={3} />
        ) : trips.length === 0 ? (
          <EmptyState
            title="No internal trips yet"
            description="Start a draft when the team is ready to shape an itinerary."
          />
        ) : (
          [activeTrip]
            .filter((trip): trip is Trip => Boolean(trip))
            .map((trip) => {
            const readiness = readinessByTrip.get(trip.id);
            const conflicts = conflictsByTrip.get(trip.id) || [];
            const draft = drafts[trip.id];
            const tripItems = items.filter((item) => item.trip_id === trip.id);
            const dayNumbers = new Set(
              tripItems.map((item) => item.day_number),
            );
            if (trip.start_date && trip.end_date) {
              const start = new Date(`${trip.start_date}T00:00:00Z`);
              const end = new Date(`${trip.end_date}T00:00:00Z`);
              const datedDayCount = Math.min(
                120,
                Math.max(
                  1,
                  Math.floor((end.getTime() - start.getTime()) / 86_400_000) +
                    1,
                ),
              );
              for (let day = 1; day <= datedDayCount; day += 1) {
                dayNumbers.add(day);
              }
            }
            if (dayNumbers.size === 0) dayNumbers.add(1);
            const sortedDayNumbers = [...dayNumbers].sort(
              (left, right) => left - right,
            );
            return (
              <article
                key={trip.id}
                id="active-itinerary"
                className={trip.deal_id === focusedDealId ? "focused-trip" : ""}
              >
                <div className="trip-overview">
                  <span>{trip.status}</span>
                  <h3>{trip.name}</h3>
                  <small>
                    {trip.start_date || "Dates unplanned"}
                    {trip.end_date ? ` to ${trip.end_date}` : ""}
                    {` · ${trip.time_zone || "Time zone not set"}`}
                  </small>
                  {readiness && (
                    <p className={`readiness ${readiness.status}`}>
                      <b>AIOS readiness {readiness.score}%</b>
                      {readiness.signals.length
                        ? ` / ${readiness.signals.join(" ")}`
                        : " / Ready for internal review."}
                    </p>
                  )}
                  {conflicts.length > 0 && (
                    <p className="planning-conflicts">
                      <b>{conflicts.length} planning conflict{conflicts.length === 1 ? "" : "s"}</b>
                      {` / ${conflicts.map((conflict) => conflict.message).join(" ")}`}
                    </p>
                  )}
                  {canPlan && (
                    <div className="ai-actions">
                      {readiness && readiness.status !== "ready" && (
                        <button
                          className="readiness-task"
                          type="button"
                          disabled={pending}
                          onClick={() => createReadinessTask(trip.id)}
                        >
                          {pending ? "AIOS is checking..." : "Create internal follow-up"}
                        </button>
                      )}
                      <button
                        className="ai-draft-button"
                        type="button"
                        disabled={pending}
                        onClick={() => draftWithAios(trip.id)}
                      >
                        {pending ? "AIOS is preparing..." : "Ask AIOS for a planning draft"}
                      </button>
                    </div>
                  )}
                </div>
                <section
                  className="itinerary-day-canvas"
                  aria-label={`Day plan for ${trip.name}`}
                >
                  <div className="day-canvas-heading">
                    <div>
                      <p>DAY PLAN</p>
                      <h4>Build the journey day by day</h4>
                    </div>
                    <span>
                      {tripItems.length} {tripItems.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                  {tripItems.length === 0 ? (
                    <div className="itinerary-plan-empty" role="status">
                      <b>This itinerary draft is empty.</b>
                      Add the first service or activity from Planning tools, or ask
                      AIOS for an internal planning draft. Nothing has been booked
                      or shared.
                    </div>
                  ) : null}
                  <div className="itinerary-days">
                    {sortedDayNumbers.map((dayNumber) => {
                      const dayItems = tripItems
                        .filter((item) => item.day_number === dayNumber)
                        .sort((left, right) => left.position - right.position);
                      return (
                        <section className="itinerary-day" key={dayNumber}>
                          <header>
                            <div>
                              <b>Day {dayNumber}</b>
                              <span>
                                {itineraryDayLabel(trip.start_date, dayNumber)}
                              </span>
                            </div>
                            <small>
                              {dayItems.length === 0
                                ? "Open"
                                : `${dayItems.length} ${dayItems.length === 1 ? "item" : "items"}`}
                            </small>
                          </header>
                          {dayItems.length === 0 ? (
                            <p className="empty-day">No services or activities planned yet.</p>
                          ) : (
                            <ol>
                              {dayItems.map((item, itemIndex) => (
                                <li key={item.id}>
                                  <time>
                                    {itineraryItemTime(
                                      item.starts_at,
                                      item.time_zone,
                                    )}
                                    {item.ends_at
                                      ? `–${itineraryItemTime(
                                          item.ends_at,
                                          item.time_zone,
                                        )}`
                                      : ""}
                                  </time>
                                  <span>{item.item_type.replace("_", " ")}</span>
                                  <div className="itinerary-item-copy">
                                    <b>{item.title}</b>
                                    {itineraryItemLocation(item.location) ? (
                                      <small>
                                        {itineraryItemLocation(item.location)}
                                        {item.time_zone ? ` · ${item.time_zone}` : ""}
                                      </small>
                                    ) : item.time_zone ? (
                                      <small>{item.time_zone}</small>
                                    ) : item.starts_at ? (
                                      <small>Legacy time zone needs review</small>
                                    ) : null}
                                  </div>
                                  {canPlan ? (
                                    <div
                                      className="itinerary-item-order"
                                      aria-label={`Reorder ${item.title}`}
                                    >
                                      <button
                                        type="button"
                                        disabled={pending || itemIndex === 0}
                                        aria-label={`Move ${item.title} up`}
                                        title="Move earlier"
                                        onClick={() =>
                                          moveItineraryItem(trip.id, item.id, "up")
                                        }
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        disabled={
                                          pending || itemIndex === dayItems.length - 1
                                        }
                                        aria-label={`Move ${item.title} down`}
                                        title="Move later"
                                        onClick={() =>
                                          moveItineraryItem(trip.id, item.id, "down")
                                        }
                                      >
                                        ↓
                                      </button>
                                    </div>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                          )}
                        </section>
                      );
                    })}
                  </div>
                  {canPlan ? (
                    <form className="itinerary-quick-add" onSubmit={addItem}>
                      <input type="hidden" name="tripId" value={trip.id} />
                      <label className="quick-add-day">
                        <span>Day</span>
                        <input
                          name="dayNumber"
                          type="number"
                          min="1"
                          defaultValue="1"
                          required
                          aria-label="Quick add day"
                        />
                      </label>
                      <label className="quick-add-category">
                        <span>Type</span>
                        <select
                          name="itemType"
                          defaultValue="activity"
                          aria-label="Quick item category"
                        >
                          <option value="activity">Activity</option>
                          <option value="stay">Stay</option>
                          <option value="flight">Flight</option>
                          <option value="transfer">Transfer</option>
                          <option value="meal">Meal</option>
                          <option value="free_time">Free time</option>
                          <option value="note">Note</option>
                        </select>
                      </label>
                      <label className="quick-add-title">
                        <span>Plan item</span>
                        <input
                          name="title"
                          required
                          maxLength={300}
                          placeholder="Add an activity, stay, transfer, or note"
                          aria-label="Quick item name"
                        />
                      </label>
                      <label className="quick-add-location">
                        <span>Location</span>
                        <input
                          name="location"
                          maxLength={180}
                          placeholder="Optional place or area"
                          aria-label="Quick item location"
                        />
                      </label>
                      <label className="quick-add-start">
                        <span>Starts</span>
                        <input
                          name="startsAt"
                          type="datetime-local"
                          aria-label="Quick item start"
                        />
                      </label>
                      <label className="quick-add-end">
                        <span>Ends</span>
                        <input
                          name="endsAt"
                          type="datetime-local"
                          aria-label="Quick item end"
                        />
                      </label>
                      <label className="quick-add-timezone">
                        <span>Time zone</span>
                        <input
                          name="timeZone"
                          maxLength={80}
                          list="travel-time-zones"
                          defaultValue={trip.time_zone ?? ""}
                          placeholder="Asia/Tokyo"
                          aria-label="Quick item time zone"
                        />
                      </label>
                      <button disabled={pending}>
                        {pending ? "Adding..." : "Add to day plan"}
                      </button>
                    </form>
                  ) : null}
                </section>
                {draft && (
                  <section className="ai-draft" aria-label={`AIOS preview for ${trip.name}`}>
                    <div className="ai-draft-heading">
                      <div>
                        <p>AIOS PLANNING PREVIEW</p>
                        <h4>{draft.summary}</h4>
                      </div>
                      <span>{Math.round(draft.confidence * 100)}% confidence</span>
                    </div>
                    <ul>
                      {draft.suggestedItems.map((item) => {
                        const alreadyAdded = items.some(
                          (current) =>
                            current.trip_id === trip.id &&
                            current.day_number === item.dayNumber &&
                            current.item_type === item.itemType &&
                            current.title.trim().toLowerCase() ===
                              item.title.trim().toLowerCase(),
                        );
                        return (
                          <li key={`${item.dayNumber}-${item.itemType}-${item.title}`}>
                            <b>Day {item.dayNumber} / {item.itemType}</b>
                            <strong>{item.title}</strong>
                            <span>{item.rationale}</span>
                            {canPlan && (
                              <button
                                className="apply-suggestion"
                                type="button"
                                disabled={pending || alreadyAdded}
                                onClick={() => addSuggestedItem(trip.id, item)}
                              >
                                {alreadyAdded
                                  ? "Added to draft"
                                  : pending
                                    ? "Adding..."
                                    : "Add to internal draft"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {draft.openQuestions.length > 0 && (
                      <p className="open-questions">
                        <b>Confirm before planning:</b> {draft.openQuestions.join(" / ")}
                      </p>
                    )}
                    <p className="human-review-note">
                      Each addition above requires your explicit click. AIOS cannot bulk-apply suggestions, contact anyone, or make a booking.
                    </p>
                  </section>
                )}
                <section className="itinerary-comments" aria-label={`Team comments for ${trip.name}`}>
                  <div className="comments-heading">
                    <h4>Team notes</h4>
                    <span>
                      {comments.filter((comment) => comment.trip_id === trip.id).length}
                    </span>
                  </div>
                  <div className="comment-list">
                    {comments
                      .filter((comment) => comment.trip_id === trip.id)
                      .map((comment) => (
                        <p key={comment.id}>
                          <span>
                            {new Date(comment.created_at).toLocaleDateString()}
                          </span>
                          {comment.body}
                        </p>
                      ))}
                  </div>
                  {organizationId && (
                    <form onSubmit={(event) => addComment(event, trip.id)}>
                      <input
                        name="comment"
                        required
                        maxLength={4000}
                        placeholder="Leave an internal note for the planning team"
                      />
                      <button disabled={pending}>
                        {pending ? "Adding..." : "Add internal note"}
                      </button>
                    </form>
                  )}
                </section>
              </article>
            );
          })
        )}
      </section>
      <section className="itinerary-templates" aria-labelledby="itinerary-templates-title">
        <div className="section-heading">
          <div>
            <p>REUSABLE TEAM PATTERNS</p>
            <h2 id="itinerary-templates-title">Saved templates</h2>
          </div>
          <span>{templates.length} saved</span>
        </div>
        {loading ? (
          <LoadingState label="Loading saved templates" rows={2} />
        ) : templates.length === 0 ? (
          <EmptyState
            title="No saved templates yet"
            description="Save a strong internal trip plan above to reuse its day-by-day structure."
          />
        ) : (
          <div className="template-grid">
            {templates.map((template) => {
              const savedItems = templateItems.filter(
                (item) => item.itinerary_template_id === template.id,
              );
              return (
                <article key={template.id}>
                  <span>{savedItems.length} internal items</span>
                  <h3>{template.name}</h3>
                  <p>{template.description || "No internal description."}</p>
                  <small>
                    {savedItems.length > 0
                      ? `Days ${Math.min(...savedItems.map((item) => item.day_number))} to ${Math.max(...savedItems.map((item) => item.day_number))}`
                      : "Empty planning pattern"}
                  </small>
                </article>
              );
            })}
          </div>
        )}
      </section>
      </>
      )}
    </main>
  );
}
