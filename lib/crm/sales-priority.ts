export type SalesPriorityDeal = {
  stage: "new" | "qualified" | "proposal" | "decision" | "won" | "lost";
  createdAt: string;
  contactId: string | null;
  ownerId: string | null;
  destination: string | null;
  valueAmount: number | null;
  probability: number;
  nextStep: string | null;
  expectedCloseAt: string | null;
  lastActivityAt: string | null;
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  followUpDueAt: string | null;
};

export type SalesPriorityContact = {
  email: string | null;
  phone: string | null;
} | null;

export type SalesPriorityQualification = {
  isRequired: boolean;
  isComplete: boolean;
};

export type SalesPriorityQuote = {
  status:
    | "draft"
    | "shared"
    | "accepted"
    | "rejected"
    | "expired"
    | "superseded";
  validUntil: string | null;
};

export type SalesPriorityTask = {
  status: "open" | "in_progress" | "completed" | "cancelled";
  dueAt: string | null;
};

export type SalesPriorityInput = {
  deal: SalesPriorityDeal;
  contact: SalesPriorityContact;
  qualifications: SalesPriorityQualification[];
  quotes: SalesPriorityQuote[];
  tasks: SalesPriorityTask[];
};

export type PrioritySource =
  | "commercial"
  | "owner"
  | "traveller"
  | "qualification"
  | "quotes"
  | "tasks"
  | "activity";

export type SalesPriorityRisk = {
  code: string;
  severity: "critical" | "high" | "watch";
  label: string;
  detail: string;
  source: PrioritySource;
};

export type SalesPriorityAction = {
  code: string;
  label: string;
  reason: string;
  source: PrioritySource;
};

export type SalesReadinessEvidence = {
  code: string;
  label: string;
  earned: number;
  possible: number;
  detail: string;
  source: PrioritySource;
};

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

function hasText(value: string | null) {
  return Boolean(value?.trim());
}

