import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeSalesCopilotQuality,
  type SalesCopilotQualityRow,
} from "../lib/ai/sales-copilot-quality";

function fixture(
  overrides: Partial<SalesCopilotQualityRow> = {},
): SalesCopilotQualityRow {
  return {
    total_ai_drafts: 20,
    active_ai_drafts: 18,
    reviewed_drafts: 15,
    review_decisions: 21,
    first_pass_approved: 9,
    initial_feedback_drafts: 6,
    recovered_after_feedback: 4,
    current_revision_approved: 13,
    current_revision_attention: 5,
    approved_decisions: 13,
    change_requested_decisions: 6,
    rejected_decisions: 2,
    latest_reviewed_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

test("Sales Copilot quality reports immutable review outcomes as rates", () => {
  const summary = summarizeSalesCopilotQuality(fixture());

  assert.equal(summary?.firstPassApprovalRate, 60);
  assert.equal(summary?.feedbackRecoveryRate, 66.7);
  assert.equal(summary?.currentApprovalCoverage, 72.2);
  assert.equal(summary?.sample.code, "directional");
});

test("Sales Copilot quality preserves the no-conversion and no-content boundary", () => {
  const summary = summarizeSalesCopilotQuality(fixture());

  assert.deepEqual(summary?.boundaries, {
    includesDraftText: false,
    includesFeedbackText: false,
    measuresConversion: false,
    provesModelQuality: false,
  });
});

test("Sales Copilot quality marks a small reviewed set as emerging", () => {
  const summary = summarizeSalesCopilotQuality(
    fixture({
      total_ai_drafts: 1,
      active_ai_drafts: 1,
      reviewed_drafts: 1,
      review_decisions: 2,
      first_pass_approved: 0,
      initial_feedback_drafts: 1,
      recovered_after_feedback: 1,
      current_revision_approved: 1,
      current_revision_attention: 0,
      approved_decisions: 1,
      change_requested_decisions: 1,
      rejected_decisions: 0,
    }),
  );

  assert.equal(summary?.sample.code, "emerging");
  assert.equal(summary?.firstPassApprovalRate, 0);
  assert.equal(summary?.feedbackRecoveryRate, 100);
  assert.equal(summary?.currentApprovalCoverage, 100);
});

test("Sales Copilot quality normalizes impossible aggregate values fail-closed", () => {
  const summary = summarizeSalesCopilotQuality(
    fixture({
      total_ai_drafts: 2,
      active_ai_drafts: 50,
      reviewed_drafts: 20,
      review_decisions: 2,
      first_pass_approved: 30,
      initial_feedback_drafts: -4,
      recovered_after_feedback: 9,
      current_revision_approved: 30,
      current_revision_attention: 30,
      approved_decisions: 50,
      change_requested_decisions: 50,
      rejected_decisions: 50,
    }),
  );

  assert.equal(summary?.totalDrafts, 2);
  assert.equal(summary?.activeDrafts, 2);
  assert.equal(summary?.reviewedDrafts, 2);
  assert.equal(summary?.firstPassApproved, 2);
  assert.equal(summary?.initialFeedbackDrafts, 0);
  assert.equal(summary?.currentRevisionApproved, 2);
  assert.equal(summary?.currentRevisionAttention, 0);
  assert.deepEqual(summary?.decisions, {
    approved: 2,
    changesRequested: 0,
    rejected: 0,
  });
});
