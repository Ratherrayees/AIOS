export type QuoteApprovalPolicy = {
  minimumMarginPercent: number;
  minimumMarkupPercent: number;
  requireCostEstimate: boolean;
  requireValidUntil: boolean;
  maximumValidityDays: number;
  maximumDiscountPercent: number;
  commissionBasis: "net_sell" | "gross_margin";
  commissionPercent: number;
  minimumPostCommissionMarginPercent: number;
  enforceStandardTerms: boolean;
  standardTerms: string[];
};

export type QuoteCommercialEvidence = {
  status: "draft" | "shared" | "accepted" | "rejected" | "expired" | "superseded";
  totalAmount: number | null;
  netAmount?: number | null;
  estimatedCostAmount: number | null;
  validUntil: string | null;
  proposalContentReady: boolean;
  listAmount?: number | null;
  discountAmount?: number | null;
  proposalTerms?: string[];
  commercialTerms?: {
    grossMarkupPercent: number | null;
    commissionBasis: "net_sell" | "gross_margin";
    commissionPercent: number;
    postCommissionMarginPercent: number | null;
  } | null;
};

export const DEFAULT_QUOTE_APPROVAL_POLICY: QuoteApprovalPolicy = {
  minimumMarginPercent: 15,
  minimumMarkupPercent: 0,
  requireCostEstimate: true,
  requireValidUntil: true,
  maximumValidityDays: 45,
  maximumDiscountPercent: 100,
  commissionBasis: "gross_margin",
  commissionPercent: 0,
  minimumPostCommissionMarginPercent: 0,
  enforceStandardTerms: false,
  standardTerms: [],
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
  const marginBase = evidence.netAmount ?? total;
  const cost = evidence.estimatedCostAmount;
  const validUntil = dateStart(evidence.validUntil);
  const listAmount = evidence.listAmount ?? null;
  const discountAmount = evidence.discountAmount ?? null;
  const discountPercent =
    listAmount !== null &&
    listAmount > 0 &&
    discountAmount !== null &&
    Number.isFinite(discountAmount)
      ? Math.round((discountAmount / listAmount) * 1000) / 10
      : 0;
  const normalizeTerms = (terms: string[]) =>
    terms.map((term) => term.trim().toLocaleLowerCase("en")).sort();
  const proposalTerms = normalizeTerms(evidence.proposalTerms ?? []);
  const standardTerms = normalizeTerms(policy.standardTerms);
  const standardTermsMatch =
    !policy.enforceStandardTerms ||
    (proposalTerms.length === standardTerms.length &&
      proposalTerms.every((term, index) => term === standardTerms[index]));
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const marginPercent =
    marginBase !== null && marginBase > 0 && cost !== null && cost >= 0
      ? Math.round((((marginBase - cost) / marginBase) * 100) * 10) / 10
      : null;
  const derivedMarkupPercent =
    marginBase !== null && cost !== null && cost > 0
      ? Math.round((((marginBase - cost) / cost) * 100) * 10) / 10
      : null;
  const markupPercent =
    evidence.commercialTerms?.grossMarkupPercent ?? derivedMarkupPercent;
  const commissionBasis =
    evidence.commercialTerms?.commissionBasis ?? policy.commissionBasis;
  const commissionPercent =
    evidence.commercialTerms?.commissionPercent ?? policy.commissionPercent;
  const derivedCommissionBase =
    marginBase === null || cost === null
      ? null
      : commissionBasis === "net_sell"
        ? marginBase
        : Math.max(marginBase - cost, 0);
  const derivedCommissionAmount =
    derivedCommissionBase === null
      ? null
      : Math.round(
          ((derivedCommissionBase * commissionPercent) / 100) * 100,
        ) / 100;
  const derivedPostCommissionMarginPercent =
    marginBase !== null &&
    marginBase > 0 &&
    cost !== null &&
    derivedCommissionAmount !== null
      ? Math.round(
          (((marginBase - cost - derivedCommissionAmount) / marginBase) * 100) *
            10,
        ) / 10
      : null;
  const postCommissionMarginPercent =
    evidence.commercialTerms?.postCommissionMarginPercent ??
    derivedPostCommissionMarginPercent;
  const commissionPolicyCurrent =
    !evidence.commercialTerms ||
    (commissionBasis === policy.commissionBasis &&
      commissionPercent === policy.commissionPercent);

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
  if (!evidence.proposalContentReady) {
    blockers.push({
      code: "proposal_content_missing",
      label: "Proposal inclusions and terms required",
      detail:
        "Add at least one customer-facing inclusion and one term to the exact current version.",
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
  if (markupPercent !== null && markupPercent < policy.minimumMarkupPercent) {
    exceptions.push({
      code: "markup_below_floor",
      label: "Markup is below the review floor",
      detail: `${markupPercent.toFixed(1)}% markup on cost; policy floor is ${policy.minimumMarkupPercent.toFixed(1)}%.`,
    });
  }
  if (
    postCommissionMarginPercent !== null &&
    postCommissionMarginPercent < policy.minimumPostCommissionMarginPercent
  ) {
    exceptions.push({
      code: "post_commission_margin_below_floor",
      label: "Post-commission margin is below the floor",
      detail: `${postCommissionMarginPercent.toFixed(1)}% after estimated commission; policy floor is ${policy.minimumPostCommissionMarginPercent.toFixed(1)}%.`,
    });
  }
  if (!commissionPolicyCurrent) {
    exceptions.push({
      code: "commission_policy_stale",
      label: "Commission snapshot uses an older policy",
      detail:
        "Create a new immutable quote version to apply the current commission basis and rate.",
    });
  }
  if (discountPercent > policy.maximumDiscountPercent) {
    exceptions.push({
      code: "discount_above_policy",
      label: "Discount exceeds the review threshold",
      detail: `${discountPercent.toFixed(1)}% discount; policy allows ${policy.maximumDiscountPercent.toFixed(1)}%.`,
    });
  }
  if (!standardTermsMatch) {
    exceptions.push({
      code: "non_standard_terms",
      label: "Terms differ from the standard set",
      detail:
        "The exact current customer terms require an explicit exception decision.",
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
    markupPercent,
    commissionBasis,
    commissionPercent,
    postCommissionMarginPercent,
    commissionPolicyCurrent,
    discountPercent,
    standardTermsMatch,
    canRequestReview: blockers.length === 0,
    policySnapshot: {
      minimum_margin_percent: policy.minimumMarginPercent,
      minimum_markup_percent: policy.minimumMarkupPercent,
      require_cost_estimate: policy.requireCostEstimate,
      require_valid_until: policy.requireValidUntil,
      maximum_validity_days: policy.maximumValidityDays,
      maximum_discount_percent: policy.maximumDiscountPercent,
      commission_basis: policy.commissionBasis,
      commission_percent: policy.commissionPercent,
      minimum_post_commission_margin_percent:
        policy.minimumPostCommissionMarginPercent,
      enforce_standard_terms: policy.enforceStandardTerms,
      standard_term_count: policy.standardTerms.length,
    },
    riskCodes: [...blockers, ...exceptions].map((signal) => signal.code),
    boundaries: {
      externalSharePerformed: false,
      approvalBypassAllowed: false,
    },
  };
}
