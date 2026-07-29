import "server-only";

import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "../supabase/admin";

type RadarRunSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
};

function boundedErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const normalized = error.code
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 80);
    if (normalized.length >= 3) return normalized;
  }
  return "radar_scan_failed";
}

/**
 * Claims and executes only deterministic internal scans. The database owns
 * lease/idempotency state; this worker has no external-effect tool.
 */
export async function runDueOperationsRadarSchedules(
  limit = 10,
  organizationId?: string,
  force = false,
): Promise<RadarRunSummary> {
  const admin = createSupabaseAdminClient();
  const workerId = `radar-${randomUUID()}`;
  const { data: claimedRuns, error: claimError } = await admin.rpc(
    "claim_operations_radar_runs",
    {
      target_worker_id: workerId,
      target_limit: Math.min(Math.max(Math.trunc(limit), 1), 25),
      target_force: force,
      ...(organizationId
        ? { target_organization_id: organizationId }
        : {}),
    },
  );
  if (claimError) throw claimError;

  const summary: RadarRunSummary = {
    claimed: claimedRuns?.length ?? 0,
    succeeded: 0,
    failed: 0,
  };

  for (const run of claimedRuns ?? []) {
    try {
      const { data: scan, error: scanError } = await admin
        .rpc("refresh_operational_exceptions", {
          target_organization_id: run.organization_id,
        })
        .single();
      if (scanError || !scan)
        throw scanError ?? new Error("Operations Radar returned no result.");

      const { error: settleError } = await admin.rpc(
        "settle_operations_radar_run",
        {
          target_run_id: run.run_id,
          target_worker_id: workerId,
          target_status: "succeeded",
          target_active_count: scan.active_count,
          target_critical_count: scan.critical_count,
          target_resolved_count: scan.resolved_count,
        },
      );
      if (settleError) throw settleError;
      summary.succeeded += 1;
    } catch (error) {
      const { error: settleError } = await admin.rpc(
        "settle_operations_radar_run",
        {
          target_run_id: run.run_id,
          target_worker_id: workerId,
          target_status: "failed",
          target_error_code: boundedErrorCode(error),
        },
      );
      if (settleError) throw settleError;
      summary.failed += 1;
    }
  }

  return summary;
}
