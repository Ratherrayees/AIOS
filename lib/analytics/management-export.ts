import type {
  buildGrowthIntelligence,
  buildManagementIntelligence,
  buildPortfolioIntelligence,
} from "./management-intelligence";
import type { buildTargetCoverage } from "./targets";
import type { buildCompletedTripEconomics } from "./trip-economics";

type ManagementIntelligence = ReturnType<typeof buildManagementIntelligence>;
type PortfolioIntelligence = ReturnType<typeof buildPortfolioIntelligence>;
type GrowthIntelligence = ReturnType<typeof buildGrowthIntelligence>;
type TargetCoverage = ReturnType<typeof buildTargetCoverage>;
type TripEconomics = ReturnType<typeof buildCompletedTripEconomics>;

export type ManagementExportRow = {
  section: string;
  metric: string;
  currency: string;
  value: string | number;
  unit: string;
  definition: string;
};

export type ManagementExportInput = {
  generatedAt: Date;
  management: ManagementIntelligence;
  portfolio: PortfolioIntelligence;
  tripEconomics: TripEconomics;
  growth: GrowthIntelligence;
  targetCoverage: TargetCoverage;
};

const headers: (keyof ManagementExportRow)[] = [
  "section",
  "metric",
  "currency",
  "value",
  "unit",
  "definition",
];

function row(
  section: string,
  metric: string,
  value: string | number,
  unit: string,
  definition: string,
  currency = "",
): ManagementExportRow {
  return { section, metric, currency, value, unit, definition };
}

function percent(value: number | null) {
  return value === null ? "Not measured" : Number(value.toFixed(2));
}

