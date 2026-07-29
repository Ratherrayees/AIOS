import assert from "node:assert/strict";
import test from "node:test";

import { buildRetentionCohorts } from "../lib/analytics/retention-cohorts";

const now = new Date("2026-07-29T12:00:00.000Z");

test("retention cohorts use first-win quarter and mature window denominators", () => {
  const result = buildRetentionCohorts(
    [
      {
        stage: "won",
        contact_id: "returned",
        won_at: "2025-01-01T00:00:00.000Z",
      },
      {
        stage: "won",
        contact_id: "returned",
        won_at: "2025-03-01T00:00:00.000Z",
      },
      {
        stage: "won",
        contact_id: "one-time",
        won_at: "2025-02-01T00:00:00.000Z",
      },
      {
        stage: "won",
        contact_id: "young",
        won_at: "2026-07-01T00:00:00.000Z",
      },
    ],
    now,
  );

  assert.deepEqual(result.cohorts, [
    {
      cohort: "2026 Q3",
      cohortStart: "2026-07-01",
      customers: 1,
      within90Days: {
        eligibleCustomers: 0,
        returnedCustomers: 0,
        returnRate: null,
      },
      within180Days: {
        eligibleCustomers: 0,
        returnedCustomers: 0,
        returnRate: null,
      },
      within365Days: {
        eligibleCustomers: 0,
        returnedCustomers: 0,
        returnRate: null,
      },
    },
    {
      cohort: "2025 Q1",
      cohortStart: "2025-01-01",
      customers: 2,
      within90Days: {
        eligibleCustomers: 2,
        returnedCustomers: 1,
        returnRate: 50,
      },
      within180Days: {
        eligibleCustomers: 2,
        returnedCustomers: 1,
        returnRate: 50,
      },
      within365Days: {
        eligibleCustomers: 2,
        returnedCustomers: 1,
        returnRate: 50,
      },
    },
  ]);
});

test("a return outside a shorter window appears only after its actual horizon", () => {
  const result = buildRetentionCohorts(
    [
      {
        stage: "won",
        contact_id: "late-return",
        won_at: "2025-01-01T00:00:00.000Z",
      },
      {
        stage: "won",
        contact_id: "late-return",
        won_at: "2025-05-01T00:00:00.000Z",
      },
    ],
    now,
  );
  assert.equal(result.cohorts[0].within90Days.returnRate, 0);
  assert.equal(result.cohorts[0].within180Days.returnRate, 100);
  assert.equal(result.cohorts[0].within365Days.returnRate, 100);
});

test("unlinked, missing, invalid, and future wins remain visible but excluded", () => {
  const result = buildRetentionCohorts(
    [
      { stage: "won", contact_id: null, won_at: "2025-01-01T00:00:00.000Z" },
      { stage: "won", contact_id: "missing", won_at: null },
      { stage: "won", contact_id: "invalid", won_at: "not-a-date" },
      {
        stage: "won",
        contact_id: "future",
        won_at: "2027-01-01T00:00:00.000Z",
      },
      {
        stage: "proposal",
        contact_id: "open",
        won_at: "2025-01-01T00:00:00.000Z",
      },
    ],
    now,
  );
  assert.deepEqual(result.cohorts, []);
  assert.deepEqual(result.summary, {
    timedCustomers: 0,
    unlinkedWins: 1,
    missingOrInvalidWinTime: 2,
    futureWinTime: 1,
  });
});
