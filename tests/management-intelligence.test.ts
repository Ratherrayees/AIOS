import assert from "node:assert/strict";
import test from "node:test";

import { buildManagementIntelligence } from "../lib/analytics/management-intelligence";

const now = new Date("2026-07-29T12:00:00.000Z");

test("management intelligence derives live operational and supplier readiness", () => {
  const result = buildManagementIntelligence({
    now,
    trips: [
      { id: "draft", status: "draft", start_date: "2026-08-10" },
      { id: "live", status: "in_travel", start_date: "2026-07-28" },
      { id: "done", status: "completed", start_date: "2026-07-01" },
    ],
    exceptions: [
      {
        status: "open",
        severity: "critical",
        due_at: "2026-07-29T10:00:00.000Z",
        assigned_to: null,
      },
      {
        status: "acknowledged",
        severity: "medium",
        due_at: "2026-07-30T10:00:00.000Z",
        assigned_to: "operator",
      },
      {
        status: "resolved",
        severity: "critical",
        due_at: "2026-07-20T10:00:00.000Z",
        assigned_to: null,
      },
    ],
    bookings: [
      {
        trip_id: "draft",
        supplier_id: "supplier-1",
        status: "confirmed",
      },
      {
        trip_id: "live",
        supplier_id: "supplier-2",
        status: "requested",
      },
      {
        trip_id: "done",
        supplier_id: "supplier-1",
        status: "confirmed",
      },
      {
        trip_id: "draft",
        supplier_id: "supplier-1",
        status: "cancelled",
      },
    ],
    suppliers: [
      {
        id: "supplier-1",
        status: "active",
        archived_at: null,
        quality_rating: 4,
      },
      {
        id: "supplier-2",
        status: "active",
        archived_at: null,
        quality_rating: 5,
      },
      {
        id: "supplier-3",
        status: "inactive",
        archived_at: null,
        quality_rating: 1,
      },
    ],
    payments: [],
    knowledgeSources: [],
    knowledgeConflicts: [],
  });

  assert.deepEqual(result.operations, {
    activeTrips: 2,
    inTravelTrips: 1,
    departingSoon: 1,
    activeExceptions: 2,
    urgentExceptions: 1,
    overdueExceptions: 1,
    unassignedExceptions: 1,
  });
  assert.deepEqual(result.suppliers, {
    activeSuppliers: 2,
    suppliersInActiveTrips: 2,
    activeBookingInventory: 2,
    confirmedBookings: 1,
    confirmationRate: 50,
    ratedSuppliers: 2,
    averageQualityRating: 4.5,
  });
});

test("management finance never combines currencies and ignores settled balances", () => {
  const result = buildManagementIntelligence({
    now,
    trips: [],
    exceptions: [],
    bookings: [],
    suppliers: [],
    payments: [
      {
        amount: 1000,
        paid_amount: 250,
        currency: "usd",
        direction: "receivable",
        status: "partially_paid",
      },
      {
        amount: 400,
        paid_amount: 0,
        currency: "USD",
        direction: "payable",
        status: "overdue",
      },
      {
        amount: 900,
        paid_amount: 900,
        currency: "EUR",
        direction: "receivable",
        status: "paid",
      },
      {
        amount: 800,
        paid_amount: 100,
        currency: "INR",
        direction: "receivable",
        status: "overdue",
      },
    ],
    knowledgeSources: [],
    knowledgeConflicts: [],
  });

  assert.deepEqual(result.finance, {
    currencies: [
      {
        currency: "INR",
        receivable: 700,
        payable: 0,
        overdue: 700,
        openObligations: 1,
      },
      {
        currency: "USD",
        receivable: 750,
        payable: 400,
        overdue: 400,
        openObligations: 2,
      },
    ],
    openObligations: 3,
  });
});

test("knowledge health treats missing or expired review deadlines as stale", () => {
  const result = buildManagementIntelligence({
    now,
    trips: [],
    exceptions: [],
    bookings: [],
    suppliers: [],
    payments: [],
    knowledgeSources: [
      { status: "approved", review_due_on: "2026-07-29" },
      { status: "approved", review_due_on: "2026-07-28" },
      { status: "approved", review_due_on: null },
      { status: "in_review", review_due_on: "2026-09-01" },
      { status: "draft", review_due_on: null },
    ],
    knowledgeConflicts: [
      { status: "open" },
      { status: "confirmed" },
      { status: "dismissed" },
    ],
  });

  assert.deepEqual(
    { ...result.knowledge, freshnessRate: Math.round(result.knowledge.freshnessRate!) },
    {
      approvedCurrent: 1,
      approvedStale: 2,
      inReview: 1,
      openConflicts: 1,
      confirmedConflicts: 1,
      freshnessRate: 33,
    },
  );
});
