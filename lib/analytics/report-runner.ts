import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { buildManagementAnomalyDesk } from "./management-anomalies";
import {
  buildManagementExportRows,
  managementExportFilename,
  serializeManagementExportCsv,
} from "./management-export";
import {
  buildGrowthIntelligence,
  buildManagementIntelligence,
  buildPortfolioIntelligence,
  type ManagementBooking,
  type ManagementException,
  type ManagementKnowledgeConflict,
  type ManagementKnowledgeSource,
  type ManagementPayment,
  type ManagementSupplier,
  type ManagementTrip,
  type PortfolioCostEstimate,
  type PortfolioQuote,
  type PortfolioQuoteVersion,
  type QualityConversation,
} from "./management-intelligence";
import {
  buildManagementPeriodComparison,
  type PeriodException,
  type PeriodKnowledgeSource,
  type PeriodPayment,
  type PeriodQuote,
  type PeriodTripTransition,
} from "./management-period";
import { buildRetentionCohorts } from "./retention-cohorts";
import { buildTargetCoverage, type AnalyticsTarget } from "./targets";
import {
  buildCompletedTripEconomics,
  type EconomicsBooking,
  type EconomicsPayment,
  type EconomicsQuote,
  type EconomicsQuoteVersion,
  type EconomicsTrip,
} from "./trip-economics";
import { createSupabaseAdminClient } from "../supabase/admin";

type ReportWindow = 30 | 90 | 365;
type ScheduledReportSummary = {
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
  return "management_report_failed";
}

