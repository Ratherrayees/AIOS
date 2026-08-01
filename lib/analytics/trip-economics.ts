export type EconomicsTrip = {
  id: string;
  status: string;
  quote_id: string | null;
  currency: string;
};

export type EconomicsQuote = {
  id: string;
  status: string;
  current_version: number;
  currency: string;
};

export type EconomicsQuoteVersion = {
  quote_id: string;
  version: number;
  total_amount: number;
  net_amount?: number | null;
};

export type EconomicsBooking = {
  trip_id: string;
  status: string;
  cost_amount: number | null;
  currency: string;
};

export type EconomicsPayment = {
  trip_id: string | null;
  direction: string;
  status: string;
  amount: number;
  paid_amount: number;
  currency: string;
};

export type TripEconomicsInput = {
  trips: EconomicsTrip[];
  quotes: EconomicsQuote[];
  quoteVersions: EconomicsQuoteVersion[];
  bookings: EconomicsBooking[];
  payments: EconomicsPayment[];
};

type CurrencyEconomics = {
  currency: string;
  trips: number;
  contractedRevenue: number;
  netSellRevenue: number;
  confirmedBookingCost: number;
  operatingMargin: number;
  operatingMarginPercent: number;
  customerReceivables: number;
  customerCollected: number;
  supplierPayables: number;
  supplierSettled: number;
  receivableCoveragePercent: number | null;
  payableCoveragePercent: number | null;
};

const unresolvedBookingStatuses = new Set(["draft", "requested"]);
const ignoredBookingStatuses = new Set(["cancelled", "failed"]);

