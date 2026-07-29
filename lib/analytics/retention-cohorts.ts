export type RetentionCohortDeal = {
  stage: string;
  contact_id: string | null;
  won_at: string | null;
};

type CohortWindow = {
  eligibleCustomers: number;
  returnedCustomers: number;
  returnRate: number | null;
};

type MutableCohort = {
  cohort: string;
  cohortStart: string;
  customers: { firstWinMs: number; secondWinMs: number | null }[];
};

const dayMs = 86_400_000;

function quarterStart(date: Date) {
  const quarterIndex = Math.floor(date.getUTCMonth() / 3);
  return `${date.getUTCFullYear()}-${String(quarterIndex * 3 + 1).padStart(
    2,
    "0",
  )}-01`;
}

function quarterLabel(date: Date) {
  return `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

function buildWindow(
  customers: MutableCohort["customers"],
  nowMs: number,
  days: number,
): CohortWindow {
  const eligible = customers.filter(
    (customer) => customer.firstWinMs + days * dayMs <= nowMs,
  );
  const returnedCustomers = eligible.filter(
    (customer) =>
      customer.secondWinMs !== null &&
      customer.secondWinMs <= customer.firstWinMs + days * dayMs,
  ).length;
  return {
    eligibleCustomers: eligible.length,
    returnedCustomers,
    returnRate: eligible.length
      ? (returnedCustomers / eligible.length) * 100
      : null,
  };
}

export function buildRetentionCohorts(
  deals: RetentionCohortDeal[],
  now = new Date(),
) {
  const nowMs = now.getTime();
  const winsByContact = new Map<string, number[]>();
  let unlinkedWins = 0;
  let missingOrInvalidWinTime = 0;
  let futureWinTime = 0;

  for (const deal of deals) {
    if (deal.stage !== "won") continue;
    if (!deal.contact_id) {
      unlinkedWins += 1;
      continue;
    }
    if (!deal.won_at) {
      missingOrInvalidWinTime += 1;
      continue;
    }
    const wonMs = new Date(deal.won_at).getTime();
    if (!Number.isFinite(wonMs)) {
      missingOrInvalidWinTime += 1;
      continue;
    }
    if (wonMs > nowMs) {
      futureWinTime += 1;
      continue;
    }
    const wins = winsByContact.get(deal.contact_id) ?? [];
    wins.push(wonMs);
    winsByContact.set(deal.contact_id, wins);
  }

  const cohortMap = new Map<string, MutableCohort>();
  for (const wins of winsByContact.values()) {
    wins.sort((left, right) => left - right);
    const firstWin = new Date(wins[0]);
    const cohortStart = quarterStart(firstWin);
    const cohort = cohortMap.get(cohortStart) ?? {
      cohort: quarterLabel(firstWin),
      cohortStart,
      customers: [],
    };
    cohort.customers.push({
      firstWinMs: wins[0],
      secondWinMs: wins.find((wonMs) => wonMs > wins[0]) ?? null,
    });
    cohortMap.set(cohortStart, cohort);
  }

  const cohorts = [...cohortMap.values()]
    .map((cohort) => ({
      cohort: cohort.cohort,
      cohortStart: cohort.cohortStart,
      customers: cohort.customers.length,
      within90Days: buildWindow(cohort.customers, nowMs, 90),
      within180Days: buildWindow(cohort.customers, nowMs, 180),
      within365Days: buildWindow(cohort.customers, nowMs, 365),
    }))
    .sort((left, right) => right.cohortStart.localeCompare(left.cohortStart));

  return {
    cohorts,
    summary: {
      timedCustomers: winsByContact.size,
      unlinkedWins,
      missingOrInvalidWinTime,
      futureWinTime,
    },
  };
}
