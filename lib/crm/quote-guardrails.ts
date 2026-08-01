export type QuoteApprovalPolicy = {
  minimumMarginPercent: number;
  requireCostEstimate: boolean;
  requireValidUntil: boolean;
  maximumValidityDays: number;
};

export type QuoteCommercialEvidence = {
  status: "draft" | "shared" | "accepted" | "rejected" | "expired" | "superseded";
  totalAmount: number | null;
  estimatedCostAmount: number | null;
  validUntil: string | null;
};

export const DEFAULT_QUOTE_APPROVAL_POLICY: QuoteApprovalPolicy = {
  minimumMarginPercent: 15,
  requireCostEstimate: true,
  requireValidUntil: true,
  maximumValidityDays: 45,
};

export type QuoteGuardrailSignal = {
  code: string;
  label: string;
  detail: string;
};

const DAY_MS = 24 * 60 * 60 * 1_000;

function dateStart(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function assessQuoteGuardrails(
  evidence: QuoteCommercialEvidence,
  policy: QuoteApprovalPolicy = DEFAULT_QUOTE_APPROVAL_POLICY,
  now = new Date(),
) {
  const blockers: QuoteGuardrailSignal[] = [];
  const exceptions: QuoteGuardrailSignal[] = [];
  const total = evidence.totalAmount;
  const cost = evidence.estimatedCostAmount;
  const validUntil = dateStart(evidence.validUntil);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const marginPercent =
    total !== null && total > 0 && cost !== null && cost >= 0
      ? Math.round((((total - cost) / total) * 100) * 10) / 10
      : null;

  if (evidence.status !== "draft") {
    blockers.push({
      code: "not_draft",
      label: "Draft state required",
      detail: "Only an internal draft can enter sharing review.",
    });
  }
  if (total === null || !Number.isFinite(total) || total <= 0) {
    blockers.push({
      code: "total_missing",
      label: "Positive quote total required",
      detail: "Add a customer-facing total before review.",
    });
  }
  if (policy.requireCostEstimate && (cost === null || !Number.isFinite(cost))) {
    blockers.push({
      code: "cost_missing",
      label: "Current cost estimate required",
      detail: "The current immutable version needs internal cost evidence.",
    });
  }
  if (policy.requireValidUntil && validUntil === null) {
    blockers.push({
      code: "validity_missing",
      label: "Validity date required",
      detail: "Set when this commercial offer expires.",
    });
  }
  if (validUntil !== null && validUntil < today) {
    blockers.push({
      code: "quote_expired",
      label: "Quote validity has expired",
      detail: "Create a current version before requesting review.",
    });
  }
  if (validUntil !== null && validUntil >= today) {
    const validityDays = Math.round((validUntil - today) / DAY_MS);
    if (validityDays > policy.maximumValidityDays) {
      exceptions.push({
        code: "validity_above_policy",
        label: "Validity exceeds the policy window",
        detail: `${validityDays} days remaining; policy allows ${policy.maximumValidityDays}.`,
      });
    }
  }
  if (marginPercent !== null && marginPercent < policy.minimumMarginPercent) {
    exceptions.push({
      code: "margin_below_floor",
      label: "Margin is below the review floor",
      detail: `${marginPercent.toFixed(1)}% margin; policy floor is ${policy.minimumMarginPercent.toFixed(1)}%.`,
    });
  }

  const status = blockers.length
    ? { code: "incomplete", label: "Incomplete", tone: "blocked" }
    : exceptions.length
      ? { code: "exception_review", label: "Exception review", tone: "attention" }
      : { code: "ready", label: "Ready for human review", tone: "ready" };

  return {
    status,
    blockers,
    exceptions,
    marginPercent,
    canRequestReview: blockers.length === 0,
    policySnapshot: {
      minimum_margin_percent: policy.minimumMarginPercent,
      require_cost_estimate: policy.requireCostEstimate,
      require_valid_until: policy.requireValidUntil,
      maximum_validity_days: policy.maximumValidityDays,
    },
    riskCodes: [...blockers, ...exceptions].map((signal) => signal.code),
    boundaries: {
      externalSharePerformed: false,
      approvalBypassAllowed: false,
    },
  };
}
