export type ManagementTrip = {
  id: string;
  status: "draft" | "confirmed" | "in_travel" | "completed" | "cancelled";
  start_date: string | null;
};

export type ManagementException = {
  status: string;
  severity: string;
  due_at: string | null;
  assigned_to: string | null;
};

export type ManagementBooking = {
  trip_id: string;
  supplier_id: string | null;
  status: "draft" | "requested" | "confirmed" | "cancelled" | "failed";
  cost_amount?: number | null;
};

export type ManagementSupplier = {
  id: string;
  status: string;
  archived_at: string | null;
  quality_rating: number | null;
};

export type ManagementPayment = {
  amount: number;
  paid_amount: number;
  currency: string;
  direction: string;
  status: string;
};

export type ManagementKnowledgeSource = {
  status: string;
  review_due_on: string | null;
};

export type ManagementKnowledgeConflict = {
  status: string;
};

export type ManagementIntelligenceInput = {
  trips: ManagementTrip[];
  exceptions: ManagementException[];
  bookings: ManagementBooking[];
  suppliers: ManagementSupplier[];
  payments: ManagementPayment[];
  knowledgeSources: ManagementKnowledgeSource[];
  knowledgeConflicts: ManagementKnowledgeConflict[];
  now?: Date;
};

export type CurrencyExposure = {
  currency: string;
  receivable: number;
  payable: number;
  overdue: number;
  openObligations: number;
};

export type PortfolioQuote = {
  id: string;
  currency: string;
  status: string;
  current_version: number;
};

export type PortfolioQuoteVersion = {
  id: string;
  quote_id: string;
  version: number;
  total_amount: number;
  net_amount?: number | null;
  margin_amount?: number | null;
};

export type PortfolioCostEstimate = {
  quote_version_id: string;
  estimated_cost_amount: number;
};

export type QualityDeal = {
  stage: string;
  owner_id: string | null;
  value_amount: number | null;
  destination: string | null;
  next_step: string | null;
  expected_close_at: string | null;
};

export type QualityConversation = {
  status: string;
  archived_at: string | null;
  assignee_id: string | null;
};

export type PortfolioIntelligenceInput = {
  quotes: PortfolioQuote[];
  versions: PortfolioQuoteVersion[];
  costEstimates: PortfolioCostEstimate[];
  deals: QualityDeal[];
  conversations: QualityConversation[];
  trips: ManagementTrip[];
  bookings: ManagementBooking[];
  suppliers: ManagementSupplier[];
};

export type CurrencyProfitability = {
  currency: string;
  quotedRevenue: number;
  estimatedCost: number;
  grossMargin: number;
  grossMarginPercent: number;
  costedQuotes: number;
};

export type GrowthDeal = {
  stage: string;
  contact_id: string | null;
  value_amount: number | null;
  currency: string;
  probability: number;
  expected_close_at: string | null;
  won_at: string | null;
};

export type CurrencyForecast = {
  currency: string;
  pipelineValue: number;
  weightedForecast: number;
  opportunities: number;
};

const activeTripStatuses = new Set<ManagementTrip["status"]>([
  "draft",
  "confirmed",
  "in_travel",
]);
const activeExceptionStatuses = new Set(["open", "acknowledged"]);
const urgentSeverities = new Set(["high", "critical"]);
const openPaymentStatuses = new Set(["pending", "partially_paid", "overdue"]);
const openDealStages = new Set(["new", "qualified", "proposal", "decision"]);
const currentQuoteStatuses = new Set(["draft", "shared", "accepted"]);

