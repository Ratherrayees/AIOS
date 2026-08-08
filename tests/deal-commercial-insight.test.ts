import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDealCommercialInsight,
  selectPrimaryCommercialQuote,
  type DealCommercialInsightInput,
} from "../lib/crm/deal-commercial-insight";

const now = new Date("2026-08-08T12:00:00.000Z");

function fixture(
  overrides: Partial<DealCommercialInsightInput> = {},
): DealCommercialInsightInput {
  return {
    evidenceAvailable: true,
    deal: { stage: "decision", currency: "INR", valueAmount: 118000 },
    quote: {
      id: "quote-1",
      title: "Himalayan family journey",
      status: "accepted",
      currency: "INR",
      currentVersion: 2,
      validUntil: "2026-08-20",
      acceptedAt: "2026-08-07T09:00:00.000Z",
      updatedAt: "2026-08-07T09:00:00.000Z",
    },
    version: {
      id: "version-2",
      quoteId: "quote-1",
      version: 2,
      netAmount: 100000,
      taxAmount: 18000,
      totalAmount: 118000,
    },
    terms: {
      quoteVersionId: "version-2",
      estimatedCostAmount: 70000,
      netSellAmount: 100000,
      grossMarkupAmount: 30000,
      grossMarkupPercent: 42.8571,
      estimatedCommissionAmount: 3000,
      postCommissionMarginAmount: 27000,
      postCommissionMarginPercent: 27,
    },
    acceptance: {
      id: "acceptance-1",
      quoteId: "quote-1",
      quoteVersionId: "version-2",
      acceptedAt: "2026-08-07T09:00:00.000Z",
    },
    receivables: [
      {
        quoteId: "quote-1",
        quoteVersionId: "version-2",
        quoteAcceptanceId: "acceptance-1",
        invoiceIssuanceId: "issuance-1",
        direction: "receivable",
        currency: "INR",
        amount: 40000,
        paidAmount: 40000,
        status: "paid",
      },
      {
        quoteId: "quote-1",
        quoteVersionId: "version-2",
        quoteAcceptanceId: "acceptance-1",
        invoiceIssuanceId: "issuance-1",
        direction: "receivable",
        currency: "INR",
        amount: 78000,
        paidAmount: 0,
        status: "pending",
      },
    ],
    now,
    ...overrides,
  };
}

test("commercial insight traces exact accepted evidence through issuance", () => {
  const result = buildDealCommercialInsight(fixture());

  assert.equal(result.available, true);
  assert.equal(result.headline, "Accepted value is linked through issuance");
  assert.equal(result.receivables.total, 118000);
  assert.equal(result.receivables.paid, 40000);
  assert.equal(result.receivables.allIssued, true);
  assert.equal(result.receivables.fullySettled, false);
  assert.equal(result.economics?.grossMargin, 30000);
  assert.equal(result.economics?.postCommissionMarginPercent, 27);
  assert.equal(result.action.label, "Review the Won transition");
  assert.deepEqual(
    result.progress.map((step) => step.state),
    ["complete", "complete", "complete", "current"],
  );
});

test("commercial insight recommends the first concrete missing step", () => {
  const result = buildDealCommercialInsight(
    fixture({
      quote: null,
      version: null,
      terms: null,
      acceptance: null,
      receivables: [],
    }),
  );

  assert.equal(result.headline, "Commercial work has not started");
  assert.equal(result.action.label, "Build the first quote");
  assert.equal(result.progress[0]?.state, "current");
  assert.equal(result.economics, null);
});

test("commercial insight fails closed when supporting reads fail", () => {
  const result = buildDealCommercialInsight(
    fixture({ evidenceAvailable: false }),
  );

  assert.equal(result.available, false);
  assert.equal(result.progress.length, 0);
  assert.equal(result.economics, null);
  assert.equal(result.receivables.total, 0);
});

test("commercial insight excludes unrelated and malformed receivables", () => {
  const input = fixture();
  input.receivables.push(
    {
      ...input.receivables[0]!,
      quoteVersionId: "foreign-version",
      amount: 999999,
    },
    {
      ...input.receivables[0]!,
      amount: Number.NaN,
    },
  );

  const result = buildDealCommercialInsight(input);
  assert.equal(result.receivables.count, 2);
  assert.equal(result.receivables.total, 118000);
});

test("commercial insight flags stale, mismatched, and contradictory evidence", () => {
  const input = fixture({
    deal: { stage: "lost", currency: "USD", valueAmount: 2000 },
  });
  input.quote = { ...input.quote!, validUntil: "2026-08-01" };
  input.receivables[1] = {
    ...input.receivables[1]!,
    amount: 77000,
  };

  const result = buildDealCommercialInsight(input);
  assert.equal(result.tone, "closed");
  assert.ok(result.alerts.some((alert) => /different currencies/i.test(alert)));
  assert.ok(result.alerts.some((alert) => /marked Lost/i.test(alert)));
  assert.ok(result.alerts.some((alert) => /do not reconcile/i.test(alert)));
});

test("primary quote selection prefers accepted evidence then recency", () => {
  const selected = selectPrimaryCommercialQuote([
    {
      ...fixture().quote!,
      id: "new-draft",
      status: "draft",
      updatedAt: "2026-08-08T10:00:00.000Z",
    },
    {
      ...fixture().quote!,
      id: "older-accepted",
      status: "accepted",
      updatedAt: "2026-08-07T10:00:00.000Z",
    },
  ]);

  assert.equal(selected?.id, "older-accepted");
});
