"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  runOperationsRadarScheduleNow,
  saveOperationsRadarPolicy,
} from "../../app/actions/operations-radar";
import {
  radarScheduleIntervals,
  type OperationsRadarPolicyInput,
} from "../../lib/operations/radar-schedule";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import type { Database } from "../../types/database";

type RadarPolicy =
  Database["public"]["Tables"]["operations_radar_policies"]["Row"];
type RadarRun = Database["public"]["Tables"]["operations_radar_runs"]["Row"];
type MemberOption = { id: string; label: string };

const scheduleRoles = new Set(["owner", "admin", "operations"]);

const intervalLabels: Record<number, string> = {
  15: "Every 15 minutes",
  30: "Every 30 minutes",
  60: "Every hour",
  180: "Every 3 hours",
  360: "Every 6 hours",
  720: "Every 12 hours",
  1440: "Every day",
};

function readableDate(value: string | null) {
  if (!value) return "No completed run";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function fetchSchedule(organizationId: string) {
  const supabase = createSupabaseBrowserClient();
  const [
    { data: policyRow, error: policyError },
    { data: runRows, error: runError },
    { data: membershipRows, error: membershipError },
  ] = await Promise.all([
    supabase
      .from("operations_radar_policies")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("operations_radar_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(6),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("created_at"),
  ]);
  if (policyError || runError || membershipError)
    throw policyError ?? runError ?? membershipError;

  const memberIds = (membershipRows ?? []).map((member) => member.user_id);
  const { data: profileRows, error: profileError } = memberIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", memberIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map(
    (profileRows ?? []).map((profile) => [
      profile.id,
      profile.full_name || "Workspace member",
    ]),
  );
  return {
    policy: policyRow,
    runs: runRows ?? [],
    members: (membershipRows ?? []).map((member) => ({
      id: member.user_id,
      label: `${names.get(member.user_id) || "Workspace member"} · ${member.role.replace("_", " ")}`,
    })),
  };
}

export function OperationsRadarSchedule({
  organizationId,
  role,
}: {
  organizationId: string;
  role: string | null;
}) {
  const [policy, setPolicy] = useState<RadarPolicy | null>(null);
  const [runs, setRuns] = useState<RadarRun[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<
    "save" | "run" | null
  >(null);
  const [pending, startTransition] = useTransition();
  const canConfigure = role ? scheduleRoles.has(role) : false;

  async function loadSchedule() {
    const schedule = await fetchSchedule(organizationId);
    setPolicy(schedule.policy);
    setRuns(schedule.runs);
    setMembers(schedule.members);
    setLoading(false);
  }

  useEffect(() => {
    let current = true;
    void fetchSchedule(organizationId)
      .then((schedule) => {
        if (!current) return;
        setPolicy(schedule.policy);
        setRuns(schedule.runs);
        setMembers(schedule.members);
        setLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setNotice("The durable Operations Radar schedule could not be loaded.");
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [organizationId]);

  function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfigure || pending) return;
    const form = new FormData(event.currentTarget);
    const input: OperationsRadarPolicyInput = {
      organizationId,
      isEnabled: form.get("isEnabled") === "on",
      scanIntervalMinutes: Number(
        form.get("scanIntervalMinutes"),
      ) as OperationsRadarPolicyInput["scanIntervalMinutes"],
      confirmationWatchDays: Number(form.get("confirmationWatchDays")),
      confirmationCriticalHours: Number(
        form.get("confirmationCriticalHours"),
      ),
      confirmationHighDays: Number(form.get("confirmationHighDays")),
      documentExpiryDays: Number(form.get("documentExpiryDays")),
      documentHighDays: Number(form.get("documentHighDays")),
      paymentDueDays: Number(form.get("paymentDueDays")),
      paymentHighDays: Number(form.get("paymentHighDays")),
      taskCriticalHours: Number(form.get("taskCriticalHours")),
      defaultAssigneeId: String(form.get("defaultAssigneeId") || "") || null,
    };
    setPendingAction("save");
    setNotice("");
    startTransition(async () => {
      try {
        const saved = await saveOperationsRadarPolicy(input);
        setPolicy(saved);
        setNotice(
          saved.is_enabled
            ? "Schedule saved. The next due run is ready for the bounded worker."
            : "Schedule paused. Manual scans remain available.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The Operations Radar policy could not be saved.",
        );
      } finally {
        setPendingAction(null);
      }
    });
  }

  function runNow() {
    if (!canConfigure || pending) return;
    setPendingAction("run");
    setNotice("");
    startTransition(async () => {
      try {
        const summary = await runOperationsRadarScheduleNow({
          organizationId,
        });
        await loadSchedule();
        setNotice(
          `Durable run complete: ${summary.succeeded} succeeded, ${summary.failed} failed.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The durable Operations Radar run could not start.",
        );
      } finally {
        setPendingAction(null);
      }
    });
  }

  if (loading) {
    return (
      <section className="radar-schedule">
        <p>AIOS / DURABLE AUTOMATION</p>
        <h2>Loading schedule controls…</h2>
      </section>
    );
  }
  if (!policy) {
    return (
      <section className="radar-schedule">
        <p>AIOS / DURABLE AUTOMATION</p>
        <h2>Schedule policy unavailable</h2>
        <span>
          This workspace needs its local schema synchronized before scheduling
          can be configured.
        </span>
      </section>
    );
  }

  return (
    <section className="radar-schedule" aria-labelledby="radar-schedule-title">
      <div className="radar-schedule-heading">
        <div>
          <p>AIOS / DURABLE AUTOMATION</p>
          <h2 id="radar-schedule-title">
            Monitor continuously. Escalate internally.
          </h2>
          <span>
            The scheduler only refreshes objective exception records. It cannot
            contact a traveler or supplier, confirm a booking, share a file, or
            move money.
          </span>
        </div>
        <div className="radar-schedule-state">
          <b data-enabled={policy.is_enabled}>
            {policy.is_enabled ? "AUTO MONITORING ON" : "AUTO MONITORING PAUSED"}
          </b>
          <small>Next due {readableDate(policy.next_run_at)}</small>
          {canConfigure && (
            <button type="button" disabled={pending} onClick={runNow}>
              {pendingAction === "run" ? "Running…" : "Run durable scan now"}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p className="radar-schedule-notice" role="status">
          {notice}
        </p>
      )}

      <div className="radar-schedule-body">
        <form
          key={policy.updated_at}
          onSubmit={savePolicy}
          aria-label="Operations Radar schedule policy"
        >
          <div className="radar-schedule-primary">
            <label className="radar-toggle">
              <input
                type="checkbox"
                name="isEnabled"
                defaultChecked={policy.is_enabled}
                disabled={!canConfigure || pending}
              />
              <span>
                <b>Enable scheduled scans</b>
                <small>Manual “Scan now” remains available when paused.</small>
              </span>
            </label>
            <label>
              <span>Scan frequency</span>
              <select
                name="scanIntervalMinutes"
                defaultValue={policy.scan_interval_minutes}
                disabled={!canConfigure || pending}
              >
                {radarScheduleIntervals.map((interval) => (
                  <option value={interval} key={interval}>
                    {intervalLabels[interval]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Fallback exception owner</span>
              <select
                name="defaultAssigneeId"
                defaultValue={policy.default_assignee_id ?? ""}
                disabled={!canConfigure || pending}
              >
                <option value="">Use trip/task ownership</option>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset disabled={!canConfigure || pending}>
            <legend>Bounded risk windows</legend>
            <div className="radar-threshold-grid">
              <article>
                <b>Supplier confirmation</b>
                <label>
                  <span>Watch days</span>
                  <input
                    type="number"
                    name="confirmationWatchDays"
                    min="1"
                    max="14"
                    defaultValue={policy.confirmation_watch_days}
                  />
                </label>
                <label>
                  <span>High within days</span>
                  <input
                    type="number"
                    name="confirmationHighDays"
                    min="1"
                    max="14"
                    defaultValue={policy.confirmation_high_days}
                  />
                </label>
                <label>
                  <span>Critical within hours</span>
                  <input
                    type="number"
                    name="confirmationCriticalHours"
                    min="1"
                    max="168"
                    defaultValue={policy.confirmation_critical_hours}
                  />
                </label>
              </article>
              <article>
                <b>Traveler documents</b>
                <label>
                  <span>Watch days</span>
                  <input
                    type="number"
                    name="documentExpiryDays"
                    min="1"
                    max="30"
                    defaultValue={policy.document_expiry_days}
                  />
                </label>
                <label>
                  <span>High within days</span>
                  <input
                    type="number"
                    name="documentHighDays"
                    min="1"
                    max="30"
                    defaultValue={policy.document_high_days}
                  />
                </label>
              </article>
              <article>
                <b>Payment obligations</b>
                <label>
                  <span>Watch days</span>
                  <input
                    type="number"
                    name="paymentDueDays"
                    min="1"
                    max="7"
                    defaultValue={policy.payment_due_days}
                  />
                </label>
                <label>
                  <span>High within days</span>
                  <input
                    type="number"
                    name="paymentHighDays"
                    min="1"
                    max="7"
                    defaultValue={policy.payment_high_days}
                  />
                </label>
              </article>
              <article>
                <b>Overdue operations tasks</b>
                <label>
                  <span>Critical after hours</span>
                  <input
                    type="number"
                    name="taskCriticalHours"
                    min="1"
                    max="168"
                    defaultValue={policy.task_critical_hours}
                  />
                </label>
              </article>
            </div>
          </fieldset>

          {canConfigure ? (
            <button type="submit" disabled={pending}>
              {pendingAction === "save" ? "Saving…" : "Save governed policy"}
            </button>
          ) : (
            <p className="radar-schedule-boundary">
              Owners, admins, and operations roles configure this policy.
            </p>
          )}
        </form>

        <aside>
          <div>
            <p>RECENT DURABLE RUNS</p>
            <b>{policy.last_run_status || "No completed run"}</b>
            <small>{readableDate(policy.last_run_at)}</small>
          </div>
          {runs.length === 0 ? (
            <p className="radar-run-empty">
              No durable run has been claimed yet. Operator “Scan now” activity
              remains in the audit trail.
            </p>
          ) : (
            <ol>
              {runs.map((run) => (
                <li key={run.id}>
                  <span data-status={run.status}>{run.status}</span>
                  <div>
                    <b>{run.trigger_type} scan</b>
                    <small>{readableDate(run.started_at)}</small>
                  </div>
                  <small>
                    {run.status === "succeeded"
                      ? `${run.active_count} active · ${run.resolved_count} cleared`
                      : run.error_code || "Worker lease active"}
                  </small>
                </li>
              ))}
            </ol>
          )}
          <p className="radar-schedule-boundary">
            Deployment scheduling stays fail-closed until the server worker
            secret and wake-up schedule are configured.
          </p>
        </aside>
      </div>
    </section>
  );
}
