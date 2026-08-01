import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSalesPriorityBrief,
  type SalesPriorityInput,
} from "../lib/crm/sales-priority";

const now = new Date("2026-08-01T12:00:00.000Z");

function fixture(overrides: Partial<SalesPriorityInput> = {}): SalesPriorityInput {
  return {
    deal: {
      stage: "qualified",
      createdAt: "2026-07-31T08:00:00.000Z",
      contactId: "contact-1",
      ownerId: "owner-1",
      destination: "Kyoto, Japan",
      valueAmount: 480000,
      probability: 65,
      nextStep: "Present the refined itinerary",
      expectedCloseAt: "2026-08-31",
      lastActivityAt: "2026-08-01T10:00:00.000Z",
      firstResponseDueAt: "2026-08-01T09:00:00.000Z",
      firstRespondedAt: "2026-08-01T08:45:00.000Z",
      followUpDueAt: "2026-08-02T09:00:00.000Z",
    },
    contact: { email: "traveller@example.com", phone: null },
    qualifications: [{ isRequired: true, isComplete: true }],
    quotes: [{ status: "shared", validUntil: "2026-08-15" }],
    tasks: [{ status: "open", dueAt: "2026-08-02T10:00:00.000Z" }],
    ...overrides,
  };
}

test("priority brief separates strong evidence readiness from urgency", () => {
  const input = fixture();
  input.deal.firstRespondedAt = null;
  const brief = buildSalesPriorityBrief(input, now);

  assert.equal(brief.readinessScore, 89);
  assert.equal(brief.readinessBand, "strong");
  assert.equal(brief.priority.code, "respond_now");
  assert.equal(brief.risks[0]?.code, "first_response_overdue");
  assert.equal(brief.actions[0]?.code, "record_response");
});

test("priority brief cites each fixed evidence category and never claims an AI prediction", () => {
  const brief = buildSalesPriorityBrief(fixture(), now);

  assert.deepEqual(
    brief.evidence.map((item) => [item.code, item.possible]),
    [
      ["customer_context", 20],
      ["commercial_plan", 25],
      ["ownership_timing", 20],
      ["qualification", 20],
      ["proposal", 15],
    ],
  );
  assert.equal(brief.readinessScore, 95);
  assert.equal(brief.priority.code, "ready_to_advance");
  assert.deepEqual(brief.boundaries, {
    isConversionPrediction: false,
    modelCalled: false,
    recordMutated: false,
    externalActionTaken: false,
  });
});

test("priority brief detects stalled advanced-stage work without inventing quote evidence", () => {
  const input = fixture({
    quotes: [],
    tasks: [
      { status: "open", dueAt: "2026-07-30T10:00:00.000Z" },
      { status: "completed", dueAt: "2026-07-29T10:00:00.000Z" },
    ],
  });
  input.deal.stage = "decision";
  input.deal.lastActivityAt = "2026-07-25T10:00:00.000Z";
  const brief = buildSalesPriorityBrief(input, now);

  assert.equal(brief.readinessScore, 85);
  assert.equal(brief.priority.code, "recover_momentum");
  assert.deepEqual(
    brief.risks.map((risk) => risk.code),
    ["tasks_overdue", "stale_activity", "proposal_missing"],
  );
  assert.deepEqual(
    brief.actions.map((action) => action.code),
    ["review_tasks", "refresh_plan", "review_quote"],
  );
});

test("closed opportunities are summarized without proposed autonomous work", () => {
  const input = fixture();
  input.deal.stage = "won";
  const brief = buildSalesPriorityBrief(input, now);

  assert.equal(brief.priority.code, "closed");
  assert.deepEqual(brief.actions, []);
});