function safeMoney(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizedCurrency(value: string) {
  return value.trim().toUpperCase();
}

export function buildCompletedTripEconomics({
  trips,
  quotes,
  quoteVersions,
  bookings,
  payments,
}: TripEconomicsInput) {
  const completedTrips = trips.filter((trip) => trip.status === "completed");
  const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
  const versionByQuote = new Map(
    quoteVersions.map((version) => [
      `${version.quote_id}:${version.version}`,
      version,
    ]),
  );
  const bookingsByTrip = new Map<string, EconomicsBooking[]>();
  for (const booking of bookings) {
    const current = bookingsByTrip.get(booking.trip_id) ?? [];
    current.push(booking);
    bookingsByTrip.set(booking.trip_id, current);
  }
  const paymentsByTrip = new Map<string, EconomicsPayment[]>();
  for (const payment of payments) {
    if (!payment.trip_id || payment.status === "void") continue;
    const current = paymentsByTrip.get(payment.trip_id) ?? [];
    current.push(payment);
    paymentsByTrip.set(payment.trip_id, current);
  }

  const byCurrency = new Map<string, CurrencyEconomics>();
  let missingAcceptedQuote = 0;
  let missingCurrentQuoteVersion = 0;
  let unresolvedBookingEvidence = 0;
  let missingConfirmedBookingCosts = 0;
  let commercialCurrencyConflicts = 0;
  let reconciliationCurrencyConflicts = 0;
  let evidenceReadyTrips = 0;

  for (const trip of completedTrips) {
    const quote = trip.quote_id ? quoteById.get(trip.quote_id) : undefined;
    if (!quote || quote.status !== "accepted") {
      missingAcceptedQuote += 1;
      continue;
    }
    const version = versionByQuote.get(`${quote.id}:${quote.current_version}`);
    if (!version || !Number.isFinite(version.total_amount)) {
      missingCurrentQuoteVersion += 1;
      continue;
    }
    const tripCurrency = normalizedCurrency(trip.currency);
    const quoteCurrency = normalizedCurrency(quote.currency);
    if (!tripCurrency || tripCurrency !== quoteCurrency) {
      commercialCurrencyConflicts += 1;
      continue;
    }

    const tripBookings = bookingsByTrip.get(trip.id) ?? [];
    if (
      tripBookings.some((booking) =>
        unresolvedBookingStatuses.has(booking.status),
      )
    ) {
      unresolvedBookingEvidence += 1;
      continue;
    }
    const confirmedBookings = tripBookings.filter(
      (booking) =>
        booking.status === "confirmed" &&
        !ignoredBookingStatuses.has(booking.status),
    );
    if (
      !confirmedBookings.length ||
      confirmedBookings.some(
        (booking) =>
          booking.cost_amount === null || !Number.isFinite(booking.cost_amount),
      )
    ) {
      missingConfirmedBookingCosts += 1;
      continue;
    }
    if (
      confirmedBookings.some(
        (booking) => normalizedCurrency(booking.currency) !== quoteCurrency,
      )
    ) {
      commercialCurrencyConflicts += 1;
      continue;
    }

    evidenceReadyTrips += 1;
    // Taxes collected from the traveler are not operating revenue.
    const contractedRevenue = safeMoney(version.total_amount);
    const netSellRevenue = safeMoney(
      version.net_amount ?? version.total_amount,
    );
    const confirmedBookingCost = confirmedBookings.reduce(
      (sum, booking) => sum + safeMoney(booking.cost_amount!),
      0,
    );
    const tripPayments = paymentsByTrip.get(trip.id) ?? [];
    const matchingPayments = tripPayments.filter((payment) => {
      const matches =
        normalizedCurrency(payment.currency) === quoteCurrency &&
        (payment.direction === "receivable" ||
          payment.direction === "payable");
      if (!matches) reconciliationCurrencyConflicts += 1;
      return matches;
    });
    const customerReceivables = matchingPayments
      .filter((payment) => payment.direction === "receivable")
      .reduce((sum, payment) => sum + safeMoney(payment.amount), 0);
    const customerCollected = matchingPayments
      .filter((payment) => payment.direction === "receivable")
      .reduce(
        (sum, payment) =>
          sum + Math.min(safeMoney(payment.amount), safeMoney(payment.paid_amount)),
        0,
      );
    const supplierPayables = matchingPayments
      .filter((payment) => payment.direction === "payable")
      .reduce((sum, payment) => sum + safeMoney(payment.amount), 0);
    const supplierSettled = matchingPayments
      .filter((payment) => payment.direction === "payable")
      .reduce(
        (sum, payment) =>
          sum + Math.min(safeMoney(payment.amount), safeMoney(payment.paid_amount)),
        0,
      );
    const current = byCurrency.get(quoteCurrency) ?? {
      currency: quoteCurrency,
      trips: 0,
      contractedRevenue: 0,
      netSellRevenue: 0,
      confirmedBookingCost: 0,
      operatingMargin: 0,
      operatingMarginPercent: 0,
      customerReceivables: 0,
      customerCollected: 0,
      supplierPayables: 0,
      supplierSettled: 0,
      receivableCoveragePercent: null,
      payableCoveragePercent: null,
    };
    current.trips += 1;
    current.contractedRevenue += contractedRevenue;
    current.netSellRevenue += netSellRevenue;
    current.confirmedBookingCost += confirmedBookingCost;
    current.customerReceivables += customerReceivables;
    current.customerCollected += customerCollected;
    current.supplierPayables += supplierPayables;
    current.supplierSettled += supplierSettled;
    byCurrency.set(quoteCurrency, current);
  }

  const currencies = [...byCurrency.values()]
    .map((value) => {
      const operatingMargin =
        value.netSellRevenue - value.confirmedBookingCost;
      return {
        ...value,
        operatingMargin,
        operatingMarginPercent: value.netSellRevenue
          ? (operatingMargin / value.netSellRevenue) * 100
          : 0,
        receivableCoveragePercent: value.contractedRevenue
          ? (value.customerReceivables / value.contractedRevenue) * 100
          : null,
        payableCoveragePercent: value.confirmedBookingCost
          ? (value.supplierPayables / value.confirmedBookingCost) * 100
          : null,
      };
    })
    .sort((left, right) => left.currency.localeCompare(right.currency));

  return {
    summary: {
      completedTrips: completedTrips.length,
      evidenceReadyTrips,
      missingAcceptedQuote,
      missingCurrentQuoteVersion,
      unresolvedBookingEvidence,
      missingConfirmedBookingCosts,
      commercialCurrencyConflicts,
      reconciliationCurrencyConflicts,
    },
    currencies,
  };
}