function timestamp(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function dateEndTimestamp(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59.999Z`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function quoteReadiness(quotes: SalesPriorityQuote[]) {
  if (quotes.some((quote) => quote.status === "accepted")) return 15;
  if (quotes.some((quote) => quote.status === "shared")) return 10;
  if (quotes.some((quote) => quote.status === "draft")) return 5;
  return 0;
}

function uniqueActions(actions: SalesPriorityAction[]) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.code)) return false;
    seen.add(action.code);
    return true;
  });
}

/**
 * Produces an explainable operational priority brief from current CRM facts.
 * This is deliberately deterministic: it is not a conversion prediction and
 * does not call a model, mutate a record, contact a traveller, or make a quote.
 */
export function buildSalesPriorityBrief(
  input: SalesPriorityInput,
  now = new Date(),
) {
  const { deal, contact, qualifications, quotes, tasks } = input;
  const nowMs = now.getTime();
  const requiredChecks = qualifications.filter((check) => check.isRequired);
  const completedRequired = requiredChecks.filter(
    (check) => check.isComplete,
  ).length;
  const qualificationEarned = requiredChecks.length
    ? Math.round((completedRequired / requiredChecks.length) * 20)
    : 0;
  const reachable = Boolean(contact?.email || contact?.phone);

  const customerEarned =
    (deal.contactId ? 8 : 0) + (reachable ? 6 : 0) + (hasText(deal.destination) ? 6 : 0);
  const commercialEarned =
    (deal.valueAmount !== null && deal.valueAmount > 0 ? 7 : 0) +
    (deal.probability > 0 ? 4 : 0) +
    (hasText(deal.nextStep) ? 7 : 0) +
    (deal.expectedCloseAt ? 7 : 0);
  const ownershipEarned =
    (deal.ownerId ? 8 : 0) +
    (deal.firstRespondedAt ? 6 : 0) +
    (deal.followUpDueAt ? 6 : 0);
  const proposalEarned = quoteReadiness(quotes);

  const evidence: SalesReadinessEvidence[] = [
    {
      code: "customer_context",
      label: "Traveller context",
      earned: customerEarned,
      possible: 20,
      detail: `${deal.contactId ? "Linked traveller" : "No linked traveller"}; ${reachable ? "reachable channel recorded" : "no reachable channel"}; ${hasText(deal.destination) ? "destination recorded" : "destination missing"}.`,
      source: "traveller",
    },
    {
      code: "commercial_plan",
      label: "Commercial plan",
      earned: commercialEarned,
      possible: 25,
      detail: `${deal.valueAmount !== null && deal.valueAmount > 0 ? "Value" : "No value"}, ${deal.probability > 0 ? "probability" : "no probability"}, ${hasText(deal.nextStep) ? "next step" : "no next step"}, and ${deal.expectedCloseAt ? "close date" : "no close date"}.`,
      source: "commercial",
    },
    {
      code: "ownership_timing",
      label: "Ownership & timing",
      earned: ownershipEarned,
      possible: 20,
      detail: `${deal.ownerId ? "Owner assigned" : "Unassigned"}; ${deal.firstRespondedAt ? "first response recorded" : "first response not recorded"}; ${deal.followUpDueAt ? "follow-up scheduled" : "no follow-up deadline"}.`,
      source: "owner",
    },
    {
      code: "qualification",
      label: "Qualification evidence",
      earned: qualificationEarned,
      possible: 20,
      detail: requiredChecks.length
        ? `${completedRequired} of ${requiredChecks.length} required checks complete.`
        : "No required qualification checklist has been applied.",
      source: "qualification",
    },
    {
      code: "proposal",
      label: "Proposal evidence",
      earned: proposalEarned,
      possible: 15,
      detail: quotes.length
        ? `${quotes.length} linked quote${quotes.length === 1 ? "" : "s"}; strongest state earns ${proposalEarned} points.`
        : "No linked quote exists.",
      source: "quotes",
    },
  ];
  const readinessScore = evidence.reduce((sum, item) => sum + item.earned, 0);

  const risks: SalesPriorityRisk[] = [];
  const firstResponseDue = timestamp(deal.firstResponseDueAt);
  if (!deal.firstRespondedAt && firstResponseDue !== null && firstResponseDue < nowMs) {
    risks.push({
      code: "first_response_overdue",
      severity: "critical",
      label: "First response is overdue",
      detail: "The response SLA has passed without recorded contact.",
      source: "commercial",
    });
  }
  if (!deal.ownerId) {
    risks.push({
      code: "unassigned",
      severity: "high",
      label: "No accountable owner",
      detail: "The opportunity is still in the shared queue.",
      source: "owner",
    });
  }
  const followUpDue = timestamp(deal.followUpDueAt);
  if (followUpDue !== null && followUpDue < nowMs) {
    risks.push({
      code: "follow_up_overdue",
      severity: "high",
      label: "Commercial follow-up is overdue",
      detail: "The planned follow-up deadline has passed.",
      source: "commercial",
    });
  }
  const overdueTasks = tasks.filter((task) => {
    const dueAt = timestamp(task.dueAt);
    return (
      (task.status === "open" || task.status === "in_progress") &&
      dueAt !== null &&
      dueAt < nowMs
    );
  }).length;
  if (overdueTasks > 0) {
    risks.push({
      code: "tasks_overdue",
      severity: "high",
      label: `${overdueTasks} overdue internal follow-up${overdueTasks === 1 ? "" : "s"}`,
      detail: "Open opportunity work is past its due time.",
      source: "tasks",
    });
  }
  const expectedClose = dateEndTimestamp(deal.expectedCloseAt);
  if (expectedClose !== null && expectedClose < nowMs) {
    risks.push({
      code: "close_date_passed",
      severity: "high",
      label: "Expected close date has passed",
      detail: "The commercial plan needs a new date or a stage decision.",
      source: "commercial",
    });
  }
  const activityAt = timestamp(deal.lastActivityAt) ?? timestamp(deal.createdAt);
  if (activityAt !== null && nowMs - activityAt > 72 * HOUR_MS) {
    const inactiveDays = Math.max(3, Math.floor((nowMs - activityAt) / DAY_MS));
    risks.push({
      code: "stale_activity",
      severity: "watch",
      label: `No recorded activity for ${inactiveDays} days`,
      detail: "No newer opportunity activity is available in the timeline.",
      source: "activity",
    });
  }
  if (!hasText(deal.nextStep)) {
    risks.push({
      code: "missing_next_step",
      severity: "watch",
      label: "Next commercial step is missing",
      detail: "The owner has no explicit move to execute.",
      source: "commercial",
    });
  }
  if (requiredChecks.length > 0 && completedRequired < requiredChecks.length) {
    risks.push({
      code: "qualification_incomplete",
      severity: "watch",
      label: "Required qualification is incomplete",
      detail: `${requiredChecks.length - completedRequired} required check${requiredChecks.length - completedRequired === 1 ? " remains" : "s remain"}.`,
      source: "qualification",
    });
  }
  const liveQuote = quotes.some((quote) =>
    quote.status === "draft" || quote.status === "shared" || quote.status === "accepted",
  );
  if ((deal.stage === "proposal" || deal.stage === "decision") && !liveQuote) {
    risks.push({
      code: "proposal_missing",
      severity: "high",
      label: "Advanced stage has no active quote",
      detail: "Proposal evidence is missing for the current pipeline stage.",
      source: "quotes",
    });
  }
  const expiredQuotes = quotes.filter((quote) => {
    const validUntil = dateEndTimestamp(quote.validUntil);
    return quote.status === "expired" || (validUntil !== null && validUntil < nowMs);
  }).length;
  if (expiredQuotes > 0 && !quotes.some((quote) => quote.status === "accepted")) {
    risks.push({
      code: "quote_expired",
      severity: "watch",
      label: `${expiredQuotes} quote${expiredQuotes === 1 ? " is" : "s are"} expired`,
      detail: "Review validity before any sharing request.",
      source: "quotes",
    });
  }

  const proposedActions: SalesPriorityAction[] = [];
  for (const risk of risks) {
    const action =
      risk.code === "first_response_overdue"
        ? { code: "record_response", label: "Record the first response", reason: risk.label, source: "commercial" as const }
        : risk.code === "unassigned"
          ? { code: "assign_owner", label: "Assign an accountable owner", reason: risk.label, source: "owner" as const }
          : risk.code === "follow_up_overdue" || risk.code === "close_date_passed" || risk.code === "missing_next_step" || risk.code === "stale_activity"
            ? { code: "refresh_plan", label: "Refresh the next step and deadline", reason: risk.label, source: "commercial" as const }
            : risk.code === "tasks_overdue"
              ? { code: "review_tasks", label: "Review overdue internal work", reason: risk.label, source: "tasks" as const }
              : risk.code === "qualification_incomplete"
                ? { code: "complete_qualification", label: "Complete required qualification", reason: risk.label, source: "qualification" as const }
                : risk.code === "proposal_missing" || risk.code === "quote_expired"
                  ? { code: "review_quote", label: "Prepare or refresh the quote", reason: risk.label, source: "quotes" as const }
                  : null;
    if (action) proposedActions.push(action);
  }
  if (!reachable) {
    proposedActions.push({
      code: "record_channel",
      label: "Record a reachable traveller channel",
      reason: "No email or phone is recorded.",
      source: "traveller",
    });
  }
  if (requiredChecks.length === 0) {
    proposedActions.push({
      code: "apply_qualification",
      label: "Apply a qualification checklist",
      reason: "No required qualification evidence is being tracked.",
      source: "qualification",
    });
  }
  if (!liveQuote && deal.stage !== "new" && deal.stage !== "qualified") {
    proposedActions.push({
      code: "prepare_quote",
      label: "Prepare an internal quote draft",
      reason: "No active proposal evidence exists.",
      source: "quotes",
    });
  }

  const closed = deal.stage === "won" || deal.stage === "lost";
  const hasCritical = risks.some((risk) => risk.severity === "critical");
  const hasHigh = risks.some((risk) => risk.severity === "high");
  const priority = closed
    ? { code: "closed", label: "Closed record", tone: "closed" }
    : hasCritical
      ? { code: "respond_now", label: "Respond now", tone: "critical" }
      : hasHigh
        ? { code: "recover_momentum", label: "Recover momentum", tone: "attention" }
        : readinessScore >= 70
          ? { code: "ready_to_advance", label: "Ready to advance", tone: "ready" }
          : readinessScore >= 45
            ? { code: "build_evidence", label: "Build the case", tone: "developing" }
            : { code: "qualify_first", label: "Qualify first", tone: "developing" };

  return {
    engine: "AIOS deterministic evidence rules" as const,
    readinessScore,
    readinessBand:
      readinessScore >= 70 ? "strong" : readinessScore >= 45 ? "developing" : "thin",
    priority,
    evidence,
    risks,
    actions: closed ? [] : uniqueActions(proposedActions).slice(0, 3),
    boundaries: {
      isConversionPrediction: false,
      modelCalled: false,
      recordMutated: false,
      externalActionTaken: false,
    },
  };
}
