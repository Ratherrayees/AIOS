"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  convertWonDealToTrip,
  refreshOperationsRadar,
} from "../actions/crm";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import {
  OperationsRadar,
  type OperationalException,
} from "../../components/ui/operations-radar";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import "./trips.css";

type Trip = {
  id: string;
  deal_id: string | null;
  name: string;
  status: "draft" | "confirmed" | "in_travel" | "completed" | "cancelled";
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  converted_at: string | null;
};

type WonDeal = {
  id: string;
  title: string;
  destination: string | null;
  value_amount: number | null;
  currency: string;
};

const conversionRoles = new Set([
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
]);
const radarRoles = new Set(["owner", "admin", "trip_designer", "operations"]);

const statusLabel: Record<Trip["status"], string> = {
  draft: "Planning",
  confirmed: "Confirmed",
  in_travel: "In travel",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function TripsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [wonDeals, setWonDeals] = useState<WonDeal[]>([]);
  const [exceptions, setExceptions] = useState<OperationalException[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const canConvert = role ? conversionRoles.has(role) : false;
  const canManageRadar = role ? radarRoles.has(role) : false;

  const eligibleDeals = useMemo(() => {
    const convertedDealIds = new Set(
      trips.map((trip) => trip.deal_id).filter(Boolean),
    );
    return wonDeals.filter((deal) => !convertedDealIds.has(deal.id));
  }, [trips, wonDeals]);

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
      let radarWarning = "";
      if (radarRoles.has(membership.role)) {
        try {
          await refreshOperationsRadar({
            organizationId: membership.organization_id,
          });
        } catch {
          radarWarning =
            "Trip data loaded, but Operations Radar could not refresh.";
        }
      }
      const [
        { data: tripRows, error: tripError },
        { data: dealRows, error: dealError },
        { data: exceptionRows, error: exceptionError },
      ] = await Promise.all([
          supabase
            .from("trips")
            .select(
              "id, deal_id, name, status, destination, start_date, end_date, converted_at",
            )
            .eq("organization_id", membership.organization_id)
            .order("updated_at", { ascending: false }),
          supabase
            .from("deals")
            .select("id, title, destination, value_amount, currency")
            .eq("organization_id", membership.organization_id)
            .eq("stage", "won")
            .is("archived_at", null)
            .order("updated_at", { ascending: false }),
          supabase
            .from("operational_exceptions")
            .select("*")
            .eq("organization_id", membership.organization_id)
            .in("status", ["open", "acknowledged"])
            .order("last_seen_at", { ascending: false }),
        ]);
      if (tripError || dealError || exceptionError)
        throw (
          tripError ??
          dealError ??
          exceptionError ??
          new Error("Trip data is unavailable.")
        );
      setTrips((tripRows ?? []) as Trip[]);
      setWonDeals((dealRows ?? []) as WonDeal[]);
      setExceptions(exceptionRows ?? []);
      if (radarWarning) setNotice(radarWarning);
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load trip operations.");
      setLoading(false);
    });
  }, []);

  function convertDeal(dealId: string) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const trip = await convertWonDealToTrip({
          organizationId,
          dealId,
        });
        setTrips((current) => [
          trip as Trip,
          ...current.filter((item) => item.id !== trip.id),
        ]);
        setNotice(
          "Operational trip opened. The lead traveller and lifecycle history are ready.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not convert this opportunity.",
        );
      }
    });
  }

  const liveTrips = trips.filter(
    (trip) => !["completed", "cancelled"].includes(trip.status),
  );
  const inTravelCount = trips.filter(
    (trip) => trip.status === "in_travel",
  ).length;
  const activeExceptionCount = exceptions.length;

  return (
    <main className="trips-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/", label: "Command center" },
          { href: "/itineraries", label: "Itinerary Studio" },
          { href: "/quotes", label: "Quotes" },
          { href: "/aios", label: "AIOS Control" },
        ]}
      />

      <section className="trips-hero">
        <div>
          <p>TRIP OPERATIONS / CONTROL DECK</p>
          <h1>From “won” to wheels up, one governed operating picture.</h1>
          <span>
            Coordinate travellers, services, internal tasks, documents, and
            lifecycle decisions. AIOS can observe and propose; accountable
            operators still control irreversible actions.
          </span>
        </div>
        <div className="trip-orbit" aria-hidden="true">
          <i />
          <b>{liveTrips.length}</b>
          <small>live journeys</small>
        </div>
      </section>

      {notice && (
        <p className="trips-notice" role="status">
          {notice}
        </p>
      )}

      <section className="trip-pulse" aria-label="Trip operations summary">
        <article>
          <span>ACTIVE</span>
          <b>{liveTrips.length}</b>
          <small>trips in motion</small>
        </article>
        <article>
          <span>LIVE</span>
          <b>{inTravelCount}</b>
          <small>currently travelling</small>
        </article>
        <article>
          <span>INTAKE</span>
          <b>{eligibleDeals.length}</b>
          <small>won deals ready</small>
        </article>
        <article>
          <span>ATTENTION</span>
          <b>{activeExceptionCount}</b>
          <small>active operational exceptions</small>
        </article>
      </section>

      {!loading && organizationId && (
        <OperationsRadar
          organizationId={organizationId}
          initialExceptions={exceptions}
          canManage={canManageRadar}
          onExceptionsChange={setExceptions}
        />
      )}

      {canConvert && (
        <section
          className="conversion-queue"
          aria-labelledby="conversion-queue-title"
        >
          <div className="trip-section-heading">
            <div>
              <p>CONTROLLED HANDOFF</p>
              <h2 id="conversion-queue-title">Won deals awaiting operations</h2>
            </div>
            <span>{eligibleDeals.length} ready</span>
          </div>
          {loading ? (
            <LoadingState label="Loading conversion queue" rows={2} />
          ) : eligibleDeals.length === 0 ? (
            <EmptyState
              title="No handoffs waiting"
              description="Newly won opportunities will appear here once their sales workflow is complete."
            />
          ) : (
            <div className="conversion-grid">
              {eligibleDeals.map((deal) => (
                <article key={deal.id}>
                  <div>
                    <span>WON OPPORTUNITY</span>
                    <h3>{deal.title}</h3>
                    <p>{deal.destination || "Destination not captured"}</p>
                  </div>
                  <strong>
                    {deal.value_amount === null
                      ? "Value pending"
                      : new Intl.NumberFormat("en-IN", {
                          style: "currency",
                          currency: deal.currency,
                          maximumFractionDigits: 0,
                        }).format(deal.value_amount)}
                  </strong>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => convertDeal(deal.id)}
                  >
                    {pending ? "Opening..." : "Open operational trip"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="trip-fleet" aria-labelledby="trip-fleet-title">
        <div className="trip-section-heading">
          <div>
            <p>OPERATING FLEET</p>
            <h2 id="trip-fleet-title">Every journey, one control surface</h2>
          </div>
          <span>{trips.length} total</span>
        </div>
        {loading ? (
          <LoadingState label="Loading operational trips" rows={4} />
        ) : trips.length === 0 ? (
          <EmptyState
            title="No operational trips yet"
            description="Convert a won deal above or begin an internal draft in Itinerary Studio."
          />
        ) : (
          <div className="trip-grid">
            {trips.map((trip) => (
              <Link href={`/trips/${trip.id}`} key={trip.id}>
                <article>
                  <div className="trip-card-topline">
                    <span className={`trip-status ${trip.status}`}>
                      {statusLabel[trip.status]}
                    </span>
                    <small>
                      {trip.converted_at ? "Sales handoff" : "Planning draft"}
                    </small>
                  </div>
                  <h3>{trip.name}</h3>
                  <p>{trip.destination || "Destination to be confirmed"}</p>
                  <div className="trip-date-rail">
                    <b>{trip.start_date || "Start open"}</b>
                    <i />
                    <b>{trip.end_date || "End open"}</b>
                  </div>
                  <span className="open-workspace">Open control deck →</span>
                </article>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
