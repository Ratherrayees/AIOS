import type {
  buildManagementIntelligence,
  buildPortfolioIntelligence,
} from "./management-intelligence";
import type { buildManagementPeriodComparison } from "./management-period";

type ManagementIntelligence = ReturnType<typeof buildManagementIntelligence>;
type PortfolioIntelligence = ReturnType<typeof buildPortfolioIntelligence>;
type ManagementPeriod = ReturnType<typeof buildManagementPeriodComparison>;

export type ManagementAnomalySeverity = "urgent" | "watch" | "information";

export type ManagementAnomalyEvidence = {
  metric: string;
  value: string;
  scope: string;
  source: string;
  href: string;
};

export type ManagementAnomaly = {
  id: string;
  severity: ManagementAnomalySeverity;
  category: "operations" | "commercial" | "finance" | "knowledge" | "quality";
  headline: string;
  explanation: string;
  nextStep: string;
  limitation: string;
  evidence: ManagementAnomalyEvidence[];
};

export type ManagementAnomalyDesk = {
  engine: "AIOS deterministic evidence rules";
  rulesVersion: "2026-07-29.1";
  anomalies: ManagementAnomaly[];
  evaluatedSignals: number;
};

const severityRank: Record<ManagementAnomalySeverity, number> = {
  urgent: 0,
  watch: 1,
  information: 2,
};

function periodScope(period: ManagementPeriod["period"]) {
  return `${period.start} to ${period.end}`;
}

function previousPeriodScope(period: ManagementPeriod["period"]) {
  return `${period.previousStart} to ${period.previousEnd}`;
}

function periodHref(key: string) {
  if (key === "won-opportunities") return "/leads";
  if (key === "accepted-quotes") return "/quotes";
  if (key === "completed-trips" || key === "detected-exceptions")
    return "/trips";
  if (key === "knowledge-approvals") return "/knowledge";
  return "/finance";
}

function comparisonEvidence(
  row: ManagementPeriod["rows"][number],
  period: ManagementPeriod["period"],
) {
  return [
    {
      metric: `${row.label} — current`,
      value: `${row.current} events`,
      scope: periodScope(period),
      source: row.source,
      href: periodHref(row.key),
    },
    {
      metric: `${row.label} — previous`,
      value: `${row.previous} events`,
      scope: previousPeriodScope(period),
      source: row.source,
      href: periodHref(row.key),
    },
  ];
}

function buildPeriodAnomalies(
  managementPeriod: ManagementPeriod,
): ManagementAnomaly[] {
  const anomalies: ManagementAnomaly[] = [];
  const outcomeKeys = new Set([
    "won-opportunities",
    "accepted-quotes",
    "completed-trips",
  ]);

  for (const row of managementPeriod.rows) {
    const enoughEvidence = row.current + row.previous >= 4;
    const materialChange =
      row.deltaPercent === null
        ? row.current >= 3
        : Math.abs(row.deltaPercent) >= 25;
    if (!enoughEvidence || !materialChange || row.delta === 0) continue;

    if (row.key === "detected-exceptions" && row.delta > 0) {
      anomalies.push({
        id: "operational-exceptions-increased",
        severity: "urgent",
        category: "operations",
        headline: "Operational exception detections increased",
        explanation:
          row.previous === 0
            ? `${row.current} exceptions were detected in the current period after none in the equal preceding period.`
            : `Exception detections moved from ${row.previous} to ${row.current}, a ${Math.abs(row.deltaPercent!).toFixed(1)}% increase.`,
        nextStep:
          "Review open exceptions, ownership, deadlines, and repeat categories in Trip Operations.",
        limitation:
          "This comparison proves a change in detected events, not its cause or business impact.",
        evidence: comparisonEvidence(row, managementPeriod.period),
      });
      continue;
    }

    if (outcomeKeys.has(row.key) && row.delta < 0) {
      anomalies.push({
        id: `${row.key}-decreased`,
        severity: "watch",
        category: row.key === "completed-trips" ? "operations" : "commercial",
        headline: `${row.label} decreased`,
        explanation: `${row.label} moved from ${row.previous} to ${row.current} across equal ${managementPeriod.period.days}-day periods, a ${Math.abs(row.deltaPercent!).toFixed(1)}% decrease.`,
        nextStep: `Open ${row.source.split(" · ")[0]} and review the underlying workflow records before deciding why the change occurred.`,
        limitation:
          "Volume change alone does not prove demand, team performance, seasonality, or causation.",
        evidence: comparisonEvidence(row, managementPeriod.period),
      });
      continue;
    }

    anomalies.push({
      id: `${row.key}-${row.delta > 0 ? "increased" : "decreased"}`,
      severity: "information",
      category:
        row.key === "knowledge-approvals"
          ? "knowledge"
          : row.key === "recorded-payables" ||
              row.key === "recorded-receivables"
            ? "finance"
            : row.key === "completed-trips"
              ? "operations"
              : "commercial",
      headline: `${row.label} ${row.delta > 0 ? "increased" : "decreased"}`,
      explanation:
        row.previous === 0
          ? `${row.current} events were recorded in the current period after none in the equal preceding period.`
          : `${row.label} moved from ${row.previous} to ${row.current}, a ${Math.abs(row.deltaPercent!).toFixed(1)}% ${row.delta > 0 ? "increase" : "decrease"}.`,
      nextStep: `Inspect ${row.source.split(" · ")[0]} before treating the change as positive or negative.`,
      limitation:
        "AIOS classifies this as an unusual count change only; it does not infer a cause or outcome.",
      evidence: comparisonEvidence(row, managementPeriod.period),
    });
  }

  return anomalies;
}

