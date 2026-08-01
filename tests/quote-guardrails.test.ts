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

test("discount and non-standard terms become explicit review exceptions", () => {
  const result = assessQuoteGuardrails(
    {
      status: "draft",
      totalAmount: 504000,
      netAmount: 480000,
      estimatedCostAmount: 370000,
      validUntil: "2026-09-15",
      proposalContentReady: true,
      listAmount: 500000,
      discountAmount: 20000,
      proposalTerms: [
        "Subject to availability",
        "Valid only until quote expiry",
      ],
    },
    {
      ...DEFAULT_QUOTE_APPROVAL_POLICY,
      maximumDiscountPercent: 3,
      enforceStandardTerms: true,
      standardTerms: ["Subject to availability"],
    },
    now,
  );

  assert.equal(result.status.code, "exception_review");
  assert.equal(result.discountPercent, 4);
  assert.equal(result.standardTermsMatch, false);
  assert.deepEqual(result.riskCodes, [
    "discount_above_policy",
    "non_standard_terms",
  ]);
  assert.equal(result.canRequestReview, true);
});

test("standard-term comparison is case-insensitive and order-independent", () => {
  const result = assessQuoteGuardrails(
    {
      status: "draft",
      totalAmount: 100000,
      estimatedCostAmount: 80000,
      validUntil: "2026-08-15",
      proposalContentReady: true,
      proposalTerms: ["SECOND TERM", " subject to availability "],
    },
    {
      ...DEFAULT_QUOTE_APPROVAL_POLICY,
      enforceStandardTerms: true,
      standardTerms: ["Subject to availability", "Second term"],
    },
    now,
  );

  assert.equal(result.standardTermsMatch, true);
  assert.deepEqual(result.riskCodes, []);
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
