import assert from "node:assert/strict";
import test from "node:test";

import { buildManagementPeriodComparison } from "../lib/analytics/management-period";

const emptySources = {
  quotes: [],
  tripTransitions: [],
  exceptions: [],
  payments: [],
  knowledgeSources: [],
};

test("custom management periods compare the immediately preceding equal window", () => {
  const report = buildManagementPeriodComparison({
    preset: "custom",
    customStart: "2026-07-01",
    customEnd: "2026-07-31",
    now: new Date("2026-07-29T12:00:00.000Z"),
    deals: [
      { stage: "won", won_at: "2026-07-01T00:00:00.000Z" },
      { stage: "won", won_at: "2026-07-31T23:59:59.000Z" },
      { stage: "won", won_at: "2026-06-01T00:00:00.000Z" },
      { stage: "won", won_at: "2026-06-30T23:59:59.000Z" },
    ],
    ...emptySources,
  });
  assert.deepEqual(report.period, {
    start: "2026-07-01",
    end: "2026-07-31",
    previousStart: "2026-05-31",
    previousEnd: "2026-06-30",
    days: 31,
  });
  assert.deepEqual(report.rows[0], {
    key: "won-opportunities",
    label: "Won opportunities",
    source: "Lead pipeline · Won timestamp",
    current: 2,
    previous: 2,
    delta: 0,
    deltaPercent: 0,
  });
});

test("period comparisons never mix money and expose new activity without infinity", () => {
  const report = buildManagementPeriodComparison({
    preset: 30,
    now: new Date("2026-07-29T12:00:00.000Z"),
    deals: [],
    ...emptySources,
    payments: [
      {
        direction: "receivable",
        status: "pending",
        created_at: "2026-07-20T00:00:00.000Z",
      },
      {
        direction: "payable",
        status: "pending",
        created_at: "2026-07-21T00:00:00.000Z",
      },
      {
        direction: "payable",
        status: "void",
        created_at: "2026-07-22T00:00:00.000Z",
      },
    ],
  });
  const receivables = report.rows.find(
    (row) => row.key === "recorded-receivables",
  );
  const payables = report.rows.find((row) => row.key === "recorded-payables");
  assert.deepEqual(
    { current: receivables?.current, deltaPercent: receivables?.deltaPercent },
    { current: 1, deltaPercent: null },
  );
  assert.equal(payables?.current, 1);
  assert.equal("amount" in report.rows[0], false);
  assert.equal("currency" in report.rows[0], false);
});

test("management periods reject inverted, invalid, and oversized custom ranges", () => {
  for (const [start, end] of [
    ["2026-07-31", "2026-07-01"],
    ["2026-02-30", "2026-03-01"],
    ["2025-01-01", "2026-07-01"],
  ]) {
    assert.throws(() =>
      buildManagementPeriodComparison({
        preset: "custom",
        customStart: start,
        customEnd: end,
        now: new Date("2026-07-29T12:00:00.000Z"),
        deals: [],
        ...emptySources,
      }),
    );
  }
});

test("missing event timestamps are excluded and counted", () => {
  const report = buildManagementPeriodComparison({
    preset: 90,
    now: new Date("2026-07-29T12:00:00.000Z"),
    deals: [{ stage: "won", won_at: null }],
    ...emptySources,
    quotes: [{ status: "accepted", accepted_at: "not-a-time" }],
  });
  assert.equal(report.invalidOrMissingEventTimes, 2);
  assert.equal(report.rows[0].current, 0);
  assert.equal(report.rows[1].current, 0);
});
