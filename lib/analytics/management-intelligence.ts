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

const activeTripStatuses = new Set<ManagementTrip["status"]>([
  "draft",
  "confirmed",
  "in_travel",
]);
const activeExceptionStatuses = new Set(["open", "acknowledged"]);
const urgentSeverities = new Set(["high", "critical"]);
const openPaymentStatuses = new Set(["pending", "partially_paid", "overdue"]);

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
