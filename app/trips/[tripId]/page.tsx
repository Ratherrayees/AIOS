"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  addTripTraveler,
  createTask,
  createTripBooking,
  createTripDocumentDownload,
  transitionTripStatus,
  updateTaskStatus,
  updateTripBookingStatus,
  updateTripOperations,
  uploadTripDocument,
} from "../../actions/crm";
import { EmptyState, LoadingState } from "../../../components/ui/empty-state";
import { FeatureHeader } from "../../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../lib/supabase/workspace-context";
import "../trips.css";
import "./workspace.css";

type TripStatus =
  | "draft"
  | "confirmed"
  | "in_travel"
  | "completed"
  | "cancelled";

type Trip = {
  id: string;
  deal_id: string | null;
  name: string;
  status: TripStatus;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  currency: string;
  owner_id: string | null;
  operations_notes: string | null;
  converted_at: string | null;
};

type Traveler = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  role: string;
};

type BookingStatus =
  | "draft"
  | "requested"
  | "confirmed"
  | "cancelled"
  | "failed";

type Booking = {
  id: string;
  title: string;
  booking_type: string;
  status: BookingStatus;
  supplier_id: string | null;
  confirmation_reference: string | null;
  service_start_at: string | null;
  service_end_at: string | null;
  cost_amount: number | null;
  currency: string;
};

type Task = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  due_at: string | null;
};

type Document = {
  id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  expires_at: string | null;
  created_at: string;
};

type StatusHistory = {
  id: string;
  from_status: TripStatus | null;
  to_status: TripStatus;
  change_source: string;
  note: string | null;
  changed_at: string;
};

type Activity = {
  id: string;
  activity_type: string;
  body: string;
  created_at: string;
};

type Supplier = {
  id: string;
  name: string;
  category: string | null;
};

const planningRoles = new Set([
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
]);
const operationsRoles = new Set([
  "owner",
  "admin",
  "trip_designer",
  "operations",
]);
const travelerRoles = new Set([...planningRoles, "agent"]);
const bookingRoles = new Set([
  "owner",
  "admin",
  "trip_designer",
  "operations",
  "finance",
]);
const taskRoles = new Set([
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
  "finance",
  "agent",
]);
const documentRoles = new Set([
  "owner",
  "admin",
  "trip_designer",
  "operations",
  "agent",
]);

const nextTripStatuses: Record<TripStatus, TripStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["in_travel", "cancelled"],
  in_travel: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const nextBookingStatuses: Record<BookingStatus, BookingStatus[]> = {
  draft: ["requested", "cancelled"],
  requested: ["confirmed", "failed", "cancelled"],
  confirmed: ["cancelled"],
  failed: ["draft", "cancelled"],
  cancelled: [],
};

function toIsoDateTime(value: FormDataEntryValue | null) {
  if (!value) return null;
  return new Date(String(value)).toISOString();
}

