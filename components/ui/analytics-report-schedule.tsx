"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  runAnalyticsReportNow,
  saveAnalyticsReportSchedule,
} from "../../app/actions/analytics-reports";
import type { AnalyticsReportScheduleInput } from "../../lib/analytics/report-schedule";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import type { Database } from "../../types/database";

type ReportSchedule =
  Database["public"]["Tables"]["analytics_report_schedules"]["Row"];
type ReportDelivery =
  Database["public"]["Tables"]["analytics_report_deliveries"]["Row"];

function localDateTimeValue(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function readableDate(value: string | null) {
  if (!value) return "No delivery yet";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function fetchReportSchedule(organizationId: string) {
  const supabase = createSupabaseBrowserClient();
  const [
    { data: schedule, error: scheduleError },
    { data: deliveries, error: deliveriesError },
  ] = await Promise.all([
    supabase
      .from("analytics_report_schedules")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("analytics_report_deliveries")
      .select("*")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(6),
  ]);
  if (scheduleError || deliveriesError)
    throw scheduleError ?? deliveriesError;
  return {
    schedule,
    deliveries: deliveries ?? [],
  };
}

export function AnalyticsReportSchedule({
  organizationId,
  role,
}: {
  organizationId: string;
  role: string | null;
}) {
  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);
  const [deliveries, setDeliveries] = useState<ReportDelivery[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<"save" | "run" | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const canConfigure = role === "owner" || role === "admin";

  async function reload() {
    const next = await fetchReportSchedule(organizationId);
    setSchedule(next.schedule);
    setDeliveries(next.deliveries);
    setLoading(false);
  }

  useEffect(() => {
    let current = true;
    void fetchReportSchedule(organizationId)
      .then((next) => {
        if (!current) return;
        setSchedule(next.schedule);
        setDeliveries(next.deliveries);
        setLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setNotice("The durable report schedule could not be loaded.");
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [organizationId]);

  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!schedule || !canConfigure || pending) return;
    const form = new FormData(event.currentTarget);
    const nextRun = new Date(String(form.get("nextRunAt") || ""));
    const input: AnalyticsReportScheduleInput = {
      organizationId,
      isEnabled: form.get("isEnabled") === "on",
      cadence: String(form.get("cadence")) as "weekly" | "monthly",
      periodDays: Number(form.get("periodDays")) as 30 | 90 | 365,
      forecastHorizonDays: Number(
        form.get("forecastHorizonDays"),
      ) as 30 | 90 | 365,
      nextRunAt: nextRun.toISOString(),
    };
    setPendingAction("save");
    setNotice("");
    startTransition(async () => {
      try {
        const saved = await saveAnalyticsReportSchedule(input);
        setSchedule(saved);
        setNotice(
          saved.is_enabled
            ? "Schedule saved. The bounded worker can deliver the next aggregate snapshot."
            : "Schedule paused. Run now remains available.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The report schedule was not saved.",
        );
      } finally {
        setPendingAction(null);
      }
    });
  }

  function runNow() {
    if (!schedule || !canConfigure || pending) return;
    setPendingAction("run");
    setNotice("");
    startTransition(async () => {
      try {
        const summary = await runAnalyticsReportNow({ organizationId });
        await reload();
        setNotice(
          `Aggregate delivery complete: ${summary.succeeded} ready, ${summary.failed} failed.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The report delivery could not start.",
        );
      } finally {
        setPendingAction(null);
      }
    });
  }

  function downloadDelivery(delivery: ReportDelivery) {
    if (
      delivery.status !== "ready" ||
      !delivery.report_csv ||
      !delivery.report_filename
    )
      return;
    const url = URL.createObjectURL(
      new Blob([delivery.report_csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = delivery.report_filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice(
      "Immutable aggregate delivery downloaded from the current workspace.",
    );
  }

  if (loading) {
    return (
      <section className="report-schedule">
        <p>AIOS / SCHEDULED REPORTING</p>
        <h2>Loading durable delivery controls…</h2>
      </section>
    );
  }
  if (!schedule) {
    return (
      <section className="report-schedule">
        <p>AIOS / SCHEDULED REPORTING</p>
        <h2>Schedule policy unavailable</h2>
        <span>
          This workspace needs its local schema synchronized before report
          delivery can be configured.
        </span>
      </section>
    );
  }

  return (
    <section className="report-schedule" aria-labelledby="report-schedule-title">
      <header>
        <div>
          <p>AIOS / SCHEDULED REPORTING</p>
          <h2 id="report-schedule-title">
            Deliver an immutable management brief on schedule
          </h2>
          <span>
            AIOS generates the same privacy-safe aggregate CSV and delivers it
            to this workspace. No email, contact data, or external action is
            used.
          </span>
        </div>
        <div className="report-schedule-state">
          <b data-enabled={schedule.is_enabled}>
            {schedule.is_enabled ? "SCHEDULE ON" : "SCHEDULE PAUSED"}
          </b>
          <small>Next due {readableDate(schedule.next_run_at)}</small>
          {canConfigure && (
            <button type="button" onClick={runNow} disabled={pending}>
              {pendingAction === "run" ? "Generating…" : "Generate now"}
            </button>
          )}
        </div>
      </header>

      {notice && (
        <p className="report-schedule-notice" role="status">
          {notice}
        </p>
      )}

      <div className="report-schedule-grid">
        <form
          aria-label="Management report schedule"
          key={schedule.updated_at}
          onSubmit={saveSchedule}
        >
          <label className="report-schedule-toggle">
            <input
              type="checkbox"
              name="isEnabled"
              defaultChecked={schedule.is_enabled}
              disabled={!canConfigure || pending}
            />
            <span>
              <b>Enable scheduled in-app delivery</b>
              <small>The report remains aggregate-only and tenant-scoped.</small>
            </span>
          </label>
          <label>
            <span>Cadence</span>
            <select
              name="cadence"
              defaultValue={schedule.cadence}
              disabled={!canConfigure || pending}
            >
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </label>
          <label>
            <span>Comparison period</span>
            <select
              name="periodDays"
              defaultValue={schedule.period_days}
              disabled={!canConfigure || pending}
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          <label>
            <span>Forecast horizon</span>
            <select
              name="forecastHorizonDays"
              defaultValue={schedule.forecast_horizon_days}
              disabled={!canConfigure || pending}
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          <label>
            <span>Next delivery</span>
            <input
              type="datetime-local"
              name="nextRunAt"
              defaultValue={localDateTimeValue(schedule.next_run_at)}
              disabled={!canConfigure || pending}
              required
            />
          </label>
          {canConfigure ? (
            <button type="submit" disabled={pending}>
              {pendingAction === "save" ? "Saving…" : "Save delivery schedule"}
            </button>
          ) : (
            <p className="report-schedule-boundary">
              Only owners and admins configure report delivery.
            </p>
          )}
        </form>

        <aside>
          <div>
            <p>IN-APP DELIVERY HISTORY</p>
            <b>{deliveries.length} recent runs</b>
            <small>
              Ready snapshots are immutable. Failed runs contain only a bounded
              error code.
            </small>
          </div>
          {deliveries.length ? (
            <ol>
              {deliveries.map((delivery) => (
                <li key={delivery.id}>
                  <div>
                    <b>{readableDate(delivery.finished_at)}</b>
                    <span>
                      {delivery.trigger_type} · {delivery.status}
                    </span>
                    {delivery.status === "ready" && (
                      <small>
                        {delivery.report_row_count} rows · SHA-256{" "}
                        {delivery.report_sha256?.slice(0, 12)}…
                      </small>
                    )}
                    {delivery.status === "failed" && (
                      <small>Error {delivery.error_code}</small>
                    )}
                  </div>
                  {delivery.status === "ready" && (
                    <button
                      type="button"
                      onClick={() => downloadDelivery(delivery)}
                    >
                      Download snapshot
                    </button>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="report-history-empty">
              No scheduled or operator delivery has run yet.
            </p>
          )}
        </aside>
      </div>
      <footer>
        Email transport is intentionally not enabled here. It can be attached
        to this audited delivery outbox after the domain and Resend webhook are
        verified.
      </footer>
    </section>
  );
}
