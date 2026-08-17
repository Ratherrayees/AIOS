import "server-only";

import { createSupabaseAdminClient } from "../supabase/admin";

export type ApprovalEscalationSummary = {
  inspected: number;
  assigned: number;
  rerouted: number;
  reminded: number;
  failed: number;
};

/**
 * Escalates only due pending human gates. The database owns row locking,
 * approver eligibility, deadline renewal, immutable evidence, and audit state.
 */
export async function runDueApprovalEscalations(
  limit = 25,
): Promise<ApprovalEscalationSummary> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .rpc("escalate_overdue_approval_requests", {
      target_limit: Math.min(Math.max(Math.trunc(limit), 1), 100),
    })
    .single();
  if (error || !data)
    throw error ?? new Error("Approval escalation returned no summary.");
  return data;
}
