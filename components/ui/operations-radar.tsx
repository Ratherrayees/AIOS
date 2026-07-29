"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import {
  refreshOperationsRadar,
  updateOperationalExceptionStatus,
} from "../../app/actions/crm";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import type { Database } from "../../types/database";

export type OperationalException =
  Database["public"]["Tables"]["operational_exceptions"]["Row"];

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

function dueLabel(value: string | null) {
  if (!value) return "No fixed deadline";
  const date = new Date(value);
  const deltaHours = Math.round((date.getTime() - Date.now()) / 3_600_000);
  if (deltaHours < -24)
    return `${Math.abs(Math.round(deltaHours / 24))}d overdue`;
  if (deltaHours < 0) return `${Math.abs(deltaHours)}h overdue`;
  if (deltaHours < 48) return `Due in ${deltaHours}h`;
  return `Due ${date.toLocaleDateString()}`;
}

export function OperationsRadar({
  organizationId,
  initialExceptions,
  canManage,
  tripId,
  onExceptionsChange,
}: {
  organizationId: string;
  initialExceptions: OperationalException[];
  canManage: boolean;
  tripId?: string;
  onExceptionsChange?: (exceptions: OperationalException[]) => void;
}) {
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [resolutionNotes, setResolutionNotes] = useState<
    Record<string, string>
  >({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [isPending, startTransition] = useTransition();

  const activeExceptions = useMemo(
    () =>
      exceptions
        .filter(
          (exception) =>
            exception.status !== "resolved" &&
            (!tripId || exception.trip_id === tripId),
        )
        .sort(
          (left, right) =>
            (severityOrder[left.severity] ?? 99) -
              (severityOrder[right.severity] ?? 99) ||
            (left.due_at ?? "9999").localeCompare(right.due_at ?? "9999"),
        ),
    [exceptions, tripId],
  );

  const criticalCount = activeExceptions.filter(
    (exception) => exception.severity === "critical",
  ).length;

  async function reloadExceptions() {
    const supabase = createSupabaseBrowserClient();
    let query = supabase
      .from("operational_exceptions")
      .select("*")
      .eq("organization_id", organizationId)
      .in("status", ["open", "acknowledged"])
      .order("last_seen_at", { ascending: false });
    if (tripId) query = query.eq("trip_id", tripId);
    const { data, error } = await query;
    if (error) throw error;
    const nextExceptions = data ?? [];
    setExceptions(nextExceptions);
    onExceptionsChange?.(nextExceptions);
    return nextExceptions;
  }

  function scanNow() {
    if (isPending || !canManage) return;
    setPendingId("scan");
    setNotice("");
    startTransition(async () => {
      try {
        const summary = await refreshOperationsRadar({ organizationId });
        const refreshedExceptions = await reloadExceptions();
        const scopedCriticalCount = refreshedExceptions.filter(
          (exception) => exception.severity === "critical",
        ).length;
        setNotice(
          tripId
            ? `Trip scan complete: ${refreshedExceptions.length} active, ${scopedCriticalCount} critical.`
            : `Scan complete: ${summary.active_count} active, ${summary.critical_count} critical, ${summary.resolved_count} cleared.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Operations Radar could not complete its scan.",
        );
      } finally {
        setPendingId(null);
      }
    });
  }

  function changeStatus(
    exception: OperationalException,
    status: "acknowledged" | "resolved",
  ) {
    if (isPending || !canManage) return;
    const note = resolutionNotes[exception.id]?.trim() || null;
    setPendingId(exception.id);
    setNotice("");
    startTransition(async () => {
      try {
        const updated = await updateOperationalExceptionStatus({
          organizationId,
          exceptionId: exception.id,
          status,
          note,
        });
        const nextExceptions = exceptions.map((item) =>
          item.id === updated.id ? updated : item,
        );
        setExceptions(nextExceptions);
        onExceptionsChange?.(nextExceptions);
        setResolutionNotes((current) => ({
          ...current,
          [exception.id]: "",
        }));
        setNotice(
          status === "acknowledged"
            ? "Exception acknowledged and kept visible until it clears."
            : "Exception resolved with human evidence.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The operational exception could not be updated.",
        );
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <section
      className={`operations-radar ${tripId ? "compact" : ""}`}
      id="operations-radar"
      aria-labelledby={tripId ? "trip-radar-title" : "radar-title"}
    >
      <div className="radar-heading">
        <div>
          <p>AIOS / OPERATIONS RADAR</p>
          <h2 id={tripId ? "trip-radar-title" : "radar-title"}>
            {tripId ? "Risks on this journey" : "Exceptions before incidents"}
          </h2>
          <span>
            AIOS detects objective internal risk across services, payments,
            itinerary coverage, and human-reviewed passport or visa dates. It
            cannot make an immigration decision, contact suppliers, confirm
            inventory, move money, or share documents from here.
          </span>
        </div>
        <div className="radar-controls">
          <b className={criticalCount ? "has-critical" : ""}>
            {criticalCount} critical
          </b>
          {canManage && (
            <button
              type="button"
              disabled={isPending}
              onClick={scanNow}
            >
              {pendingId === "scan" ? "Scanning…" : "Scan now"}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p className="radar-notice" role="status">
          {notice}
        </p>
      )}

      {activeExceptions.length === 0 ? (
        <div className="radar-clear">
          <i>✓</i>
          <div>
            <b>No active operational exceptions</b>
            <span>
              The latest persisted scan found no objective risks in this scope.
            </span>
          </div>
        </div>
      ) : (
        <div className="radar-grid">
          {activeExceptions.map((exception) => (
            <article
              className={`radar-card ${exception.severity}`}
              key={exception.id}
            >
              <div className="radar-card-topline">
                <span>{exception.severity}</span>
                <small>{dueLabel(exception.due_at)}</small>
              </div>
              <h3>{exception.title}</h3>
              <p>{exception.summary}</p>
              <div className="radar-card-meta">
                <span>
                  {exception.status === "acknowledged"
                    ? "Human acknowledged"
                    : "Needs an owner"}
                </span>
                {!tripId && (
                  <Link href={`/trips/${exception.trip_id}`}>
                    Open trip →
                  </Link>
                )}
              </div>
              {canManage && (
                <div className="radar-actions">
                  {exception.status === "open" && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        changeStatus(exception, "acknowledged")
                      }
                    >
                      Acknowledge
                    </button>
                  )}
                  <label>
                    <span>Resolution evidence</span>
                    <input
                      value={resolutionNotes[exception.id] ?? ""}
                      onChange={(event) =>
                        setResolutionNotes((current) => ({
                          ...current,
                          [exception.id]: event.target.value,
                        }))
                      }
                      maxLength={500}
                      placeholder="What was fixed?"
                      aria-label={`Resolution note for ${exception.title}`}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      isPending ||
                      !resolutionNotes[exception.id]?.trim()
                    }
                    onClick={() => changeStatus(exception, "resolved")}
                  >
                    {pendingId === exception.id ? "Updating…" : "Resolve"}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
