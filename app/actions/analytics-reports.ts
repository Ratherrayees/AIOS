"use server";

import { requireOrganizationRole } from "../../lib/authorization";
import {
  analyticsReportRunNowSchema,
  analyticsReportScheduleSchema,
  type AnalyticsReportScheduleInput,
} from "../../lib/analytics/report-schedule";
import { runDueAnalyticsReports } from "../../lib/analytics/report-runner";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const REPORT_ROLES = ["owner", "admin"] as const;

export async function saveAnalyticsReportSchedule(
  input: AnalyticsReportScheduleInput,
) {
  const data = analyticsReportScheduleSchema.parse(input);
  await requireOrganizationRole(data.organizationId, REPORT_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: schedule, error } = await supabase
    .rpc("upsert_analytics_report_schedule", {
      target_organization_id: data.organizationId,
      target_is_enabled: data.isEnabled,
      target_cadence: data.cadence,
      target_period_days: data.periodDays,
      target_forecast_horizon_days: data.forecastHorizonDays,
      target_next_run_at: data.nextRunAt,
    })
    .single();
  if (error || !schedule)
    throw error ?? new Error("The management report schedule was not saved.");
  return schedule;
}

export async function runAnalyticsReportNow(input: {
  organizationId: string;
}) {
  const data = analyticsReportRunNowSchema.parse(input);
  await requireOrganizationRole(data.organizationId, REPORT_ROLES);
  const summary = await runDueAnalyticsReports(1, data.organizationId, true);
  if (summary.claimed === 0)
    throw new Error("This workspace already has an active report lease.");
  return summary;
}