export function buildManagementExportRows({
  generatedAt,
  management,
  portfolio,
  tripEconomics,
  growth,
  targetCoverage,
}: ManagementExportInput) {
  const rows: ManagementExportRow[] = [
    row(
      "Report boundary",
      "Generated at",
      generatedAt.toISOString(),
      "UTC timestamp",
      "Snapshot time for this browser-generated report.",
    ),
    row(
      "Report boundary",
      "Authorization",
      "Current workspace aggregates only",
      "policy",
      "Derived only from records visible through the signed-in member's tenant RLS policies.",
    ),
    row(
      "Report boundary",
      "Personal data",
      "Excluded",
      "policy",
      "No contact, traveler, deal, trip, message, document, or free-text target identifiers are exported.",
    ),
    row(
      "Report boundary",
      "Currency aggregation",
      "Separated",
      "policy",
      "Amounts are never added across currencies.",
    ),
    row(
      "Operations",
      "Active trips",
      management.operations.activeTrips,
      "trips",
      "Trips in Draft, Confirmed, or In travel.",
    ),
    row(
      "Operations",
      "Trips in travel",
      management.operations.inTravelTrips,
      "trips",
      "Active trips currently in the In travel state.",
    ),
    row(
      "Operations",
      "Trips departing within 30 days",
      management.operations.departingSoon,
      "trips",
      "Active trips with a known future start date no more than 30 days away.",
    ),
    row(
      "Operations",
      "Active exceptions",
      management.operations.activeExceptions,
      "exceptions",
      "Operational exceptions in Open or Acknowledged state.",
    ),
    row(
      "Operations",
      "High or critical exceptions",
      management.operations.urgentExceptions,
      "exceptions",
      "Active operational exceptions with High or Critical severity.",
    ),
    row(
      "Operations",
      "Overdue exceptions",
      management.operations.overdueExceptions,
      "exceptions",
      "Active operational exceptions whose due timestamp has passed.",
    ),
    row(
      "Operations",
      "Unassigned exceptions",
      management.operations.unassignedExceptions,
      "exceptions",
      "Active operational exceptions with no accountable owner.",
    ),
    row(
      "Supplier readiness",
      "Active suppliers",
      management.suppliers.activeSuppliers,
      "suppliers",
      "Unarchived supplier profiles in Active state.",
    ),
    row(
      "Supplier readiness",
      "Suppliers used by active trips",
      management.suppliers.suppliersInActiveTrips,
      "suppliers",
      "Active suppliers linked to non-cancelled bookings on active trips.",
    ),
    row(
      "Supplier readiness",
      "Active booking inventory",
      management.suppliers.activeBookingInventory,
      "bookings",
      "Non-cancelled bookings on active trips.",
    ),
    row(
      "Supplier readiness",
      "Confirmed bookings",
      management.suppliers.confirmedBookings,
      "bookings",
      "Confirmed bookings on active trips.",
    ),
    row(
      "Supplier readiness",
      "Booking confirmation rate",
      percent(management.suppliers.confirmationRate),
      "percent",
      "Confirmed active-trip bookings divided by all non-cancelled active-trip bookings.",
    ),
    row(
      "Supplier readiness",
      "Average supplier quality",
      management.suppliers.averageQualityRating === null
        ? "Not measured"
        : Number(management.suppliers.averageQualityRating.toFixed(2)),
      "rating out of 5",
      "Average recorded quality rating across active rated suppliers.",
    ),
    row(
      "Finance",
      "Open obligations",
      management.finance.openObligations,
      "obligations",
      "Pending, Partially paid, or Overdue receivables and payables.",
    ),
  ];

  for (const exposure of management.finance.currencies) {
    rows.push(
      row(
        "Finance",
        "Outstanding receivable",
        exposure.receivable,
        "money",
        "Obligation amount less recorded settlement evidence.",
        exposure.currency,
      ),
      row(
        "Finance",
        "Outstanding payable",
        exposure.payable,
        "money",
        "Obligation amount less recorded settlement evidence.",
        exposure.currency,
      ),
      row(
        "Finance",
        "Overdue exposure",
        exposure.overdue,
        "money",
        "Outstanding balance on Overdue obligations.",
        exposure.currency,
      ),
      row(
        "Finance",
        "Open obligations by currency",
        exposure.openObligations,
        "obligations",
        "Open obligations recorded in this currency.",
        exposure.currency,
      ),
    );
  }

  rows.push(
    row(
      "Knowledge",
      "Current approved sources",
      management.knowledge.approvedCurrent,
      "sources",
      "Approved sources with a current review deadline.",
    ),
    row(
      "Knowledge",
      "Stale approved sources",
      management.knowledge.approvedStale,
      "sources",
      "Approved sources with a missing or expired review deadline.",
    ),
    row(
      "Knowledge",
      "Sources awaiting review",
      management.knowledge.inReview,
      "sources",
      "Sources explicitly submitted for human review.",
    ),
    row(
      "Knowledge",
      "Open conflict signals",
      management.knowledge.openConflicts,
      "conflicts",
      "Unreviewed deterministic conflicts between approved evidence.",
    ),
    row(
      "Knowledge",
      "Confirmed conflicts",
      management.knowledge.confirmedConflicts,
      "conflicts",
      "Conflicts confirmed by a human reviewer.",
    ),
    row(
      "Knowledge",
      "Approved-source freshness",
      percent(management.knowledge.freshnessRate),
      "percent",
      "Current approved sources divided by all approved sources.",
    ),
    row(
      "Commercial quality",
      "Current quotes",
      portfolio.profitability.currentQuotes,
      "quotes",
      "Quotes in Draft, Shared, or Accepted state.",
    ),
    row(
      "Commercial quality",
      "Costed current quotes",
      portfolio.profitability.costedQuotes,
      "quotes",
      "Current quote versions with matching internal cost evidence.",
    ),
    row(
      "Commercial quality",
      "Quotes missing cost evidence",
      portfolio.profitability.missingCostEstimate,
      "quotes",
      "Current quote versions without a matching internal cost estimate.",
    ),
    row(
      "Commercial quality",
      "Quotes missing current version",
      portfolio.profitability.missingCurrentVersion,
      "quotes",
      "Current quote records without their declared current version.",
    ),
  );

  for (const profitability of portfolio.profitability.currencies) {
    rows.push(
      row(
        "Quote profitability",
        "Quoted revenue",
        profitability.quotedRevenue,
        "money",
        "Revenue on costed current quote versions; not realized accounting revenue.",
        profitability.currency,
      ),
      row(
        "Quote profitability",
        "Estimated cost",
        profitability.estimatedCost,
        "money",
        "Internal estimated cost on the same current quote versions.",
        profitability.currency,
      ),
      row(
        "Quote profitability",
        "Estimated gross margin",
        profitability.grossMargin,
        "money",
        "Quoted revenue less internal estimated cost; not realized accounting profit.",
        profitability.currency,
      ),
      row(
        "Quote profitability",
        "Estimated gross margin rate",
        Number(profitability.grossMarginPercent.toFixed(2)),
        "percent",
        "Estimated gross margin divided by quoted revenue.",
        profitability.currency,
      ),
      row(
        "Quote profitability",
        "Costed quotes by currency",
        profitability.costedQuotes,
        "quotes",
        "Costed current quote versions recorded in this currency.",
        profitability.currency,
      ),
    );
  }

  rows.push(
    row(
      "Completed-trip economics",
      "Completed trips",
      tripEconomics.summary.completedTrips,
      "trips",
      "Trips in Completed state that are eligible for evidence review.",
    ),
    row(
      "Completed-trip economics",
      "Evidence-ready completed trips",
      tripEconomics.summary.evidenceReadyTrips,
      "trips",
      "Completed trips with an Accepted current quote and complete Confirmed same-currency booking costs.",
    ),
    row(
      "Completed-trip economics",
      "Missing Accepted quote",
      tripEconomics.summary.missingAcceptedQuote,
      "trips",
      "Completed trips excluded because no linked quote is in Accepted state.",
    ),
    row(
      "Completed-trip economics",
      "Missing current quote version",
      tripEconomics.summary.missingCurrentQuoteVersion,
      "trips",
      "Completed trips excluded because the Accepted quote's current version is unavailable.",
    ),
    row(
      "Completed-trip economics",
      "Unresolved booking evidence",
      tripEconomics.summary.unresolvedBookingEvidence,
      "trips",
      "Completed trips excluded because Draft or Requested bookings remain.",
    ),
    row(
      "Completed-trip economics",
      "Missing Confirmed booking costs",
      tripEconomics.summary.missingConfirmedBookingCosts,
      "trips",
      "Completed trips excluded because no Confirmed booking exists or a Confirmed cost is missing.",
    ),
    row(
      "Completed-trip economics",
      "Commercial currency conflicts",
      tripEconomics.summary.commercialCurrencyConflicts,
      "trips",
      "Completed trips excluded because trip, quote, and Confirmed booking currencies do not agree.",
    ),
    row(
      "Completed-trip economics",
      "Reconciliation ledger conflicts",
      tripEconomics.summary.reconciliationCurrencyConflicts,
      "ledger rows",
      "Non-void payment rows excluded because currency or direction does not match the completed trip evidence.",
    ),
  );

  for (const economics of tripEconomics.currencies) {
    rows.push(
      row(
        "Completed-trip economics",
        "Accepted quote value",
        economics.contractedRevenue,
        "money",
        "Accepted current quote value on evidence-ready Completed trips; not accounting revenue recognition.",
        economics.currency,
      ),
      row(
        "Completed-trip economics",
        "Confirmed booking cost",
        economics.confirmedBookingCost,
        "money",
        "Recorded costs on Confirmed bookings for the same evidence-ready Completed trips.",
        economics.currency,
      ),
      row(
        "Completed-trip economics",
        "Operating margin evidence",
        economics.operatingMargin,
        "money",
        "Accepted quote value less Confirmed booking costs; not realized accounting profit.",
        economics.currency,
      ),
      row(
        "Completed-trip economics",
        "Operating margin rate",
        Number(economics.operatingMarginPercent.toFixed(2)),
        "percent",
        "Operating margin evidence divided by Accepted quote value.",
        economics.currency,
      ),
      row(
        "Completed-trip reconciliation",
        "Customer receivables recorded",
        economics.customerReceivables,
        "money",
        "Non-void customer receivable obligations linked to evidence-ready Completed trips.",
        economics.currency,
      ),
      row(
        "Completed-trip reconciliation",
        "Customer settlement evidence",
        economics.customerCollected,
        "money",
        "Recorded allocations on matching customer receivables; not bank reconciliation.",
        economics.currency,
      ),
      row(
        "Completed-trip reconciliation",
        "Supplier payables recorded",
        economics.supplierPayables,
        "money",
        "Non-void supplier payable obligations linked to evidence-ready Completed trips.",
        economics.currency,
      ),
      row(
        "Completed-trip reconciliation",
        "Supplier settlement evidence",
        economics.supplierSettled,
        "money",
        "Recorded allocations on matching supplier payables; not bank reconciliation.",
        economics.currency,
      ),
    );
  }

  const quality = portfolio.quality;
  rows.push(
    row(
      "Data quality",
      "Incomplete open deals",
      quality.incompleteDeals,
      "deals",
      "Open opportunities missing one or more required management fields.",
    ),
    row(
      "Data quality",
      "Open deals",
      quality.openDeals,
      "deals",
      "Opportunities in New, Qualified, Proposal, or Decision state.",
    ),
    row(
      "Data quality",
      "Deals missing owner",
      quality.missingDealOwner,
      "deals",
      "Open opportunities without an accountable owner.",
    ),
    row(
      "Data quality",
      "Deals missing value",
      quality.missingDealValue,
      "deals",
      "Open opportunities without a positive commercial value.",
    ),
    row(
      "Data quality",
      "Deals missing destination",
      quality.missingDealDestination,
      "deals",
      "Open opportunities without a destination.",
    ),
    row(
      "Data quality",
      "Deals missing next step",
      quality.missingDealNextStep,
      "deals",
      "Open opportunities without a next step.",
    ),
    row(
      "Data quality",
      "Deals missing close date",
      quality.missingDealCloseDate,
      "deals",
      "Open opportunities without an expected close date.",
    ),
    row(
      "Data quality",
      "Unassigned open conversations",
      quality.unassignedConversations,
      "conversations",
      "Open, unarchived Inbox conversations without an assignee.",
    ),
    row(
      "Data quality",
      "Active bookings missing cost",
      quality.uncategorizedBookingCosts,
      "bookings",
      "Non-cancelled bookings on active trips without cost evidence.",
    ),
    row(
      "Data quality",
      "Active suppliers missing rating",
      quality.unratedActiveSuppliers,
      "suppliers",
      "Unarchived active suppliers without a quality rating.",
    ),
  );

  for (const forecast of growth.forecast.currencies) {
    rows.push(
      row(
        "Forecast",
        `Open pipeline within ${growth.forecast.horizonDays} days`,
        forecast.pipelineValue,
        "money",
        `Open opportunities expected to close by ${growth.forecast.horizonDate}.`,
        forecast.currency,
      ),
      row(
        "Forecast",
        `Probability-weighted forecast within ${growth.forecast.horizonDays} days`,
        forecast.weightedForecast,
        "money",
        "Open opportunity value multiplied by its recorded probability.",
        forecast.currency,
      ),
      row(
        "Forecast",
        `Forecast-ready opportunities within ${growth.forecast.horizonDays} days`,
        forecast.opportunities,
        "opportunities",
        "Open opportunities with value and close date inside the forecast horizon.",
        forecast.currency,
      ),
    );
  }

  rows.push(
    row(
      "Forecast quality",
      "Forecast-ready opportunities",
      growth.forecast.forecastReadyOpportunities,
      "opportunities",
      `Open opportunities with value and close date through ${growth.forecast.horizonDate}.`,
    ),
    row(
      "Forecast quality",
      "Missing forecast inputs",
      growth.forecast.missingForecastInputs,
      "opportunities",
      "Open opportunities missing a positive value or expected close date.",
    ),
    row(
      "Forecast quality",
      "Overdue expected close dates",
      growth.forecast.overdueCloseDates,
      "opportunities",
      "Open opportunities whose expected close date has passed.",
    ),
    row(
      "Retention",
      "Customers with a win",
      growth.retention.wonCustomers,
      "customers",
      "Contacts linked to at least one Won opportunity.",
    ),
    row(
      "Retention",
      "Repeat customers",
      growth.retention.repeatCustomers,
      "customers",
      "Contacts linked to at least two Won opportunities.",
    ),
    row(
      "Retention",
      "Wins after the first",
      growth.retention.repeatWins,
      "wins",
      "Won opportunities beyond each returning customer's first win.",
    ),
    row(
      "Retention",
      "Repeat-customer rate",
      percent(growth.retention.repeatCustomerRate),
      "percent",
      "Customers with at least two wins divided by customers with at least one win.",
    ),
  );

  targetCoverage.forEach((target, index) => {
    const targetReference = `Approved target ${index + 1} (${target.period_start} to ${target.period_end})`;
    rows.push(
      row(
        "Pipeline coverage",
        `${targetReference}: target amount`,
        target.target_amount,
        "money",
        "Human-approved target; the free-text target label is deliberately omitted.",
        target.currency,
      ),
      row(
        "Pipeline coverage",
        `${targetReference}: open pipeline`,
        target.pipelineValue,
        "money",
        "Open opportunity value matching the target's exact currency and close-date period.",
        target.currency,
      ),
      row(
        "Pipeline coverage",
        `${targetReference}: weighted forecast`,
        target.weightedForecast,
        "money",
        "Matching open pipeline multiplied by recorded opportunity probability.",
        target.currency,
      ),
      row(
        "Pipeline coverage",
        `${targetReference}: pipeline coverage`,
        percent(target.pipelineCoveragePercent),
        "percent",
        "Matching open pipeline divided by the approved target.",
        target.currency,
      ),
      row(
        "Pipeline coverage",
        `${targetReference}: weighted coverage`,
        percent(target.weightedCoveragePercent),
        "percent",
        "Matching weighted forecast divided by the approved target.",
        target.currency,
      ),
    );
  });

  return rows;
}

function csvCell(value: string | number) {
  let normalized = String(value).replace(/\0/g, "");
  if (/^[\t\r ]*[=+\-@]/.test(normalized)) {
    normalized = `'${normalized}`;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function serializeManagementExportCsv(rows: ManagementExportRow[]) {
  const header = headers.map((value) => csvCell(value)).join(",");
  const body = rows.map((item) =>
    headers.map((key) => csvCell(item[key])).join(","),
  );
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

export function createManagementExportCsv(input: ManagementExportInput) {
  return serializeManagementExportCsv(buildManagementExportRows(input));
}

export function managementExportFilename(generatedAt: Date) {
  return `aios-management-report-${generatedAt.toISOString().slice(0, 10)}.csv`;
}
