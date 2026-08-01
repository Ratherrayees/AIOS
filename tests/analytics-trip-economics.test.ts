import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompletedTripEconomics,
  type TripEconomicsInput,
} from "../lib/analytics/trip-economics";

function readyFixture(): TripEconomicsInput {
  return {
    trips: [
      {
        id: "trip-1",
        status: "completed",
        quote_id: "quote-1",
        currency: "INR",
      },
    ],
    quotes: [
      {
        id: "quote-1",
        status: "accepted",
        current_version: 2,
        currency: "INR",
      },
    ],
    quoteVersions: [
      { quote_id: "quote-1", version: 1, total_amount: 500_000 },
      { quote_id: "quote-1", version: 2, total_amount: 545_000 },
    ],
    bookings: [
      {
        trip_id: "trip-1",
        status: "confirmed",
        cost_amount: 410_000,
        currency: "INR",
      },
      {
        trip_id: "trip-1",
        status: "cancelled",
        cost_amount: 90_000,
        currency: "INR",
      },
    ],
    payments: [
      {
        trip_id: "trip-1",
        direction: "receivable",
        status: "partially_paid",
        amount: 545_000,
        paid_amount: 300_000,
        currency: "INR",
      },
      {
        trip_id: "trip-1",
        direction: "payable",
        status: "paid",
        amount: 410_000,
        paid_amount: 410_000,
        currency: "INR",
      },
      {
        trip_id: "trip-1",
        direction: "payable",
        status: "void",
        amount: 50_000,
        paid_amount: 0,
        currency: "INR",
      },
    ],
  };
}

test("completed trip economics uses accepted current revenue and confirmed costs", () => {
  const result = buildCompletedTripEconomics(readyFixture());
  assert.deepEqual(result.summary, {
    completedTrips: 1,
    evidenceReadyTrips: 1,
    missingAcceptedQuote: 0,
    missingCurrentQuoteVersion: 0,
    unresolvedBookingEvidence: 0,
    missingConfirmedBookingCosts: 0,
    commercialCurrencyConflicts: 0,
    reconciliationCurrencyConflicts: 0,
  });
  assert.deepEqual(result.currencies, [
    {
      currency: "INR",
      trips: 1,
      contractedRevenue: 545_000,
      netSellRevenue: 545_000,
      confirmedBookingCost: 410_000,
      operatingMargin: 135_000,
      operatingMarginPercent: 24.770642201834864,
      customerReceivables: 545_000,
      customerCollected: 300_000,
      supplierPayables: 410_000,
      supplierSettled: 410_000,
      receivableCoveragePercent: 100,
      payableCoveragePercent: 100,
    },
  ]);
});

test("completed trip economics separates tax-inclusive contract value from net sell margin", () => {
  const fixture = readyFixture();
  fixture.quoteVersions[1].total_amount = 590_000;
  fixture.quoteVersions[1].net_amount = 545_000;
  const result = buildCompletedTripEconomics(fixture);

  assert.equal(result.currencies[0]?.contractedRevenue, 590_000);
  assert.equal(result.currencies[0]?.netSellRevenue, 545_000);
  assert.equal(result.currencies[0]?.operatingMargin, 135_000);
});

test("incomplete completed trips fail closed instead of inflating margin", () => {
  const fixture = readyFixture();
  fixture.trips.push(
    {
      id: "trip-no-quote",
      status: "completed",
      quote_id: null,
      currency: "INR",
    },
    {
      id: "trip-open-booking",
      status: "completed",
      quote_id: "quote-2",
      currency: "INR",
    },
  );
  fixture.quotes.push({
    id: "quote-2",
    status: "accepted",
    current_version: 1,
    currency: "INR",
  });
  fixture.quoteVersions.push({
    quote_id: "quote-2",
    version: 1,
    total_amount: 900_000,
  });
  fixture.bookings.push({
    trip_id: "trip-open-booking",
    status: "requested",
    cost_amount: 1,
    currency: "INR",
  });

  const result = buildCompletedTripEconomics(fixture);
  assert.equal(result.summary.completedTrips, 3);
  assert.equal(result.summary.evidenceReadyTrips, 1);
  assert.equal(result.summary.missingAcceptedQuote, 1);
  assert.equal(result.summary.unresolvedBookingEvidence, 1);
  assert.equal(result.currencies[0].contractedRevenue, 545_000);
});

test("commercial currency conflicts exclude a trip and ledger conflicts stay visible", () => {
  const commercialConflict = readyFixture();
  commercialConflict.bookings[0].currency = "USD";
  const excluded = buildCompletedTripEconomics(commercialConflict);
  assert.equal(excluded.summary.evidenceReadyTrips, 0);
  assert.equal(excluded.summary.commercialCurrencyConflicts, 1);
  assert.deepEqual(excluded.currencies, []);

  const ledgerConflict = readyFixture();
  ledgerConflict.payments.push({
    trip_id: "trip-1",
    direction: "receivable",
    status: "pending",
    amount: 100,
    paid_amount: 0,
    currency: "USD",
  });
  const visible = buildCompletedTripEconomics(ledgerConflict);
  assert.equal(visible.summary.evidenceReadyTrips, 1);
  assert.equal(visible.summary.reconciliationCurrencyConflicts, 1);
  assert.equal(visible.currencies[0].customerReceivables, 545_000);
});

test("draft, confirmed, and in-travel trips never enter completed economics", () => {
  const fixture = readyFixture();
  fixture.trips[0].status = "in_travel";
  const result = buildCompletedTripEconomics(fixture);
  assert.equal(result.summary.completedTrips, 0);
  assert.equal(result.summary.evidenceReadyTrips, 0);
  assert.deepEqual(result.currencies, []);
});
