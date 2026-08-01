export type SalesCopilotQualityRow = {
  total_ai_drafts: number;
  active_ai_drafts: number;
  reviewed_drafts: number;
  review_decisions: number;
  first_pass_approved: number;
  initial_feedback_drafts: number;
  recovered_after_feedback: number;
  current_revision_approved: number;
  current_revision_attention: number;
  approved_decisions: number;
  change_requested_decisions: number;
  rejected_decisions: number;
  latest_reviewed_at: string | null;
};

function boundedCount(value: number, ceiling = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), Math.max(ceiling, 0));
}

function rate(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

/**
 * Normalizes aggregate review metadata into display-safe calibration metrics.
 * Review outcomes describe workflow acceptance only; they are not a measure of
 * conversion, revenue, factual correctness, or causal model quality.
 */
export function summarizeSalesCopilotQuality(
  row: SalesCopilotQualityRow | null,
) {
  if (!row) return null;

  const totalDrafts = boundedCount(row.total_ai_drafts);
  const activeDrafts = boundedCount(row.active_ai_drafts, totalDrafts);
  const reviewedDrafts = boundedCount(row.reviewed_drafts, totalDrafts);
  const reviewDecisions = boundedCount(row.review_decisions);
  const firstPassApproved = boundedCount(
    row.first_pass_approved,
    reviewedDrafts,
  );
  const initialFeedbackDrafts = boundedCount(
    row.initial_feedback_drafts,
    reviewedDrafts,
  );
  const recoveredAfterFeedback = boundedCount(
    row.recovered_after_feedback,
    initialFeedbackDrafts,
  );
  const currentRevisionApproved = boundedCount(
    row.current_revision_approved,
    activeDrafts,
  );
  const currentRevisionAttention = Math.min(
    boundedCount(row.current_revision_attention, activeDrafts),
    Math.max(activeDrafts - currentRevisionApproved, 0),
  );
  const approvedDecisions = boundedCount(
    row.approved_decisions,
    reviewDecisions,
  );
  const changeRequestedDecisions = boundedCount(
    row.change_requested_decisions,
    Math.max(reviewDecisions - approvedDecisions, 0),
  );
  const rejectedDecisions = boundedCount(
    row.rejected_decisions,
    Math.max(
      reviewDecisions - approvedDecisions - changeRequestedDecisions,
      0,
    ),
  );

  const sample =
    reviewedDrafts === 0
      ? { code: "none", label: "No reviewed sample", target: 10 }
      : reviewedDrafts < 10
        ? { code: "emerging", label: "Emerging sample", target: 10 }
        : reviewedDrafts < 30
          ? { code: "directional", label: "Directional sample", target: 30 }
          : { code: "established", label: "Established sample", target: 30 };

  return {
    totalDrafts,
    activeDrafts,
    reviewedDrafts,
    unreviewedDrafts: Math.max(totalDrafts - reviewedDrafts, 0),
    reviewDecisions,
    firstPassApproved,
    firstPassApprovalRate: rate(firstPassApproved, reviewedDrafts),
    initialFeedbackDrafts,
    recoveredAfterFeedback,
    feedbackRecoveryRate: rate(
      recoveredAfterFeedback,
      initialFeedbackDrafts,
    ),
    currentRevisionApproved,
    currentRevisionAttention,
    currentApprovalCoverage: rate(currentRevisionApproved, activeDrafts),
    decisions: {
      approved: approvedDecisions,
      changesRequested: changeRequestedDecisions,
      rejected: rejectedDecisions,
    },
    latestReviewedAt: row.latest_reviewed_at,
    sample,
    boundaries: {
      includesDraftText: false,
      includesFeedbackText: false,
      measuresConversion: false,
      provesModelQuality: false,
    },
  };
}
