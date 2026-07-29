export type ManagementPeriodPreset = 30 | 90 | 365 | "custom";

export type PeriodDeal = {
  stage: string;
  won_at: string | null;
};

export type PeriodQuote = {
  status: string;
  accepted_at: string | null;
};

export type PeriodTripTransition = {
  to_status: string;
  changed_at: string;
};

export type PeriodException = {
  detected_at: string;
};

export type PeriodPayment = {
  direction: string;
  status: string;
  created_at: string;
};

export type PeriodKnowledgeSource = {
  reviewed_at: string | null;
};

export type ManagementPeriodInput = {
  preset: ManagementPeriodPreset;
  customStart?: string;
  customEnd?: string;
  now?: Date;
  deals: PeriodDeal[];
  quotes: PeriodQuote[];
  tripTransitions: PeriodTripTransition[];
  exceptions: PeriodException[];
  payments: PeriodPayment[];
  knowledgeSources: PeriodKnowledgeSource[];
};

const dayMs = 86_400_000;

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && dateKey(date) === value ? date : null;
}

function resolvePeriod(
  preset: ManagementPeriodPreset,
  customStart: string | undefined,
  customEnd: string | undefined,
  now: Date,
) {
  const today = new Date(`${dateKey(now)}T00:00:00.000Z`);
  let start: Date;
  let end: Date;
  if (preset === "custom") {
    const parsedStart = customStart ? parseDateKey(customStart) : null;
    const parsedEnd = customEnd ? parseDateKey(customEnd) : null;
    if (!parsedStart || !parsedEnd) {
      throw new Error("Choose a real start and end date.");
    }
    start = parsedStart;
    end = parsedEnd;
  } else {
    end = today;
    start = new Date(end.getTime() - (preset - 1) * dayMs);
  }
  if (end.getTime() < start.getTime()) {
    throw new Error("The reporting period cannot end before it starts.");
  }
  const days = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;
  if (days > 366) {
    throw new Error("One management reporting period cannot exceed 366 days.");
  }
  const endExclusive = new Date(end.getTime() + dayMs);
  const previousEndExclusive = start;
  const previousStart = new Date(start.getTime() - days * dayMs);
  return {
    start,
    end,
    endExclusive,
    previousStart,
    previousEndExclusive,
    days,
  };
}

function timestamp(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function countWindow(
  values: (string | null)[],
  start: Date,
  endExclusive: Date,
) {
  const startMs = start.getTime();
  const endMs = endExclusive.getTime();
  return values.filter((value) => {
    const time = timestamp(value);
    return time !== null && time >= startMs && time < endMs;
  }).length;
}

function comparisonRow(
  key: string,
  label: string,
  source: string,
  values: (string | null)[],
  period: ReturnType<typeof resolvePeriod>,
) {
  const current = countWindow(values, period.start, period.endExclusive);
  const previous = countWindow(
    values,
    period.previousStart,
    period.previousEndExclusive,
  );
  return {
    key,
    label,
    source,
    current,
    previous,
    delta: current - previous,
    deltaPercent: previous
      ? ((current - previous) / previous) * 100
      : current
        ? null
        : 0,
  };
}

export function buildManagementPeriodComparison({
  preset,
  customStart,
  customEnd,
  now = new Date(),
  deals,
  quotes,
  tripTransitions,
  exceptions,
  payments,
  knowledgeSources,
}: ManagementPeriodInput) {
  const period = resolvePeriod(preset, customStart, customEnd, now);
  const eventValues = {
    won: deals
      .filter((deal) => deal.stage === "won")
      .map((deal) => deal.won_at),
    accepted: quotes
      .filter((quote) => quote.status === "accepted")
      .map((quote) => quote.accepted_at),
    completed: tripTransitions
      .filter((transition) => transition.to_status === "completed")
      .map((transition) => transition.changed_at),
    exceptions: exceptions.map((exception) => exception.detected_at),
    receivables: payments
      .filter(
        (payment) =>
          payment.status !== "void" && payment.direction === "receivable",
      )
      .map((payment) => payment.created_at),
    payables: payments
      .filter(
        (payment) =>
          payment.status !== "void" && payment.direction === "payable",
      )
      .map((payment) => payment.created_at),
    knowledge: knowledgeSources.map((source) => source.reviewed_at),
  };
  const rows = [
    comparisonRow(
      "won-opportunities",
      "Won opportunities",
      "Lead pipeline · Won timestamp",
      eventValues.won,
      period,
    ),
    comparisonRow(
      "accepted-quotes",
      "Accepted quotes",
      "Quote workspace · Accepted timestamp",
      eventValues.accepted,
      period,
    ),
    comparisonRow(
      "completed-trips",
      "Completed trips",
      "Trip lifecycle · Completed transition",
      eventValues.completed,
      period,
    ),
    comparisonRow(
      "detected-exceptions",
      "Detected operational exceptions",
      "Operations Radar · First detected timestamp",
      eventValues.exceptions,
      period,
    ),
    comparisonRow(
      "recorded-receivables",
      "Receivables recorded",
      "Finance ledger · Created timestamp",
      eventValues.receivables,
      period,
    ),
    comparisonRow(
      "recorded-payables",
      "Payables recorded",
      "Finance ledger · Created timestamp",
      eventValues.payables,
      period,
    ),
    comparisonRow(
      "knowledge-approvals",
      "Knowledge approvals",
      "Governed Knowledge · Human-reviewed timestamp",
      eventValues.knowledge,
      period,
    ),
  ];
  const allValues = Object.values(eventValues).flat();

  return {
    period: {
      start: dateKey(period.start),
      end: dateKey(period.end),
      previousStart: dateKey(period.previousStart),
      previousEnd: dateKey(
        new Date(period.previousEndExclusive.getTime() - dayMs),
      ),
      days: period.days,
    },
    rows,
    invalidOrMissingEventTimes: allValues.filter(
      (value) => timestamp(value) === null,
    ).length,
  };
}