function safeMoney(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function utcDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function buildManagementIntelligence({
  trips,
  exceptions,
  bookings,
  suppliers,
  payments,
  knowledgeSources,
  knowledgeConflicts,
  now = new Date(),
}: ManagementIntelligenceInput) {
  const nowMs = now.getTime();
  const thirtyDaysFromNow = nowMs + 30 * 86_400_000;
  const today = utcDateKey(now);
  const activeTrips = trips.filter((trip) => activeTripStatuses.has(trip.status));
  const activeTripIds = new Set(activeTrips.map((trip) => trip.id));
  const activeExceptions = exceptions.filter((item) =>
    activeExceptionStatuses.has(item.status),
  );
  const activeBookings = bookings.filter(
    (booking) =>
      activeTripIds.has(booking.trip_id) && booking.status !== "cancelled",
  );
  const confirmedBookings = activeBookings.filter(
    (booking) => booking.status === "confirmed",
  );
  const activeSuppliers = suppliers.filter(
    (supplier) => !supplier.archived_at && supplier.status === "active",
  );
  const ratedSuppliers = activeSuppliers.filter(
    (supplier) =>
      supplier.quality_rating !== null &&
      Number.isFinite(supplier.quality_rating),
  );
  const usedSupplierIds = new Set(
    activeBookings.flatMap((booking) =>
      booking.supplier_id ? [booking.supplier_id] : [],
    ),
  );

  const exposureByCurrency = new Map<string, CurrencyExposure>();
  for (const payment of payments) {
    if (!openPaymentStatuses.has(payment.status)) continue;
    const currency = payment.currency.trim().toUpperCase();
    if (!currency) continue;
    const outstanding = Math.max(
      0,
      safeMoney(payment.amount) - safeMoney(payment.paid_amount),
    );
    const current = exposureByCurrency.get(currency) ?? {
      currency,
      receivable: 0,
      payable: 0,
      overdue: 0,
      openObligations: 0,
    };
    if (payment.direction === "receivable") {
      current.receivable += outstanding;
    } else if (payment.direction === "payable") {
      current.payable += outstanding;
    }
    if (payment.status === "overdue") current.overdue += outstanding;
    current.openObligations += 1;
    exposureByCurrency.set(currency, current);
  }

  const approvedSources = knowledgeSources.filter(
    (source) => source.status === "approved",
  );
  const approvedCurrent = approvedSources.filter(
    (source) => source.review_due_on !== null && source.review_due_on >= today,
  ).length;
  const approvedStale = approvedSources.length - approvedCurrent;

  return {
    operations: {
      activeTrips: activeTrips.length,
      inTravelTrips: activeTrips.filter((trip) => trip.status === "in_travel")
        .length,
      departingSoon: activeTrips.filter((trip) => {
        if (trip.status === "in_travel" || !trip.start_date) return false;
        const departureMs = new Date(`${trip.start_date}T00:00:00.000Z`).getTime();
        return departureMs >= nowMs && departureMs <= thirtyDaysFromNow;
      }).length,
      activeExceptions: activeExceptions.length,
      urgentExceptions: activeExceptions.filter((item) =>
        urgentSeverities.has(item.severity),
      ).length,
      overdueExceptions: activeExceptions.filter(
        (item) => item.due_at && new Date(item.due_at).getTime() < nowMs,
      ).length,
      unassignedExceptions: activeExceptions.filter(
        (item) => !item.assigned_to,
      ).length,
    },
    suppliers: {
      activeSuppliers: activeSuppliers.length,
      suppliersInActiveTrips: [...usedSupplierIds].filter((id) =>
        activeSuppliers.some((supplier) => supplier.id === id),
      ).length,
      activeBookingInventory: activeBookings.length,
      confirmedBookings: confirmedBookings.length,
      confirmationRate: activeBookings.length
        ? (confirmedBookings.length / activeBookings.length) * 100
        : null,
      ratedSuppliers: ratedSuppliers.length,
      averageQualityRating: ratedSuppliers.length
        ? ratedSuppliers.reduce(
            (sum, supplier) => sum + supplier.quality_rating!,
            0,
          ) / ratedSuppliers.length
        : null,
    },
    finance: {
      currencies: [...exposureByCurrency.values()].sort((left, right) =>
        left.currency.localeCompare(right.currency),
      ),
      openObligations: [...exposureByCurrency.values()].reduce(
        (sum, row) => sum + row.openObligations,
        0,
      ),
    },
    knowledge: {
      approvedCurrent,
      approvedStale,
      inReview: knowledgeSources.filter((source) => source.status === "in_review")
        .length,
      openConflicts: knowledgeConflicts.filter(
        (conflict) => conflict.status === "open",
      ).length,
      confirmedConflicts: knowledgeConflicts.filter(
        (conflict) => conflict.status === "confirmed",
      ).length,
      freshnessRate: approvedSources.length
        ? (approvedCurrent / approvedSources.length) * 100
        : null,
    },
  };
}

export function buildPortfolioIntelligence({
  quotes,
  versions,
  costEstimates,
  deals,
  conversations,
  trips,
  bookings,
  suppliers,
}: PortfolioIntelligenceInput) {
  const currentQuotes = quotes.filter((quote) =>
    currentQuoteStatuses.has(quote.status),
  );
  const currentVersionByQuote = new Map(
    versions.map((version) => [
      `${version.quote_id}:${version.version}`,
      version,
    ]),
  );
  const costByVersion = new Map(
    costEstimates.map((estimate) => [
      estimate.quote_version_id,
      estimate.estimated_cost_amount,
    ]),
  );
  const profitabilityByCurrency = new Map<string, CurrencyProfitability>();
  let missingCurrentVersion = 0;
  let missingCostEstimate = 0;

  for (const quote of currentQuotes) {
    const version = currentVersionByQuote.get(
      `${quote.id}:${quote.current_version}`,
    );
    if (!version || !Number.isFinite(version.total_amount)) {
      missingCurrentVersion += 1;
      continue;
    }
    const estimate = costByVersion.get(version.id);
    if (estimate === undefined || !Number.isFinite(estimate)) {
      missingCostEstimate += 1;
      continue;
    }
    const currency = quote.currency.trim().toUpperCase();
    if (!currency) continue;
    // Customer totals may include tax. Revenue and margin stay net of tax.
    const quotedRevenue = safeMoney(version.net_amount ?? version.total_amount);
    const estimatedCost = safeMoney(estimate);
    const grossMargin = Number.isFinite(version.margin_amount)
      ? Number(version.margin_amount)
      : quotedRevenue - estimatedCost;
    const current = profitabilityByCurrency.get(currency) ?? {
      currency,
      quotedRevenue: 0,
      estimatedCost: 0,
      grossMargin: 0,
      grossMarginPercent: 0,
      costedQuotes: 0,
    };
    current.quotedRevenue += quotedRevenue;
    current.estimatedCost += estimatedCost;
    current.grossMargin += grossMargin;
    current.costedQuotes += 1;
    profitabilityByCurrency.set(currency, current);
  }

  const profitability = [...profitabilityByCurrency.values()]
    .map((row) => ({
      ...row,
      grossMarginPercent: row.quotedRevenue
        ? (row.grossMargin / row.quotedRevenue) * 100
        : 0,
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
  const openDeals = deals.filter((deal) => openDealStages.has(deal.stage));
  const incompleteDeals = openDeals.filter(
    (deal) =>
      !deal.owner_id ||
      !deal.value_amount ||
      deal.value_amount <= 0 ||
      !deal.destination?.trim() ||
      !deal.next_step?.trim() ||
      !deal.expected_close_at,
  );
  const activeTripIds = new Set(
    trips
      .filter((trip) => activeTripStatuses.has(trip.status))
      .map((trip) => trip.id),
  );

  return {
    profitability: {
      currencies: profitability,
      currentQuotes: currentQuotes.length,
      costedQuotes: profitability.reduce(
        (sum, row) => sum + row.costedQuotes,
        0,
      ),
      missingCostEstimate,
      missingCurrentVersion,
    },
    quality: {
      incompleteDeals: incompleteDeals.length,
      openDeals: openDeals.length,
      missingDealOwner: openDeals.filter((deal) => !deal.owner_id).length,
      missingDealValue: openDeals.filter(
        (deal) => !deal.value_amount || deal.value_amount <= 0,
      ).length,
      missingDealDestination: openDeals.filter(
        (deal) => !deal.destination?.trim(),
      ).length,
      missingDealNextStep: openDeals.filter((deal) => !deal.next_step?.trim())
        .length,
      missingDealCloseDate: openDeals.filter(
        (deal) => !deal.expected_close_at,
      ).length,
      unassignedConversations: conversations.filter(
        (conversation) =>
          !conversation.archived_at &&
          conversation.status !== "closed" &&
          !conversation.assignee_id,
      ).length,
      uncategorizedBookingCosts: bookings.filter(
        (booking) =>
          activeTripIds.has(booking.trip_id) &&
          booking.status !== "cancelled" &&
          booking.cost_amount === null,
      ).length,
      unratedActiveSuppliers: suppliers.filter(
        (supplier) =>
          !supplier.archived_at &&
          supplier.status === "active" &&
          supplier.quality_rating === null,
      ).length,
    },
  };
}

export function buildGrowthIntelligence(
  deals: GrowthDeal[],
  {
    now = new Date(),
    horizonDays = 90,
  }: { now?: Date; horizonDays?: number } = {},
) {
  const boundedHorizon = Number.isFinite(horizonDays)
    ? Math.min(365, Math.max(1, Math.round(horizonDays)))
    : 90;
  const today = utcDateKey(now);
  const horizonDate = utcDateKey(
    new Date(now.getTime() + boundedHorizon * 86_400_000),
  );
  const openDeals = deals.filter((deal) => openDealStages.has(deal.stage));
  const forecastByCurrency = new Map<string, CurrencyForecast>();
  let missingForecastInputs = 0;
  let overdueCloseDates = 0;

  for (const deal of openDeals) {
    if (deal.expected_close_at && deal.expected_close_at < today) {
      overdueCloseDates += 1;
    }
    if (
      !deal.expected_close_at ||
      deal.value_amount === null ||
      deal.value_amount <= 0
    ) {
      missingForecastInputs += 1;
      continue;
    }
    if (
      deal.expected_close_at < today ||
      deal.expected_close_at > horizonDate
    ) {
      continue;
    }
    const currency = deal.currency.trim().toUpperCase();
    if (!currency) continue;
    const value = safeMoney(deal.value_amount);
    const probability = Number.isFinite(deal.probability)
      ? Math.min(100, Math.max(0, deal.probability))
      : 0;
    const current = forecastByCurrency.get(currency) ?? {
      currency,
      pipelineValue: 0,
      weightedForecast: 0,
      opportunities: 0,
    };
    current.pipelineValue += value;
    current.weightedForecast += value * (probability / 100);
    current.opportunities += 1;
    forecastByCurrency.set(currency, current);
  }

  const winsByContact = new Map<string, number>();
  for (const deal of deals) {
    if (deal.stage !== "won" || !deal.contact_id) continue;
    winsByContact.set(
      deal.contact_id,
      (winsByContact.get(deal.contact_id) ?? 0) + 1,
    );
  }
  const wonCustomers = winsByContact.size;
  const repeatCustomers = [...winsByContact.values()].filter(
    (wins) => wins >= 2,
  ).length;
  const repeatWins = [...winsByContact.values()].reduce(
    (sum, wins) => sum + Math.max(0, wins - 1),
    0,
  );

  return {
    forecast: {
      horizonDays: boundedHorizon,
      horizonDate,
      currencies: [...forecastByCurrency.values()].sort((left, right) =>
        left.currency.localeCompare(right.currency),
      ),
      forecastReadyOpportunities: [...forecastByCurrency.values()].reduce(
        (sum, row) => sum + row.opportunities,
        0,
      ),
      missingForecastInputs,
      overdueCloseDates,
      targetCoverage: null as number | null,
    },
    retention: {
      wonCustomers,
      repeatCustomers,
      repeatWins,
      repeatCustomerRate: wonCustomers
        ? (repeatCustomers / wonCustomers) * 100
        : null,
    },
  };
}
