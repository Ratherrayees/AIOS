"use server";

import { requireOrganizationRole } from "../../lib/authorization";
import {
  operationsRadarPolicySchema,
  operationsRadarRunNowSchema,
  type OperationsRadarPolicyInput,
} from "../../lib/operations/radar-schedule";
import { runDueOperationsRadarSchedules } from "../../lib/operations/radar-runner";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const POLICY_ROLES = ["owner", "admin", "operations"] as const;

export async function saveOperationsRadarPolicy(
  input: OperationsRadarPolicyInput,
) {
  const data = operationsRadarPolicySchema.parse(input);
  await requireOrganizationRole(data.organizationId, POLICY_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: policy, error } = await supabase
    .rpc("upsert_operations_radar_policy", {
      target_organization_id: data.organizationId,
      target_is_enabled: data.isEnabled,
      target_scan_interval_minutes: data.scanIntervalMinutes,
      target_confirmation_watch_days: data.confirmationWatchDays,
      target_confirmation_critical_hours: data.confirmationCriticalHours,
      target_confirmation_high_days: data.confirmationHighDays,
      target_document_expiry_days: data.documentExpiryDays,
      target_document_high_days: data.documentHighDays,
      target_payment_due_days: data.paymentDueDays,
      target_payment_high_days: data.paymentHighDays,
      target_task_critical_hours: data.taskCriticalHours,
      ...(data.defaultAssigneeId
        ? { target_default_assignee_id: data.defaultAssigneeId }
        : {}),
    })
    .single();
  if (error || !policy)
    throw error ?? new Error("Operations Radar policy could not be saved.");
  return policy;
}

export async function runOperationsRadarScheduleNow(input: {
  organizationId: string;
}) {
  const data = operationsRadarRunNowSchema.parse(input);
  await requireOrganizationRole(data.organizationId, POLICY_ROLES);
  const summary = await runDueOperationsRadarSchedules(
    1,
    data.organizationId,
    true,
  );
  if (summary.claimed === 0)
    throw new Error(
      "This workspace already has an active Operations Radar lease.",
    );
  return summary;
}
