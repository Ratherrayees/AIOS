"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  convertWonDealToTrip,
  refreshOperationsRadar,
} from "../actions/crm";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionNotice,
} from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { OperationalPageHeader } from "../../components/ui/operational-page-header";
import {
  OperationsRadar,
  type OperationalException,
} from "../../components/ui/operations-radar";
import { OperationsRadarSchedule } from "../../components/ui/operations-radar-schedule";
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
  owner_id: string | null;
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tripScope, setTripScope] = useState<"mine" | "workspace">("mine");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [wonDeals, setWonDeals] = useState<WonDeal[]>([]);
  const [exceptions, setExceptions] = useState<OperationalException[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
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
      setLoading(true);
      setLoadError("");
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user)
        throw userError ?? new Error("The signed-in profile is unavailable.");
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setLoadError("No active workspace is available for this account.");
        setLoading(false);
        return;
      }
      setOrganizationId(membership.organization_id);
      setRole(membership.role);
      setCurrentUserId(user.id);
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
              "id, deal_id, name, status, destination, start_date, end_date, converted_at, owner_id",
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
      setLoadError("Trip operations could not be loaded.");
      setLoading(false);
    });
  }, [reloadKey]);

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
  const myLiveTrips = liveTrips.filter(
    (trip) => trip.owner_id === currentUserId,
  );
  const visibleTrips =
    tripScope === "mine"
      ? trips.filter((trip) => trip.owner_id === currentUserId)
      : trips;
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
          { href: "/finance", label: "Suppliers & Finance" },
          { href: "/quotes", label: "Quotes" },
          { href: "/aios/activity", label: "AI Activity" },
        ]}
      />

      <OperationalPageHeader
        section="Travel"
        title="Trips"
        meta={`${myLiveTrips.length} my active · ${liveTrips.length} workspace active · ${inTravelCount} travelling · ${activeExceptionCount} need attention`}
      />

      {notice && (
        <p className="trips-notice" role="status">
          {notice}
        </p>
      )}
      {loadError ? (
        <ErrorState
          title="Trips are unavailable"
          description={loadError}
          onRetry={() => setReloadKey((current) => current + 1)}
        />
      ) : (
      <>

      {!canConvert && role ? (
        <PermissionNotice description="You can inspect the trip fleet and operational risk. Converting won opportunities into trips requires a sales, planning, or operations role." />
      ) : null}

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
        <>
          <OperationsRadar
            organizationId={organizationId}
            initialExceptions={exceptions}
            canManage={canManageRadar}
            onExceptionsChange={setExceptions}
          />
          <OperationsRadarSchedule
            organizationId={organizationId}
            role={role}
          />
        </>
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
            <h2 id="trip-fleet-title">
              {tripScope === "mine" ? "My operational trips" : "Workspace trip fleet"}
            </h2>
          </div>
          <div className="trip-scope" aria-label="Trip ownership scope">
            <button
              type="button"
              aria-pressed={tripScope === "mine"}
              onClick={() => setTripScope("mine")}
            >
              My trips
              <span>{trips.filter((trip) => trip.owner_id === currentUserId).length}</span>
            </button>
            <button
              type="button"
              aria-pressed={tripScope === "workspace"}
              onClick={() => setTripScope("workspace")}
            >
              Workspace <span>{trips.length}</span>
            </button>
          </div>
        </div>
        {loading ? (
          <LoadingState label="Loading operational trips" rows={4} />
        ) : trips.length === 0 ? (
          <EmptyState
            title="No operational trips yet"
            description="Convert a won deal above or begin an internal draft in Itinerary Studio."
          />
        ) : visibleTrips.length === 0 ? (
          <EmptyState
            title="No trips assigned to you"
            description="Use Workspace to review the full operating fleet or assign ownership from a trip workspace."
          />
        ) : (
          <div className="trip-grid">
            {visibleTrips.map((trip) => (
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
      </>
      )}
    </main>
  );
}
