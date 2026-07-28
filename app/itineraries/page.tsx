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
} from "../actions/crm";
import type { ItineraryDraft } from "../../lib/ai/contracts";
import { assessItineraryConflicts } from "../../lib/crm/itinerary-conflicts";
import { assessItineraryReadiness } from "../../lib/crm/itinerary-readiness";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import "./itineraries.css";

type Trip = {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
};
type Item = {
  id: string;
  trip_id: string;
  day_number: number;
  item_type: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
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

export default function ItinerariesPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<ItineraryTemplate[]>([]);
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [comments, setComments] = useState<ItineraryComment[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ItineraryDraft>>({});
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const canPlan = role ? planningRoles.has(role) : false;

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
      const supabase = createSupabaseBrowserClient();
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setNotice("No active workspace is available for this account.");
        setLoading(false);
        return;
      }

      setOrganizationId(membership.organization_id);
      setRole(membership.role);
      const [
        { data: tripRows },
        { data: itemRows },
        { data: templateRows },
        { data: templateItemRows },
        { data: commentRows },
      ] = await Promise.all([
        supabase
          .from("trips")
          .select("id, name, status, start_date, end_date")
          .eq("organization_id", membership.organization_id)
          .order("created_at", { ascending: false }),
        supabase
          .from("itinerary_items")
          .select("id, trip_id, day_number, item_type, title, starts_at, ends_at")
          .eq("organization_id", membership.organization_id)
          .order("day_number"),
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
      setTrips((tripRows || []) as Trip[]);
      setItems((itemRows || []) as Item[]);
      setTemplates((templateRows || []) as ItineraryTemplate[]);
      setTemplateItems((templateItemRows || []) as TemplateItem[]);
      setComments((commentRows || []) as ItineraryComment[]);
      const hydratedTrips = (tripRows || []) as Trip[];
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
      setNotice("AIOS could not load the itinerary studio.");
      setLoading(false);
    });
  }, []);

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
          currency: "INR",
        });
        setTrips((current) => [trip as Trip, ...current]);
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
          .select("id, trip_id, day_number, item_type, title, starts_at, ends_at")
          .eq("organization_id", organizationId)
          .order("day_number");
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
          { href: "/aios", label: "AIOS Control" },
        ]}
      />
      <section className="itinerary-hero">
        <p>ITINERARY STUDIO / INTERNAL DRAFTS</p>
        <h1>Design the journey before the world sees it.</h1>
        <span>
          Plan day-by-day experiences with your team. Bookings, documents, and
          customer sharing remain locked behind their own approval gates.
        </span>
      </section>
      {notice && (
        <p className="itinerary-notice" role="status">
          {notice}
        </p>
      )}
      {canPlan && (
        <section className="itinerary-forms" aria-label="Trip planning forms">
          <form onSubmit={createTrip}>
            <b>New trip draft</b>
            <input
              name="name"
              required
              maxLength={180}
              placeholder="Japan family journey"
              aria-label="Trip name"
            />
            <input
              name="startDate"
              type="date"
              aria-label="Trip start date"
            />
            <input name="endDate" type="date" aria-label="Trip end date" />
            <button disabled={pending}>{pending ? "Saving..." : "Create draft"}</button>
          </form>
          <form onSubmit={addItem}>
            <b>Add day item</b>
            <select
              name="tripId"
              required
              defaultValue=""
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
            <button disabled={pending || trips.length === 0}>
              {pending ? "Saving..." : "Add item"}
            </button>
          </form>
          <form onSubmit={saveTemplate}>
            <b>Save a reusable template</b>
            <select
              name="sourceTripId"
              required
              defaultValue=""
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
              defaultValue=""
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
      )}
      <section className="itinerary-list" aria-labelledby="trip-drafts-title">
        <div className="section-heading">
          <div>
            <p>TEAM WORKSPACE</p>
            <h2 id="trip-drafts-title">Trip drafts</h2>
          </div>
          <span>{trips.length} active</span>
        </div>
        {loading ? (
          <LoadingState label="Loading trip drafts" rows={3} />
        ) : trips.length === 0 ? (
          <EmptyState
            title="No internal trips yet"
            description="Start a draft when the team is ready to shape an itinerary."
          />
        ) : (
          trips.map((trip) => {
            const readiness = readinessByTrip.get(trip.id);
            const conflicts = conflictsByTrip.get(trip.id) || [];
            const draft = drafts[trip.id];
            return (
              <article key={trip.id}>
                <div className="trip-overview">
                  <span>{trip.status}</span>
                  <h3>{trip.name}</h3>
                  <small>
                    {trip.start_date || "Dates unplanned"}
                    {trip.end_date ? ` to ${trip.end_date}` : ""}
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
                <ol className="current-items">
                  {items
                    .filter((item) => item.trip_id === trip.id)
                    .map((item) => (
                      <li key={item.id}>
                        <b>Day {item.day_number}</b>
                        <span>{item.item_type}</span>
                        {item.title}
                      </li>
                    ))}
                </ol>
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
    </main>
  );
}
