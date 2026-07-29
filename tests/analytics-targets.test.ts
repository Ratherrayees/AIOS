import assert from "node:assert/strict";
import test from "node:test";

import {
  analyticsTargetSchema,
  buildTargetCoverage,
} from "../lib/analytics/targets";

const organizationId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-07-29T12:00:00.000Z");

test("analytics targets normalize currency and enforce bounded real periods", () => {
  const parsed = analyticsTargetSchema.parse({
    organizationId,
    targetId: null,
    label: "Q3 growth",
    currency: " inr ",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    targetAmount: 1_000_000,
    isActive: true,
  });
  assert.equal(parsed.currency, "INR");
  assert.throws(() =>
    analyticsTargetSchema.parse({
      ...parsed,
      periodStart: "2026-02-30",
    }),
  );
  assert.throws(() =>
    analyticsTargetSchema.parse({
      ...parsed,
      periodEnd: "2027-12-31",
    }),
  );
});

test("target coverage matches currency and exact approved period", () => {
  const coverage = buildTargetCoverage(
    [
      {
        stage: "proposal",
        contact_id: "c1",
        value_amount: 600,
        currency: "INR",
        probability: 50,
        expected_close_at: "2026-08-15",
        won_at: null,
      },
      {
        stage: "decision",
        contact_id: "c2",
        value_amount: 400,
        currency: "INR",
        probability: 75,
        expected_close_at: "2026-10-01",
        won_at: null,
      },
      {
        stage: "qualified",
        contact_id: "c3",
        value_amount: 300,
        currency: "USD",
        probability: 100,
        expected_close_at: "2026-08-20",
        won_at: null,
      },
      {
        stage: "won",
        contact_id: "c4",
        value_amount: 5000,
        currency: "INR",
        probability: 100,
        expected_close_at: "2026-08-10",
        won_at: "2026-07-01T00:00:00.000Z",
      },
    ],
    [
      {
        id: "target",
        label: "Q3 INR",
        currency: "INR",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        target_amount: 1200,
        is_active: true,
      },
    ],
    now,
  );

  assert.deepEqual(coverage, [
    {
      id: "target",
      label: "Q3 INR",
      currency: "INR",
      period_start: "2026-07-01",
      period_end: "2026-09-30",
      target_amount: 1200,
      is_active: true,
      pipelineValue: 600,
      weightedForecast: 300,
      opportunities: 1,
      pipelineCoveragePercent: 50,
      weightedCoveragePercent: 25,
    },
  ]);
});

test("coverage excludes retired and expired targets", () => {
  const coverage = buildTargetCoverage(
    [],
    [
      {
        id: "retired",
        label: "Retired",
        currency: "INR",
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        target_amount: 100,
        is_active: false,
      },
      {
        id: "expired",
        label: "Expired",
        currency: "INR",
        period_start: "2026-06-01",
        period_end: "2026-06-30",
        target_amount: 100,
        is_active: true,
      },
    ],
    now,
  );
  assert.deepEqual(coverage, []);
});