async function buildScheduledReport(
  organizationId: string,
  periodDays: ReportWindow,
  forecastHorizonDays: ReportWindow,
  generatedAt: Date,
) {
  const admin = createSupabaseAdminClient();
  const [
    dealsResult,
    tripsResult,
    exceptionsResult,
    bookingsResult,
    suppliersResult,
    paymentsResult,
    knowledgeSourcesResult,
    knowledgeConflictsResult,
    quotesResult,
    quoteVersionsResult,
    quoteCostsResult,
    conversationsResult,
    targetsResult,
    tripTransitionsResult,
  ] = await Promise.all([
    admin
      .from("deals")
      .select(
        "contact_id, owner_id, destination, next_step, expected_close_at, stage, value_amount, currency, probability, won_at",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .limit(10000),
    admin
      .from("trips")
      .select("id, status, start_date, quote_id, currency")
      .eq("organization_id", organizationId)
      .limit(10000),
    admin
      .from("operational_exceptions")
      .select("status, severity, due_at, assigned_to, detected_at")
      .eq("organization_id", organizationId)
      .limit(10000),
    admin
      .from("bookings")
      .select("trip_id, supplier_id, status, cost_amount, currency")
      .eq("organization_id", organizationId)
      .limit(20000),
    admin
      .from("suppliers")
      .select("id, status, archived_at, quality_rating")
      .eq("organization_id", organizationId)
      .limit(10000),
    admin
      .from("payments")
      .select(
        "trip_id, amount, paid_amount, currency, direction, status, created_at",
      )
      .eq("organization_id", organizationId)
      .limit(20000),
    admin
      .from("knowledge_sources")
      .select("status, review_due_on, reviewed_at")
      .eq("organization_id", organizationId)
      .limit(10000),
    admin
      .from("knowledge_conflicts")
      .select("status")
      .eq("organization_id", organizationId)
      .limit(10000),
    admin
      .from("quotes")
      .select("id, currency, status, current_version, accepted_at")
      .eq("organization_id", organizationId)
      .limit(10000),
    admin
      .from("quote_versions")
      .select(
        "id, quote_id, version, total_amount, net_amount, margin_amount, margin_percent",
      )
      .eq("organization_id", organizationId)
      .limit(20000),
    admin
      .from("quote_cost_estimates")
      .select("quote_version_id, estimated_cost_amount")
      .eq("organization_id", organizationId)
      .limit(20000),
    admin
      .from("conversations")
      .select("status, archived_at, assignee_id")
      .eq("organization_id", organizationId)
      .limit(20000),
    admin
      .from("analytics_targets")
      .select(
        "id, label, currency, period_start, period_end, target_amount, is_active",
      )
      .eq("organization_id", organizationId)
      .limit(5000),
    admin
      .from("trip_status_history")
      .select("to_status, changed_at")
      .eq("organization_id", organizationId)
      .limit(20000),
  ]);

  const failedResult = [
    dealsResult,
    tripsResult,
    exceptionsResult,
    bookingsResult,
    suppliersResult,
    paymentsResult,
    knowledgeSourcesResult,
    knowledgeConflictsResult,
    quotesResult,
    quoteVersionsResult,
    quoteCostsResult,
    conversationsResult,
    targetsResult,
    tripTransitionsResult,
  ].find((result) => result.error);
  if (failedResult?.error) throw failedResult.error;

  const deals = dealsResult.data ?? [];
  const trips = tripsResult.data ?? [];
  const exceptions = exceptionsResult.data ?? [];
  const bookings = bookingsResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const knowledgeSources = knowledgeSourcesResult.data ?? [];
  const knowledgeConflicts = knowledgeConflictsResult.data ?? [];
  const quotes = quotesResult.data ?? [];
  const quoteVersions = quoteVersionsResult.data ?? [];

  const management = buildManagementIntelligence({
    trips: trips as ManagementTrip[],
    exceptions: exceptions as ManagementException[],
    bookings: bookings as ManagementBooking[],
    suppliers: suppliers as ManagementSupplier[],
    payments: payments as ManagementPayment[],
    knowledgeSources: knowledgeSources as ManagementKnowledgeSource[],
    knowledgeConflicts:
      knowledgeConflicts as ManagementKnowledgeConflict[],
    now: generatedAt,
  });
  const portfolio = buildPortfolioIntelligence({
    quotes: quotes as PortfolioQuote[],
    versions: quoteVersions as PortfolioQuoteVersion[],
    costEstimates: (quoteCostsResult.data ?? []) as PortfolioCostEstimate[],
    deals,
    conversations: (conversationsResult.data ?? []) as QualityConversation[],
    trips: trips as ManagementTrip[],
    bookings: bookings as ManagementBooking[],
    suppliers: suppliers as ManagementSupplier[],
  });
  const tripEconomics = buildCompletedTripEconomics({
    trips: trips as EconomicsTrip[],
    quotes: quotes as EconomicsQuote[],
    quoteVersions: quoteVersions as EconomicsQuoteVersion[],
    bookings: bookings as EconomicsBooking[],
    payments: payments as EconomicsPayment[],
  });
  const managementPeriod = buildManagementPeriodComparison({
    preset: periodDays,
    now: generatedAt,
    deals,
    quotes: quotes as PeriodQuote[],
    tripTransitions:
      (tripTransitionsResult.data ?? []) as PeriodTripTransition[],
    exceptions: exceptions as PeriodException[],
    payments: payments as PeriodPayment[],
    knowledgeSources: knowledgeSources as PeriodKnowledgeSource[],
  });
  const anomalyDesk = buildManagementAnomalyDesk({
    management,
    portfolio,
    managementPeriod,
  });
  const input = {
    generatedAt,
    management,
    portfolio,
    tripEconomics,
    growth: buildGrowthIntelligence(deals, {
      now: generatedAt,
      horizonDays: forecastHorizonDays,
    }),
    retentionCohorts: buildRetentionCohorts(deals, generatedAt),
    managementPeriod,
    anomalyDesk,
    targetCoverage: buildTargetCoverage(
      deals,
      (targetsResult.data ?? []) as AnalyticsTarget[],
      generatedAt,
    ),
  };
  const rows = buildManagementExportRows(input);
  const csv = serializeManagementExportCsv(rows);
  return {
    csv,
    filename: managementExportFilename(generatedAt),
    rowCount: rows.length,
    sha256: createHash("sha256").update(csv).digest("hex"),
  };
}

/**
 * Claims and generates tenant-scoped aggregate reports. Delivery is an
 * immutable in-app CSV snapshot; no email or external effect is performed.
 */
export async function runDueAnalyticsReports(
  limit = 10,
  organizationId?: string,
  force = false,
): Promise<ScheduledReportSummary> {
  const admin = createSupabaseAdminClient();
  const workerId = `report-${randomUUID()}`;
  const { data: claimedRuns, error: claimError } = await admin.rpc(
    "claim_analytics_report_runs",
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

  const summary: ScheduledReportSummary = {
    claimed: claimedRuns?.length ?? 0,
    succeeded: 0,
    failed: 0,
  };
  for (const run of claimedRuns ?? []) {
    try {
      const generatedAt = new Date();
      const report = await buildScheduledReport(
        run.organization_id,
        run.report_period_days as ReportWindow,
        run.report_forecast_horizon_days as ReportWindow,
        generatedAt,
      );
      const { error: settleError } = await admin.rpc(
        "settle_analytics_report_run",
        {
          target_run_id: run.run_id,
          target_worker_id: workerId,
          target_status: "ready",
          target_report_filename: report.filename,
          target_report_csv: report.csv,
          target_report_row_count: report.rowCount,
          target_report_sha256: report.sha256,
        },
      );
      if (settleError) throw settleError;
      summary.succeeded += 1;
    } catch (error) {
      const { error: settleError } = await admin.rpc(
        "settle_analytics_report_run",
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
