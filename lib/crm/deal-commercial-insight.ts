export type DealStage =
  | "new"
  | "qualified"
  | "proposal"
  | "decision"
  | "won"
  | "lost";

export type DealCommercialQuote = {
  id: string;
  title: string;
  status: "draft" | "shared" | "accepted" | "rejected" | "expired" | "superseded";
  currency: string;
  currentVersion: number;
  validUntil: string | null;
  acceptedAt: string | null;
  updatedAt: string;
};

export type DealCommercialVersion = {
  id: string;
  quoteId: string;
  version: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
};

export type DealCommercialTerms = {
  quoteVersionId: string;
  estimatedCostAmount: number;
  netSellAmount: number;
  grossMarkupAmount: number;
  grossMarkupPercent: number | null;
  estimatedCommissionAmount: number;
  postCommissionMarginAmount: number;
  postCommissionMarginPercent: number | null;
};

export type DealCommercialAcceptance = {
  id: string;
  quoteId: string;
  quoteVersionId: string;
  acceptedAt: string;
};

export type DealCommercialReceivable = {
  quoteId: string | null;
  quoteVersionId: string | null;
  quoteAcceptanceId: string | null;
  invoiceIssuanceId: string | null;
  direction: string;
  currency: string;
  amount: number;
  paidAmount: number;
  status: string;
};

export type DealCommercialInsightInput = {
  evidenceAvailable: boolean;
  deal: {
    stage: DealStage;
    currency: string;
    valueAmount: number | null;
  };
  quote: DealCommercialQuote | null;
  version: DealCommercialVersion | null;
  terms: DealCommercialTerms | null;
  acceptance: DealCommercialAcceptance | null;
  receivables: DealCommercialReceivable[];
  now: Date;
};

export type CommercialProgressState = "complete" | "current" | "waiting" | "blocked";

export type DealCommercialInsight = {
  available: boolean;
  headline: string;
  summary: string;
  tone: "neutral" | "attention" | "ready" | "closed";
  action: { label: string; detail: string; href: string };
  progress: Array<{
    code: "proposal" | "commitment" | "finance" | "pipeline";
    label: string;
    state: CommercialProgressState;
    detail: string;
  }>;
  economics: null | {
    currency: string;
    customerTotal: number;
    netSell: number;
    tax: number;
    estimatedCost: number | null;
    grossMargin: number | null;
    grossMarginPercent: number | null;
    estimatedCommission: number | null;
    postCommissionMargin: number | null;
    postCommissionMarginPercent: number | null;
  };
  receivables: {
    count: number;
    total: number;
    paid: number;
    allIssued: boolean;
    fullySettled: boolean;
  };
  alerts: string[];
};

const ACTIVE_QUOTE_PRIORITY: Record<DealCommercialQuote["status"], number> = {
  accepted: 0,
  shared: 1,
  draft: 2,
  rejected: 3,
  expired: 4,
  superseded: 5,
};

export function selectPrimaryCommercialQuote(
  quotes: DealCommercialQuote[],
): DealCommercialQuote | null {
  return (
    [...quotes].sort((left, right) => {
      const statusDifference =
        ACTIVE_QUOTE_PRIORITY[left.status] - ACTIVE_QUOTE_PRIORITY[right.status];
      if (statusDifference) return statusDifference;
      return right.updatedAt.localeCompare(left.updatedAt);
    })[0] ?? null
  );
}

