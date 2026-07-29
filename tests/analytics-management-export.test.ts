import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManagementExportRows,
  createManagementExportCsv,
  managementExportFilename,
  serializeManagementExportCsv,
} from "../lib/analytics/management-export";
import {
  buildGrowthIntelligence,
  buildManagementIntelligence,
  buildPortfolioIntelligence,
} from "../lib/analytics/management-intelligence";
import { buildTargetCoverage } from "../lib/analytics/targets";

const now = new Date("2026-07-29T12:00:00.000Z");
const deal = {
  stage: "proposal",
  contact_id: "contact-private",
  owner_id: "owner-private",
  value_amount: 200_000,
  currency: "INR",
  probability: 50,
  expected_close_at: "2026-08-15",
  won_at: null,
  destination: "private destination",
  next_step: "private next step",
};

function fixture() {
  const management = buildManagementIntelligence({
    trips: [{ id: "trip-private", status: "confirmed", start_date: "2026-08-01" }],
    exceptions: [],
    bookings: [
      {
        trip_id: "trip-private",
        supplier_id: "supplier-private",
        status: "confirmed",
        cost_amount: 75_000,
      },
    ],
    suppliers: [
      {
        id: "supplier-private",
        status: "active",
        archived_at: null,
        quality_rating: 4.5,
      },
    ],
    payments: [
      {
        amount: 100_000,
        paid_amount: 25_000,
        currency: "INR",
        direction: "receivable",
        status: "partially_paid",
      },
    ],
    knowledgeSources: [
      { status: "approved", review_due_on: "2026-12-31" },
    ],
    knowledgeConflicts: [],
    now,
  });
  const portfolio = buildPortfolioIntelligence({
    quotes: [
      { id: "quote-private", currency: "INR", status: "draft", current_version: 1 },
    ],
    versions: [
      {
        id: "version-private",
        quote_id: "quote-private",
        version: 1,
        total_amount: 200_000,
      },
    ],
    costEstimates: [
      { quote_version_id: "version-private", estimated_cost_amount: 150_000 },
    ],
    deals: [deal],
    conversations: [],
    trips: [{ id: "trip-private", status: "confirmed", start_date: "2026-08-01" }],
    bookings: [
      {
        trip_id: "trip-private",
        supplier_id: "supplier-private",
        status: "confirmed",
        cost_amount: 75_000,
      },
    ],
    suppliers: [
      {
        id: "supplier-private",
        status: "active",
        archived_at: null,
        quality_rating: 4.5,
      },
    ],
  });
  const growth = buildGrowthIntelligence([deal], {
    now,
    horizonDays: 90,
  });
  const targetCoverage = buildTargetCoverage(
    [deal],
    [
      {
        id: "target-private",
        label: "=HYPERLINK(\"https://unsafe.example\")",
        currency: "INR",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        target_amount: 1_000_000,
        is_active: true,
      },
    ],
    now,
  );
  return { generatedAt: now, management, portfolio, growth, targetCoverage };
}

test("management export contains currency-safe aggregates and formula provenance", () => {
  const rows = buildManagementExportRows(fixture());
  assert.ok(
    rows.some(
      (row) =>
        row.section === "Forecast" &&
        row.currency === "INR" &&
        row.value === 200_000,
    ),
  );
  assert.ok(
    rows.some(
      (row) =>
        row.section === "Pipeline coverage" &&
        row.metric.includes("2026-07-01 to 2026-09-30") &&
        row.value === 20,
    ),
  );
  assert.ok(
    rows.some(
      (row) =>
        row.section === "Report boundary" &&
        row.metric === "Personal data" &&
        row.value === "Excluded",
    ),
  );
});

test("management export omits raw identifiers, target labels, and customer context", () => {
  const csv = createManagementExportCsv(fixture());
  for (const privateValue of [
    "contact-private",
    "owner-private",
    "trip-private",
    "supplier-private",
    "quote-private",
    "target-private",
    "private destination",
    "private next step",
    "unsafe.example",
  ]) {
    assert.equal(csv.includes(privateValue), false);
  }
});

test("CSV serialization neutralizes spreadsheet formulas and escapes quotes", () => {
  const csv = serializeManagementExportCsv([
    {
      section: "=SUM(1,2)",
      metric: "+cmd",
      currency: "@INR",
      value: "-42",
      unit: "money",
      definition: "A \"quoted\" definition",
    },
  ]);
  assert.match(csv, /"'=SUM\(1,2\)"/);
  assert.match(csv, /"'\+cmd"/);
  assert.match(csv, /"'@INR"/);
  assert.match(csv, /"'-42"/);
  assert.match(csv, /"A ""quoted"" definition"/);
});

test("management export filename is deterministic and contains no tenant identifier", () => {
  assert.equal(
    managementExportFilename(now),
    "aios-management-report-2026-07-29.csv",
  );
});