export function buildManagementAnomalyDesk({
  management,
  portfolio,
  managementPeriod,
}: {
  management: ManagementIntelligence;
  portfolio: PortfolioIntelligence;
  managementPeriod: ManagementPeriod;
}): ManagementAnomalyDesk {
  const anomalies = buildPeriodAnomalies(managementPeriod);
  let evaluatedSignals = managementPeriod.rows.length;

  evaluatedSignals += 1;
  if (management.operations.urgentExceptions > 0) {
    anomalies.push({
      id: "urgent-open-exceptions",
      severity: "urgent",
      category: "operations",
      headline: "Urgent trip risks need accountable ownership",
      explanation: `${management.operations.urgentExceptions} active exceptions are marked high or critical; ${management.operations.overdueExceptions} are overdue and ${management.operations.unassignedExceptions} are unassigned.`,
      nextStep:
        "Open Trip Operations, assign every urgent exception, and confirm its next deadline.",
      limitation:
        "Severity, deadline, and assignment state do not prove the root cause or traveler impact.",
      evidence: [
        {
          metric: "High or critical active exceptions",
          value: `${management.operations.urgentExceptions} exceptions`,
          scope: "Current workspace snapshot",
          source: "Trip Operations · Governed exception state",
          href: "/trips",
        },
        {
          metric: "Overdue / unassigned active exceptions",
          value: `${management.operations.overdueExceptions} / ${management.operations.unassignedExceptions}`,
          scope: "Current workspace snapshot",
          source: "Trip Operations · Deadline and owner evidence",
          href: "/trips",
        },
      ],
    });
  }

  evaluatedSignals += 1;
  if (
    management.suppliers.activeBookingInventory > 0 &&
    management.suppliers.confirmationRate !== null &&
    management.suppliers.confirmationRate < 90
  ) {
    anomalies.push({
      id: "booking-confirmation-below-threshold",
      severity:
        management.suppliers.confirmationRate < 70 ? "urgent" : "watch",
      category: "operations",
      headline: "Active-trip confirmation coverage is below 90%",
      explanation: `${management.suppliers.confirmedBookings} of ${management.suppliers.activeBookingInventory} active-trip bookings are confirmed (${management.suppliers.confirmationRate.toFixed(1)}%).`,
      nextStep:
        "Review requested and draft bookings in Suppliers & Finance, then confirm or resolve each service.",
      limitation:
        "Confirmation state does not prove supplier failure, availability, or traveler impact.",
      evidence: [
        {
          metric: "Active-trip booking confirmation",
          value: `${management.suppliers.confirmationRate.toFixed(1)}%`,
          scope: "Current workspace snapshot",
          source: "Suppliers & Finance · Active-trip booking state",
          href: "/finance",
        },
      ],
    });
  }

  evaluatedSignals += 1;
  if (
    management.knowledge.approvedStale > 0 ||
    management.knowledge.openConflicts > 0 ||
    management.knowledge.confirmedConflicts > 0
  ) {
    anomalies.push({
      id: "knowledge-evidence-needs-review",
      severity:
        management.knowledge.confirmedConflicts > 0 ? "urgent" : "watch",
      category: "knowledge",
      headline: "AIOS evidence has freshness or conflict risk",
      explanation: `${management.knowledge.approvedStale} approved sources are stale, ${management.knowledge.openConflicts} conflict signals are open, and ${management.knowledge.confirmedConflicts} conflicts are confirmed.`,
      nextStep:
        "Renew stale sources and resolve factual conflicts before relying on affected knowledge for automation.",
      limitation:
        "These governance states do not identify which business decision, if any, is currently affected.",
      evidence: [
        {
          metric: "Stale / open conflicts / confirmed conflicts",
          value: `${management.knowledge.approvedStale} / ${management.knowledge.openConflicts} / ${management.knowledge.confirmedConflicts}`,
          scope: "Current workspace snapshot",
          source: "Governed Knowledge · Review and conflict state",
          href: "/knowledge",
        },
      ],
    });
  }

  evaluatedSignals += 1;
  const overdueCurrencies = management.finance.currencies.filter(
    (row) => row.overdue > 0,
  );
  for (const exposure of overdueCurrencies) {
    anomalies.push({
      id: `overdue-finance-${exposure.currency}`,
      severity: "urgent",
      category: "finance",
      headline: `Overdue ${exposure.currency} exposure is recorded`,
      explanation: `${exposure.currency} ${exposure.overdue.toFixed(2)} remains overdue across ${exposure.openObligations} open obligations in this currency.`,
      nextStep:
        "Inspect the Finance ledger and verify settlement evidence, owner, and follow-up for overdue obligations.",
      limitation:
        "Recorded obligations and allocations are not bank reconciliation or accounting revenue recognition.",
      evidence: [
        {
          metric: "Overdue exposure",
          value: `${exposure.currency} ${exposure.overdue.toFixed(2)}`,
          scope: "Current workspace snapshot",
          source: "Finance ledger · Open non-void obligations",
          href: "/finance",
        },
      ],
    });
  }

  evaluatedSignals += 1;
  if (portfolio.quality.incompleteDeals > 0) {
    anomalies.push({
      id: "incomplete-open-opportunities",
      severity: "watch",
      category: "quality",
      headline: "Open pipeline evidence is incomplete",
      explanation: `${portfolio.quality.incompleteDeals} of ${portfolio.quality.openDeals} open opportunities are missing at least one owner, value, destination, next step, or expected close date.`,
      nextStep:
        "Open the lead pipeline and complete the missing commercial fields before relying on forecasts or autonomous follow-up.",
      limitation:
        "A record may have multiple missing fields, so field-level counts must not be summed as unique opportunities.",
      evidence: [
        {
          metric: "Incomplete / open opportunities",
          value: `${portfolio.quality.incompleteDeals} / ${portfolio.quality.openDeals}`,
          scope: "Current workspace snapshot",
          source: "Lead pipeline · Required commercial evidence",
          href: "/leads",
        },
      ],
    });
  }

  evaluatedSignals += 1;
  if (managementPeriod.invalidOrMissingEventTimes > 0) {
    anomalies.push({
      id: "invalid-management-event-times",
      severity: "watch",
      category: "quality",
      headline: "Some events cannot enter the period comparison",
      explanation: `${managementPeriod.invalidOrMissingEventTimes} governed events have a missing or invalid comparison timestamp and were excluded from both periods.`,
      nextStep:
        "Inspect the source workspaces and repair missing workflow timestamps before using the period trend for decisions.",
      limitation:
        "AIOS reports the excluded count without exposing or guessing which raw records were affected.",
      evidence: [
        {
          metric: "Excluded event timestamps",
          value: `${managementPeriod.invalidOrMissingEventTimes} events`,
          scope: `${periodScope(managementPeriod.period)} and ${previousPeriodScope(managementPeriod.period)}`,
          source: "Analytics · Governed event timestamp validation",
          href: "/analytics",
        },
      ],
    });
  }

  return {
    engine: "AIOS deterministic evidence rules",
    rulesVersion: "2026-07-29.1",
    anomalies: anomalies
      .sort(
        (left, right) =>
          severityRank[left.severity] - severityRank[right.severity] ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 8),
    evaluatedSignals,
  };
}