function isFiniteAmount(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function percentage(amount: number, base: number) {
  return base > 0 ? (amount / base) * 100 : null;
}

export function buildDealCommercialInsight(
  input: DealCommercialInsightInput,
): DealCommercialInsight {
  const unavailable: DealCommercialInsight = {
    available: false,
    headline: "Commercial evidence is unavailable",
    summary:
      "AIOS could not verify every supporting record, so it has not inferred profitability or progression.",
    tone: "attention",
    action: {
      label: "Reload this opportunity",
      detail: "Use only a complete, tenant-authorized evidence set.",
      href: "#commercial-truth",
    },
    progress: [],
    economics: null,
    receivables: {
      count: 0,
      total: 0,
      paid: 0,
      allIssued: false,
      fullySettled: false,
    },
    alerts: [],
  };

  if (!input.evidenceAvailable) return unavailable;

  const quote = input.quote;
  const version =
    quote &&
    input.version?.quoteId === quote.id &&
    input.version.version === quote.currentVersion
      ? input.version
      : null;
  const acceptance =
    quote &&
    version &&
    input.acceptance?.quoteId === quote.id &&
    input.acceptance.quoteVersionId === version.id
      ? input.acceptance
      : null;
  const exactReceivables =
    quote && version && acceptance
      ? input.receivables.filter(
          (payment) =>
            payment.direction === "receivable" &&
            payment.quoteId === quote.id &&
            payment.quoteVersionId === version.id &&
            payment.quoteAcceptanceId === acceptance.id &&
            payment.currency === quote.currency &&
            isFiniteAmount(payment.amount) &&
            isFiniteAmount(payment.paidAmount),
        )
      : [];
  const receivableTotal = exactReceivables.reduce(
    (total, payment) => total + payment.amount,
    0,
  );
  const paidTotal = exactReceivables.reduce(
    (total, payment) => total + Math.min(payment.paidAmount, payment.amount),
    0,
  );
  const allIssued =
    exactReceivables.length > 0 &&
    exactReceivables.every((payment) => Boolean(payment.invoiceIssuanceId));
  const fullySettled =
    exactReceivables.length > 0 &&
    exactReceivables.every(
      (payment) => payment.status === "paid" && payment.paidAmount >= payment.amount,
    );
  const terms =
    version && input.terms?.quoteVersionId === version.id ? input.terms : null;
  const alerts: string[] = [];

  if (quote && !version) {
    alerts.push("The current quote version could not be verified.");
  }
  if (quote?.validUntil) {
    const expiry = new Date(`${quote.validUntil}T23:59:59.999Z`).getTime();
    if (Number.isFinite(expiry) && expiry < input.now.getTime() && !acceptance) {
      alerts.push("The current quote has passed its validity date without acceptance.");
    }
  }
  if (
    quote &&
    input.deal.currency !== quote.currency &&
    isFiniteAmount(input.deal.valueAmount)
  ) {
    alerts.push(
      "The pipeline value and current quote use different currencies, so they are not compared.",
    );
  } else if (
    version &&
    isFiniteAmount(input.deal.valueAmount) &&
    input.deal.valueAmount !== version.totalAmount
  ) {
    alerts.push(
      "The pipeline estimate differs from the current customer total; review the commercial plan.",
    );
  }
  if (acceptance && input.deal.stage === "lost") {
    alerts.push("An accepted quote is attached to an opportunity marked Lost.");
  }
  if (input.deal.stage === "won" && !acceptance) {
    alerts.push("The opportunity is Won without exact customer-acceptance evidence.");
  }
  if (exactReceivables.length > 0 && version && receivableTotal !== version.totalAmount) {
    alerts.push("Exact receivables do not reconcile to the current customer total.");
  }

  let action: DealCommercialInsight["action"];
  if (!quote) {
    action = {
      label: "Build the first quote",
      detail: "Create customer-safe commercial evidence before forecasting a sale.",
      href: "/quotes",
    };
  } else if (!version) {
    action = {
      label: "Inspect the current quote",
      detail: "Resolve the missing exact-version evidence before relying on totals.",
      href: "/quotes",
    };
  } else if (quote.status === "draft") {
    action = {
      label: "Review the draft quote",
      detail: "Complete policy review and sharing approval when it is customer-ready.",
      href: "/quotes",
    };
  } else if (!acceptance) {
    action = {
      label: "Track the customer decision",
      detail: "The current proposal has no exact-version acceptance evidence yet.",
      href: "/quotes",
    };
  } else if (!exactReceivables.length) {
    action = {
      label: "Create accepted receivables",
      detail: "Finance can materialize the approved payment schedule without charging.",
      href: "/finance",
    };
  } else if (!allIssued) {
    action = {
      label: "Complete governed issuance",
      detail: "The accepted receivables are not all linked to permanent issuance evidence.",
      href: "/finance",
    };
  } else if (input.deal.stage !== "won" && input.deal.stage !== "lost") {
    action = {
      label: "Review the Won transition",
      detail: "Commercial commitment and issuance exist; a human still owns pipeline movement.",
      href: "#commercial-signal",
    };
  } else if (!fullySettled) {
    action = {
      label: "Monitor settlement evidence",
      detail: "Issued receivables remain partially or wholly outstanding.",
      href: "/finance",
    };
  } else {
    action = {
      label: "Commercial trail complete",
      detail: "The exact accepted amount is issued, settled, and linked to a closed pipeline record.",
      href: "/finance",
    };
  }

  const proposalState: CommercialProgressState = version
    ? quote?.status === "draft"
      ? "current"
      : "complete"
    : quote
      ? "blocked"
      : "current";
  const commitmentState: CommercialProgressState = acceptance
    ? "complete"
    : version
      ? "current"
      : "waiting";
  const financeState: CommercialProgressState = allIssued
    ? "complete"
    : exactReceivables.length
      ? "current"
      : acceptance
        ? "current"
        : "waiting";
  const pipelineState: CommercialProgressState =
    input.deal.stage === "won" || input.deal.stage === "lost"
      ? "complete"
      : acceptance
        ? "current"
        : "waiting";

  const economics = version
    ? {
        currency: quote?.currency ?? input.deal.currency,
        customerTotal: version.totalAmount,
        netSell: version.netAmount,
        tax: version.taxAmount,
        estimatedCost: terms?.estimatedCostAmount ?? null,
        grossMargin: terms?.grossMarkupAmount ?? null,
        grossMarginPercent: terms
          ? percentage(terms.grossMarkupAmount, terms.netSellAmount)
          : null,
        estimatedCommission: terms?.estimatedCommissionAmount ?? null,
        postCommissionMargin: terms?.postCommissionMarginAmount ?? null,
        postCommissionMarginPercent:
          terms?.postCommissionMarginPercent ?? null,
      }
    : null;

  const tone: DealCommercialInsight["tone"] =
    input.deal.stage === "lost"
      ? "closed"
      : alerts.length
        ? "attention"
        : allIssued && input.deal.stage === "won"
          ? "ready"
          : "neutral";

  const headline = acceptance
    ? allIssued
      ? "Accepted value is linked through issuance"
      : "Customer commitment is recorded"
    : quote
      ? "A proposal is active, but commitment is open"
      : "Commercial work has not started";

  const summary = acceptance
    ? `${quote?.title ?? "The current proposal"} was accepted on ${new Date(
        acceptance.acceptedAt,
      ).toLocaleDateString("en-IN")}. ${exactReceivables.length} exact receivable${
        exactReceivables.length === 1 ? " is" : "s are"
      } linked.`
    : quote
      ? `${quote.title} is ${quote.status}. This is workflow evidence, not a predicted win probability.`
      : "Create a versioned quote to establish price, tax, cost, margin, and customer-decision evidence.";

  return {
    available: true,
    headline,
    summary,
    tone,
    action,
    progress: [
      {
        code: "proposal",
        label: "Proposal",
        state: proposalState,
        detail: version
          ? `Version ${version.version} · ${quote?.status ?? "verified"}`
          : quote
            ? `Version ${quote.currentVersion} missing`
            : "No quote yet",
      },
      {
        code: "commitment",
        label: "Customer commitment",
        state: commitmentState,
        detail: acceptance
          ? `Accepted ${new Date(acceptance.acceptedAt).toLocaleDateString("en-IN")}`
          : "No exact acceptance",
      },
      {
        code: "finance",
        label: "Finance evidence",
        state: financeState,
        detail: allIssued
          ? `${exactReceivables.length} receivable${exactReceivables.length === 1 ? "" : "s"} issued`
          : exactReceivables.length
            ? `${exactReceivables.length} receivable${exactReceivables.length === 1 ? "" : "s"} awaiting issuance`
            : "No exact receivables",
      },
      {
        code: "pipeline",
        label: "Pipeline decision",
        state: pipelineState,
        detail: input.deal.stage === "won"
          ? "Won · human confirmed"
          : input.deal.stage === "lost"
            ? "Lost · human confirmed"
            : `${input.deal.stage} · human decision open`,
      },
    ],
    economics,
    receivables: {
      count: exactReceivables.length,
      total: receivableTotal,
      paid: paidTotal,
      allIssued,
      fullySettled,
    },
    alerts,
  };
}
