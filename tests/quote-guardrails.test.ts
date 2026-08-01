import assert from "node:assert/strict";
import test from "node:test";

import {
  assessQuoteGuardrails,
  DEFAULT_QUOTE_APPROVAL_POLICY,
} from "../lib/crm/quote-guardrails";

const now = new Date("2026-08-01T12:00:00.000Z");

test("quote guardrails accept a current costed draft inside policy", () => {
  const result = assessQuoteGuardrails(
    {
      status: "draft",
      totalAmount: 545000,
      estimatedCostAmount: 410000,
      validUntil: "2026-09-15",
      proposalContentReady: true,
    },
    DEFAULT_QUOTE_APPROVAL_POLICY,
    now,
  );

  assert.equal(result.status.code, "ready");
  assert.equal(result.marginPercent, 24.8);
  assert.equal(result.canRequestReview, true);
  assert.deepEqual(result.riskCodes, []);
});

test("quote guardrails block review when required evidence is absent", () => {
  const result = assessQuoteGuardrails(
    {
      status: "draft",
      totalAmount: 0,
      estimatedCostAmount: null,
      validUntil: null,
      proposalContentReady: false,
    },
    DEFAULT_QUOTE_APPROVAL_POLICY,
    now,
  );

  assert.equal(result.status.code, "incomplete");
  assert.deepEqual(result.riskCodes, [
    "total_missing",
    "cost_missing",
    "validity_missing",
    "proposal_content_missing",
  ]);
  assert.equal(result.canRequestReview, false);
});

test("low margin and extended validity remain explicit human-review exceptions", () => {
  const result = assessQuoteGuardrails(
    {
      status: "draft",
      totalAmount: 500000,
      estimatedCostAmount: 460000,
      validUntil: "2026-11-01",
      proposalContentReady: true,
    },
    {
      ...DEFAULT_QUOTE_APPROVAL_POLICY,
      minimumMarginPercent: 20,
      maximumValidityDays: 30,
    },
    now,
  );

  assert.equal(result.status.code, "exception_review");
  assert.equal(result.canRequestReview, true);
  assert.deepEqual(result.riskCodes, [
    "validity_above_policy",
    "margin_below_floor",
  ]);
  assert.deepEqual(result.boundaries, {
    externalSharePerformed: false,
    approvalBypassAllowed: false,
  });
});

test("an expired quote is blocked even when validity is optional", () => {
  const result = assessQuoteGuardrails(
    {
      status: "draft",
      totalAmount: 100000,
      estimatedCostAmount: null,
      validUntil: "2026-07-31",
      proposalContentReady: true,
    },
    {
      ...DEFAULT_QUOTE_APPROVAL_POLICY,
      requireCostEstimate: false,
      requireValidUntil: false,
    },
    now,
  );

  assert.deepEqual(result.riskCodes, ["quote_expired"]);
  assert.equal(result.canRequestReview, false);
});

test("non-draft commercial records cannot re-enter sharing review", () => {
  const result = assessQuoteGuardrails(
    {
      status: "accepted",
      totalAmount: 100000,
      estimatedCostAmount: 80000,
      validUntil: "2026-08-15",
      proposalContentReady: true,
    },
    DEFAULT_QUOTE_APPROVAL_POLICY,
    now,
  );

  assert.equal(result.blockers[0]?.code, "not_draft");
  assert.equal(result.canRequestReview, false);
});