function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TripWorkspacePage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [travelers, setTravelers] = useState<Traveler[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [confirmationDrafts, setConfirmationDrafts] = useState<
    Record<string, string>
  >({});
  const [statusNote, setStatusNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const canPlan = role ? planningRoles.has(role) : false;
  const canOperate = role ? operationsRoles.has(role) : false;
  const canManageTravelers = role ? travelerRoles.has(role) : false;
  const canBook = role ? bookingRoles.has(role) : false;
  const canManageTasks = role ? taskRoles.has(role) : false;
  const canManageDocuments = role ? documentRoles.has(role) : false;

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
        { data: tripRow, error: tripError },
        { data: travelerRows },
        { data: bookingRows },
        { data: taskRows },
        { data: documentRows },
        { data: historyRows },
        { data: activityRows },
        { data: supplierRows },
      ] = await Promise.all([
        supabase
          .from("trips")
          .select(
            "id, deal_id, name, status, destination, start_date, end_date, currency, owner_id, operations_notes, converted_at",
          )
          .eq("organization_id", membership.organization_id)
          .eq("id", tripId)
          .maybeSingle(),
        supabase
          .from("travelers")
          .select(
            "id, first_name, last_name, email, phone, date_of_birth, role",
          )
          .eq("organization_id", membership.organization_id)
          .eq("trip_id", tripId)
          .order("created_at"),
        supabase
          .from("bookings")
          .select(
            "id, title, booking_type, status, supplier_id, confirmation_reference, service_start_at, service_end_at, cost_amount, currency",
          )
          .eq("organization_id", membership.organization_id)
          .eq("trip_id", tripId)
          .order("service_start_at", { ascending: true, nullsFirst: false }),
        supabase
          .from("tasks")
          .select("id, title, status, due_at")
          .eq("organization_id", membership.organization_id)
          .eq("trip_id", tripId)
          .order("due_at", { ascending: true, nullsFirst: false }),
        supabase
          .from("documents")
          .select(
            "id, file_name, mime_type, byte_size, expires_at, created_at",
          )
          .eq("organization_id", membership.organization_id)
          .eq("trip_id", tripId)
          .order("created_at", { ascending: false }),
        supabase
          .from("trip_status_history")
          .select(
            "id, from_status, to_status, change_source, note, changed_at",
          )
          .eq("organization_id", membership.organization_id)
          .eq("trip_id", tripId)
          .order("changed_at", { ascending: false }),
        supabase
          .from("activity_events")
          .select("id, activity_type, body, created_at")
          .eq("organization_id", membership.organization_id)
          .eq("trip_id", tripId)
          .order("created_at", { ascending: false })
          .limit(24),
        supabase
          .from("suppliers")
          .select("id, name, category")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active")
          .is("archived_at", null)
          .order("name"),
      ]);
      if (tripError || !tripRow)
        throw tripError ?? new Error("This trip is not available.");
      setTrip(tripRow as Trip);
      setTravelers((travelerRows ?? []) as Traveler[]);
      setBookings((bookingRows ?? []) as Booking[]);
      setTasks((taskRows ?? []) as Task[]);
      setDocuments((documentRows ?? []) as Document[]);
      setHistory((historyRows ?? []) as StatusHistory[]);
      setActivities((activityRows ?? []) as Activity[]);
      setSuppliers((supplierRows ?? []) as Supplier[]);
      setLoading(false);
    };
    void load().catch((error) => {
      setNotice(
        error instanceof Error
          ? error.message
          : "AIOS could not load the trip workspace.",
      );
      setLoading(false);
    });
  }, [tripId]);

  const readiness = useMemo(() => {
    if (!trip) return 0;
    const checks = [
      Boolean(trip.destination),
      Boolean(trip.start_date && trip.end_date),
      travelers.length > 0,
      bookings.length > 0,
      tasks.every((task) => !["open", "in_progress"].includes(task.status)),
      documents.length > 0,
    ];
    return Math.round(
      (checks.filter(Boolean).length / Math.max(checks.length, 1)) * 100,
    );
  }, [bookings.length, documents.length, tasks, travelers.length, trip]);

  function updateOperations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !trip || pending) return;
    const form = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        const updated = await updateTripOperations({
          organizationId,
          tripId: trip.id,
          name: String(form.get("name")),
          destination: String(form.get("destination") || "") || null,
          startDate: String(form.get("startDate") || "") || null,
          endDate: String(form.get("endDate") || "") || null,
          currency: String(form.get("currency")),
          ownerId: trip.owner_id,
          operationsNotes:
            String(form.get("operationsNotes") || "") || null,
        });
        setTrip(updated as Trip);
        setNotice("Operational trip details saved.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The operational trip could not be updated.",
        );
      }
    });
  }

  function moveTrip(status: TripStatus) {
    if (!organizationId || !trip || pending) return;
    const fromStatus = trip.status;
    setNotice("");
    startTransition(async () => {
      try {
        const updated = await transitionTripStatus({
          organizationId,
          tripId: trip.id,
          status,
          note: statusNote || null,
        });
        setTrip(updated as Trip);
        setHistory((current) => [
          {
            id: crypto.randomUUID(),
            from_status: fromStatus,
            to_status: status,
            change_source: "human",
            note: statusNote || null,
            changed_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setStatusNote("");
        setNotice(`Trip moved to ${status.replace("_", " ")}.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not move the trip.",
        );
      }
    });
  }

  function addTraveler(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setNotice("");
    startTransition(async () => {
      try {
        const traveler = await addTripTraveler({
          organizationId,
          tripId,
          firstName: String(form.get("firstName")),
          lastName: String(form.get("lastName") || "") || null,
          email: String(form.get("email") || "") || null,
          phone: String(form.get("phone") || "") || null,
          dateOfBirth: String(form.get("dateOfBirth") || "") || null,
          role: String(form.get("role")) as
            | "lead_traveler"
            | "traveler"
            | "child",
          preferences: String(form.get("preferences") || "") || null,
        });
        setTravelers((current) => [...current, traveler as Traveler]);
        formElement.reset();
        setNotice("Traveller added to the operational roster.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The traveller could not be added.",
        );
      }
    });
  }

  function addBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !trip || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const costValue = String(form.get("costAmount") || "");
    setNotice("");
    startTransition(async () => {
      try {
        const booking = await createTripBooking({
          organizationId,
          tripId,
          supplierId: String(form.get("supplierId") || "") || null,
          title: String(form.get("title")),
          bookingType: String(form.get("bookingType")) as
            | "flight"
            | "hotel"
            | "transfer"
            | "activity"
            | "insurance"
            | "other",
          serviceStartAt: toIsoDateTime(form.get("serviceStartAt")),
          serviceEndAt: toIsoDateTime(form.get("serviceEndAt")),
          costAmount: costValue ? Number(costValue) : null,
          currency: trip.currency,
          confirmationReference:
            String(form.get("confirmationReference") || "") || null,
          notes: String(form.get("notes") || "") || null,
        });
        setBookings((current) => [...current, booking as Booking]);
        formElement.reset();
        setNotice(
          "Internal booking record created. No supplier was contacted.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The booking record could not be created.",
        );
      }
    });
  }

  function moveBooking(booking: Booking, status: BookingStatus) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const updated = await updateTripBookingStatus({
          organizationId,
          tripId,
          bookingId: booking.id,
          status,
          confirmationReference:
            confirmationDrafts[booking.id] ||
            booking.confirmation_reference ||
            null,
        });
        setBookings((current) =>
          current.map((item) =>
            item.id === booking.id ? (updated as Booking) : item,
          ),
        );
        setNotice(
          `Internal booking tracking moved to ${status.replace("_", " ")}.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The booking could not be moved.",
        );
      }
    });
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !trip || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setNotice("");
    startTransition(async () => {
      try {
        const task = await createTask({
          organizationId,
          tripId,
          dealId: trip.deal_id,
          title: String(form.get("title")),
          dueAt: toIsoDateTime(form.get("dueAt")),
        });
        setTasks((current) => [...current, task as Task]);
        formElement.reset();
        setNotice("Operational follow-up added.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The operational follow-up could not be added.",
        );
      }
    });
  }

  function moveTask(task: Task, status: Task["status"]) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const updated = await updateTaskStatus({
          organizationId,
          taskId: task.id,
          status,
        });
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id ? (updated as Task) : item,
          ),
        );
        setNotice(`Follow-up marked ${status.replace("_", " ")}.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The follow-up could not be updated.",
        );
      }
    });
  }

  function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setNotice("");
    startTransition(async () => {
      try {
        const document = await uploadTripDocument(
          {
            organizationId,
            tripId,
            expiresAt: String(form.get("expiresAt") || "") || null,
          },
          form,
        );
        setDocuments((current) => [document as Document, ...current]);
        formElement.reset();
        setNotice("Private trip document stored.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The private document could not be uploaded.",
        );
      }
    });
  }

  function downloadDocument(document: Document) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const result = await createTripDocumentDownload({
          organizationId,
          tripId,
          documentId: document.id,
        });
        window.location.assign(result.url);
        setNotice("Secure download link created for 60 seconds.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The private document could not be downloaded.",
        );
      }
    });
  }

  if (loading) {
    return (
      <main className="trip-workspace-page">
        <FeatureHeader links={[{ href: "/trips", label: "Trip Operations" }]} />
        <div className="trip-loading">
          <LoadingState label="Loading trip control deck" rows={6} />
        </div>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="trip-workspace-page">
        <FeatureHeader links={[{ href: "/trips", label: "Trip Operations" }]} />
        <div className="trip-loading">
          <EmptyState
            title="Trip unavailable"
            description={notice || "This trip is not visible in the active workspace."}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="trip-workspace-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/trips", label: "Trip Operations" },
          { href: "/itineraries", label: "Itinerary Studio" },
          { href: "/tasks", label: "Tasks" },
          { href: "/aios", label: "AIOS Control" },
        ]}
      />

      <section className="trip-workspace-hero">
        <div>
          <p>OPERATIONAL TRIP / {trip.status.replace("_", " ")}</p>
          <h1>{trip.name}</h1>
          <span>
            {trip.destination || "Destination open"} ·{" "}
            {trip.start_date || "Dates unplanned"}
            {trip.end_date ? ` to ${trip.end_date}` : ""}
          </span>
        </div>
        <aside className="readiness-dial">
          <b>{readiness}%</b>
          <span>operations readiness</span>
          <i style={{ "--readiness": `${readiness * 3.6}deg` } as React.CSSProperties} />
        </aside>
      </section>

      {notice && (
        <p className="trip-workspace-notice" role="status">
          {notice}
        </p>
      )}

      <section className="trip-command-strip">
        <div>
          <span>STATUS</span>
          <b>{trip.status.replace("_", " ")}</b>
        </div>
        <div>
          <span>TRAVELLERS</span>
          <b>{travelers.length}</b>
        </div>
        <div>
          <span>SERVICES</span>
          <b>{bookings.length}</b>
        </div>
        <div>
          <span>OPEN TASKS</span>
          <b>
            {
              tasks.filter((task) =>
                ["open", "in_progress"].includes(task.status),
              ).length
            }
          </b>
        </div>
        <Link href="/itineraries">Open itinerary studio →</Link>
      </section>

      <div className="trip-ops-layout">
        <div className="trip-ops-main">
          <section className="ops-panel">
            <div className="ops-panel-heading">
              <div>
                <p>MISSION PROFILE</p>
                <h2>Operating details</h2>
              </div>
              <span>{trip.converted_at ? "Sales handoff" : "Internal draft"}</span>
            </div>
            {canPlan ? (
              <form className="ops-form details-form" onSubmit={updateOperations}>
                <label>
                  Trip name
                  <input name="name" defaultValue={trip.name} required maxLength={180} />
                </label>
                <label>
                  Destination
                  <input
                    name="destination"
                    defaultValue={trip.destination ?? ""}
                    maxLength={180}
                    placeholder="Kyoto, Japan"
                  />
                </label>
                <label>
                  Start date
                  <input name="startDate" type="date" defaultValue={trip.start_date ?? ""} />
                </label>
                <label>
                  End date
                  <input name="endDate" type="date" defaultValue={trip.end_date ?? ""} />
                </label>
                <label>
                  Currency
                  <input name="currency" defaultValue={trip.currency} pattern="[A-Z]{3}" maxLength={3} />
                </label>
                <label className="wide">
                  Operations notes
                  <textarea
                    name="operationsNotes"
                    defaultValue={trip.operations_notes ?? ""}
                    maxLength={5000}
                    placeholder="Internal operating constraints, handoff context, and important traveller notes"
                  />
                </label>
                <button disabled={pending}>Save operating details</button>
              </form>
            ) : (
              <dl className="read-only-facts">
                <div><dt>Destination</dt><dd>{trip.destination || "Open"}</dd></div>
                <div><dt>Dates</dt><dd>{trip.start_date || "Open"} – {trip.end_date || "Open"}</dd></div>
                <div><dt>Currency</dt><dd>{trip.currency}</dd></div>
                <div><dt>Notes</dt><dd>{trip.operations_notes || "No internal notes"}</dd></div>
              </dl>
            )}
          </section>

          <section className="ops-panel">
            <div className="ops-panel-heading">
              <div>
                <p>PEOPLE MANIFEST</p>
                <h2>Traveller roster</h2>
              </div>
              <span>{travelers.length} people</span>
            </div>
            <div className="manifest-list">
              {travelers.map((traveler) => (
                <article key={traveler.id}>
                  <div className="traveler-avatar">
                    {traveler.first_name[0]}
                    {traveler.last_name?.[0] || ""}
                  </div>
                  <div>
                    <h3>{traveler.first_name} {traveler.last_name}</h3>
                    <p>{traveler.email || traveler.phone || "Contact details open"}</p>
                  </div>
                  <span>{traveler.role.replace("_", " ")}</span>
                </article>
              ))}
              {travelers.length === 0 && (
                <EmptyState
                  title="No travellers on the manifest"
                  description="Add the people whose journey this team is operating."
                />
              )}
            </div>
            {canManageTravelers && (
              <form className="ops-form compact-form" onSubmit={addTraveler}>
                <input name="firstName" required maxLength={100} placeholder="First name" aria-label="Traveller first name" />
                <input name="lastName" maxLength={100} placeholder="Last name" aria-label="Traveller last name" />
                <input name="email" type="email" placeholder="Email" aria-label="Traveller email" />
                <input name="phone" placeholder="Phone" aria-label="Traveller phone" />
                <input name="dateOfBirth" type="date" aria-label="Traveller date of birth" />
                <select name="role" defaultValue="traveler" aria-label="Traveller role">
                  <option value="traveler">Traveller</option>
                  <option value="lead_traveler">Lead traveller</option>
                  <option value="child">Child</option>
                </select>
                <input name="preferences" maxLength={2000} placeholder="Internal preferences or constraints" aria-label="Traveller preferences" />
                <button disabled={pending}>Add traveller</button>
              </form>
            )}
          </section>

          <section className="ops-panel">
            <div className="ops-panel-heading">
              <div>
                <p>SERVICE CONTROL</p>
                <h2>Booking ledger</h2>
              </div>
              <span>Internal tracking only</span>
            </div>
            <p className="safety-callout">
              Recording or moving a service here never contacts a supplier,
              charges a card, or confirms inventory.
            </p>
            {canBook && (
              <form className="ops-form booking-form" onSubmit={addBooking}>
                <input name="title" required maxLength={180} placeholder="Service title" aria-label="Booking title" />
                <select name="bookingType" defaultValue="hotel" aria-label="Booking type">
                  <option value="flight">Flight</option>
                  <option value="hotel">Hotel</option>
                  <option value="transfer">Transfer</option>
                  <option value="activity">Activity</option>
                  <option value="insurance">Insurance</option>
                  <option value="other">Other</option>
                </select>
                <select name="supplierId" defaultValue="" aria-label="Booking supplier">
                  <option value="">Supplier open</option>
                  {suppliers.map((supplier) => (
                    <option value={supplier.id} key={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                <input name="serviceStartAt" type="datetime-local" aria-label="Service start" />
                <input name="serviceEndAt" type="datetime-local" aria-label="Service end" />
                <input name="costAmount" type="number" min="0" step="0.01" placeholder={`Cost (${trip.currency})`} aria-label="Booking cost" />
                <input name="confirmationReference" maxLength={180} placeholder="Supplier reference (if received)" aria-label="Confirmation reference" />
                <input name="notes" maxLength={4000} placeholder="Internal booking notes" aria-label="Booking notes" />
                <button disabled={pending}>Create internal record</button>
              </form>
            )}
            <div className="booking-ledger">
              {bookings.map((booking) => (
                <article key={booking.id}>
                  <div>
                    <span>{booking.booking_type}</span>
                    <h3>{booking.title}</h3>
                    <p>
                      {booking.service_start_at
                        ? new Date(booking.service_start_at).toLocaleString()
                        : "Service time open"}
                      {booking.cost_amount === null
                        ? ""
                        : ` · ${booking.currency} ${booking.cost_amount.toLocaleString()}`}
                    </p>
                  </div>
                  <b className={`booking-state ${booking.status}`}>
                    {booking.status}
                  </b>
                  {canBook && nextBookingStatuses[booking.status].length > 0 && (
                    <div className="booking-actions">
                      {nextBookingStatuses[booking.status].includes("confirmed") && (
                        <input
                          value={confirmationDrafts[booking.id] ?? booking.confirmation_reference ?? ""}
                          onChange={(event) =>
                            setConfirmationDrafts((current) => ({
                              ...current,
                              [booking.id]: event.target.value,
                            }))
                          }
                          placeholder="Supplier confirmation reference"
                          aria-label={`Confirmation reference for ${booking.title}`}
                        />
                      )}
                      {nextBookingStatuses[booking.status].map((status) => (
                        <button
                          key={status}
                          type="button"
                          disabled={pending}
                          onClick={() => moveBooking(booking, status)}
                        >
                          Mark {status.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              {bookings.length === 0 && (
                <EmptyState
                  title="No service records"
                  description="Build the internal ledger before supplier confirmations begin."
                />
              )}
            </div>
          </section>
        </div>

        <aside className="trip-ops-side">
          <section className="ops-panel status-panel">
            <div className="ops-panel-heading">
              <div>
                <p>GOVERNED LIFECYCLE</p>
                <h2>Trip status</h2>
              </div>
              <span>{trip.status.replace("_", " ")}</span>
            </div>
            <div className="lifecycle-rail">
              {(["draft", "confirmed", "in_travel", "completed"] as TripStatus[]).map((status) => (
                <div
                  className={
                    status === trip.status
                      ? "current"
                      : history.some((item) => item.to_status === status)
                        ? "passed"
                        : ""
                  }
                  key={status}
                >
                  <i />
                  <span>{status.replace("_", " ")}</span>
                </div>
              ))}
            </div>
            {canOperate && nextTripStatuses[trip.status].length > 0 && (
              <>
                <textarea
                  value={statusNote}
                  onChange={(event) => setStatusNote(event.target.value)}
                  maxLength={500}
                  placeholder="Optional lifecycle note"
                  aria-label="Trip status note"
                />
                <div className="status-actions">
                  {nextTripStatuses[trip.status].map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={pending}
                      onClick={() => moveTrip(status)}
                    >
                      Move to {status.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </>
            )}
            {!canOperate && (
              <p className="role-note">Your role has read-only lifecycle access.</p>
            )}
          </section>

          <section className="ops-panel">
            <div className="ops-panel-heading">
              <div>
                <p>EXECUTION QUEUE</p>
                <h2>Operational tasks</h2>
              </div>
              <span>{tasks.length}</span>
            </div>
            {canManageTasks && (
              <form className="ops-form task-form" onSubmit={addTask}>
                <input name="title" required maxLength={500} placeholder="Operational follow-up" aria-label="Operational task title" />
                <input name="dueAt" type="datetime-local" aria-label="Operational task due date" />
                <button disabled={pending}>Add task</button>
              </form>
            )}
            <div className="task-stack">
              {tasks.map((task) => (
                <article key={task.id}>
                  <div>
                    <i className={task.status} />
                    <span>{task.title}</span>
                  </div>
                  <small>
                    {task.due_at
                      ? new Date(task.due_at).toLocaleString()
                      : "No due date"}
                  </small>
                  {canManageTasks && task.status !== "completed" && task.status !== "cancelled" && (
                    <div>
                      {task.status === "open" && (
                        <button type="button" disabled={pending} onClick={() => moveTask(task, "in_progress")}>
                          Start
                        </button>
                      )}
                      <button type="button" disabled={pending} onClick={() => moveTask(task, "completed")}>
                        Complete
                      </button>
                    </div>
                  )}
                </article>
              ))}
              {tasks.length === 0 && <p className="role-note">No operational follow-ups.</p>}
            </div>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-heading">
              <div>
                <p>PRIVATE VAULT</p>
                <h2>Trip documents</h2>
              </div>
              <span>{documents.length}</span>
            </div>
            {canManageDocuments && (
              <form className="ops-form document-form" onSubmit={uploadDocument}>
                <input
                  name="file"
                  type="file"
                  required
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                  aria-label="Private trip document"
                />
                <label>
                  Expiry
                  <input name="expiresAt" type="date" />
                </label>
                <button disabled={pending}>Store privately</button>
              </form>
            )}
            <div className="document-list">
              {documents.map((document) => {
                const expired =
                  document.expires_at &&
                  document.expires_at < new Date().toISOString().slice(0, 10);
                return (
                  <article key={document.id}>
                    <div>
                      <b>{document.file_name}</b>
                      <small>
                        {bytesLabel(document.byte_size)}
                        {document.expires_at
                          ? ` · ${expired ? "Expired" : `expires ${document.expires_at}`}`
                          : " · no expiry"}
                      </small>
                    </div>
                    {canManageDocuments && (
                      <button
                        className="document-download"
                        type="button"
                        disabled={pending}
                        onClick={() => downloadDocument(document)}
                      >
                        Secure download
                      </button>
                    )}
                  </article>
                );
              })}
              {documents.length === 0 && (
                <p className="role-note">No private trip files stored.</p>
              )}
            </div>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-heading">
              <div>
                <p>TRACE LEDGER</p>
                <h2>Operations timeline</h2>
              </div>
              <span>{activities.length}</span>
            </div>
            <ol className="activity-timeline">
              {activities.map((activity) => (
                <li key={activity.id}>
                  <i />
                  <div>
                    <b>{activity.body}</b>
                    <span>
                      {activity.activity_type.replaceAll("_", " ")} ·{" "}
                      {new Date(activity.created_at).toLocaleString()}
                    </span>
                  </div>
                </li>
              ))}
              {activities.length === 0 && (
                <li><div><b>No activity recorded yet.</b></div></li>
              )}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}
