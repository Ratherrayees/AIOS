"use server";

import { requireOrganizationRole } from "../../lib/authorization";
import {
  analyticsTargetSchema,
  type AnalyticsTargetInput,
} from "../../lib/analytics/targets";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const TARGET_ROLES = ["owner", "admin"] as const;

export async function saveAnalyticsTarget(input: AnalyticsTargetInput) {
  const data = analyticsTargetSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TARGET_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: target, error } = await supabase
    .rpc("upsert_analytics_target", {
      target_organization_id: data.organizationId,
      target_label: data.label,
      target_currency: data.currency,
      target_period_start: data.periodStart,
      target_period_end: data.periodEnd,
      target_amount: data.targetAmount,
      target_is_active: data.isActive,
      ...(data.targetId ? { target_id: data.targetId } : {}),
    })
    .single();
  if (error || !target)
    throw error ?? new Error("The analytics target could not be saved.");
  return target;
}
