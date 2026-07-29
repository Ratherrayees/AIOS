import assert from "node:assert/strict";
import test from "node:test";

import { buildManagementAnomalyDesk } from "../lib/analytics/management-anomalies";
import {
  buildManagementIntelligence,
  buildPortfolioIntelligence,
} from "../lib/analytics/management-intelligence";
import { buildManagementPeriodComparison } from "../lib/analytics/management-period";

function fixture() {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const management = buildManagementIntelligence({
    trips: [{ id: "trip-1", status: "confirmed", start_date: "2026-08-01" }],
    exceptions: [
      {
        status: "open",
        severity: "critical",
        due_at: "2026-07-20T00:00:00.000Z",
        assigned_to: null,
      },
    ],
    bookings: [
      {
        trip_id: "trip-1",
        supplier_id: null,
        status: "requested",
        cost_amount: null,
      },
    ],
    suppliers: [],
    payments: [
      {
        amount: 1000,
        paid_amount: 200,
        currency: "INR",
        direction: "receivable",
        status: "overdue",
      },
    ],
    knowledgeSources: [
      { status: "approved", review_due_on: "2026-07-01" },
    ],
    knowledgeConflicts: [{ status: "confirmed" }],
    now,
  });
  const portfolio = buildPortfolioIntelligence({
    quotes: [],
    versions: [],
    costEstimates: [],
    deals: [
      {
        stage: "proposal",
        owner_id: null,
        value_amount: null,
        destination: null,
        next_step: null,
        expected_close_at: null,
      },
    ],
    conversations: [],
    trips: [{ id: "trip-1", status: "confirmed", start_date: "2026-08-01" }],
    bookings: [
      {
        trip_id: "trip-1",
        supplier_id: null,
        status: "requested",
        cost_amount: null,
      },
    ],
    suppliers: [],
  });
  const managementPeriod = buildManagementPeriodComparison({
    preset: 30,
    now,
    deals: [
      ...Array.from({ length: 4 }, (_, index) => ({
        stage: "won",
        won_at: `2026-06-${String(index + 10).padStart(2, "0")}T00:00:00.000Z`,
      })),
      { stage: "won", won_at: "2026-07-20T00:00:00.000Z" },
    ],
    quotes: [],
    tripTransitions: [],
    exceptions: [
      { detected_at: "2026-07-18T00:00:00.000Z" },
      { detected_at: "2026-07-19T00:00:00.000Z" },
      { detected_at: "2026-07-20T00:00:00.000Z" },
      { detected_at: "2026-06-20T00:00:00.000Z" },
    ],
    payments: [],
    knowledgeSources: [{ reviewed_at: null }],
  });
  return { management, portfolio, managementPeriod };
}

test("AIOS anomaly explanations cite exact current and baseline evidence", () => {
  const desk = buildManagementAnomalyDesk(fixture());
  const exceptionChange = desk.anomalies.find(
    (item) => item.id === "operational-exceptions-increased",
  );
  assert.ok(exceptionChange);
  assert.equal(exceptionChange.severity, "urgent");
  assert.deepEqual(
    exceptionChange.evidence.map((item) => item.value),
    ["3 events", "1 events"],
  );
  assert.deepEqual(
    exceptionChange.evidence.map((item) => item.scope),
    ["2026-06-30 to 2026-07-29", "2026-05-31 to 2026-06-29"],
  );
  assert.match(exceptionChange.limitation, /not its cause/i);
});

test("AIOS surfaces point-in-time risk without making causal claims", () => {
  const desk = buildManagementAnomalyDesk(fixture());
  assert.equal(desk.engine, "AIOS deterministic evidence rules");
  assert.ok(
    desk.anomalies.some((item) => item.id === "urgent-open-exceptions"),
  );
  assert.ok(
    desk.anomalies.some(
      (item) => item.id === "booking-confirmation-below-threshold",
    ),
  );
  assert.ok(
    desk.anomalies.some((item) => item.id === "overdue-finance-INR"),
  );
  assert.ok(
    desk.anomalies.every(
      (item) =>
        item.evidence.length > 0 &&
        item.evidence.every(
          (evidence) =>
            evidence.metric &&
            evidence.value &&
            evidence.scope &&
            evidence.source &&
            evidence.href.startsWith("/"),
        ),
    ),
  );
});

test("AIOS returns a clean desk when no material signal is present", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const management = buildManagementIntelligence({
    trips: [],
    exceptions: [],
    bookings: [],
    suppliers: [],
    payments: [],
    knowledgeSources: [],
    knowledgeConflicts: [],
    now,
  });
  const portfolio = buildPortfolioIntelligence({
    quotes: [],
    versions: [],
    costEstimates: [],
    deals: [],
    conversations: [],
    trips: [],
    bookings: [],
    suppliers: [],
  });
  const managementPeriod = buildManagementPeriodComparison({
    preset: 30,
    now,
    deals: [],
    quotes: [],
    tripTransitions: [],
    exceptions: [],
    payments: [],
    knowledgeSources: [],
  });
  const desk = buildManagementAnomalyDesk({
    management,
    portfolio,
    managementPeriod,
  });
  assert.deepEqual(desk.anomalies, []);
  assert.equal(desk.evaluatedSignals, 13);
});

test("financial anomaly evidence stays isolated by currency", () => {
  const input = fixture();
  input.management.finance.currencies.push({
    currency: "USD",
    receivable: 0,
    payable: 100,
    overdue: 100,
    openObligations: 1,
  });
  const desk = buildManagementAnomalyDesk(input);
  const financialSignals = desk.anomalies.filter(
    (item) => item.category === "finance" && item.id.startsWith("overdue-finance-"),
  );
  assert.deepEqual(
    financialSignals.map((item) => item.id).sort(),
    ["overdue-finance-INR", "overdue-finance-USD"],
  );
  assert.equal(
    financialSignals.some((item) =>
      item.evidence.some(
        (evidence) =>
          evidence.value.includes("INR") && evidence.value.includes("USD"),
      ),
    ),
    false,
  );
});
