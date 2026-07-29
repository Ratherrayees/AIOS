import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManagementIntelligence,
  buildPortfolioIntelligence,
} from "../lib/analytics/management-intelligence";

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

test("portfolio profitability uses only current quote versions with matching costs", () => {
  const result = buildPortfolioIntelligence({
    quotes: [
      { id: "q1", currency: "INR", status: "draft", current_version: 2 },
      { id: "q2", currency: "INR", status: "shared", current_version: 1 },
      { id: "q3", currency: "USD", status: "accepted", current_version: 1 },
      { id: "q4", currency: "USD", status: "rejected", current_version: 1 },
    ],
    versions: [
      { id: "q1-v1", quote_id: "q1", version: 1, total_amount: 90 },
      { id: "q1-v2", quote_id: "q1", version: 2, total_amount: 120 },
      { id: "q2-v1", quote_id: "q2", version: 1, total_amount: 80 },
      { id: "q3-v1", quote_id: "q3", version: 1, total_amount: 300 },
      { id: "q4-v1", quote_id: "q4", version: 1, total_amount: 1000 },
    ],
    costEstimates: [
      { quote_version_id: "q1-v1", estimated_cost_amount: 30 },
      { quote_version_id: "q1-v2", estimated_cost_amount: 90 },
      { quote_version_id: "q3-v1", estimated_cost_amount: 240 },
      { quote_version_id: "q4-v1", estimated_cost_amount: 1 },
    ],
    deals: [],
    conversations: [],
    trips: [],
    bookings: [],
    suppliers: [],
  });

  assert.deepEqual(result.profitability, {
    currencies: [
      {
        currency: "INR",
        quotedRevenue: 120,
        estimatedCost: 90,
        grossMargin: 30,
        grossMarginPercent: 25,
        costedQuotes: 1,
      },
      {
        currency: "USD",
        quotedRevenue: 300,
        estimatedCost: 240,
        grossMargin: 60,
        grossMarginPercent: 20,
        costedQuotes: 1,
      },
    ],
    currentQuotes: 3,
    costedQuotes: 2,
    missingCostEstimate: 1,
    missingCurrentVersion: 0,
  });
});

test("portfolio quality identifies incomplete work without double-counting records", () => {
  const result = buildPortfolioIntelligence({
    quotes: [],
    versions: [],
    costEstimates: [],
    deals: [
      {
        stage: "proposal",
        owner_id: null,
        value_amount: null,
        destination: "",
        next_step: null,
        expected_close_at: null,
      },
      {
        stage: "qualified",
        owner_id: "owner",
        value_amount: 500,
        destination: "Ladakh",
        next_step: "Review route",
        expected_close_at: "2026-08-20",
      },
      {
        stage: "won",
        owner_id: null,
        value_amount: null,
        destination: null,
        next_step: null,
        expected_close_at: null,
      },
    ],
    conversations: [
      { status: "open", archived_at: null, assignee_id: null },
      { status: "closed", archived_at: null, assignee_id: null },
      { status: "inbox", archived_at: "2026-07-01", assignee_id: null },
    ],
    trips: [
      { id: "active", status: "confirmed", start_date: "2026-08-01" },
      { id: "done", status: "completed", start_date: "2026-07-01" },
    ],
    bookings: [
      {
        trip_id: "active",
        supplier_id: null,
        status: "requested",
        cost_amount: null,
      },
      {
        trip_id: "active",
        supplier_id: null,
        status: "cancelled",
        cost_amount: null,
      },
      {
        trip_id: "done",
        supplier_id: null,
        status: "confirmed",
        cost_amount: null,
      },
    ],
    suppliers: [
      {
        id: "missing-rating",
        status: "active",
        archived_at: null,
        quality_rating: null,
      },
      {
        id: "rated",
        status: "active",
        archived_at: null,
        quality_rating: 4,
      },
    ],
  });

  assert.deepEqual(result.quality, {
    incompleteDeals: 1,
    openDeals: 2,
    missingDealOwner: 1,
    missingDealValue: 1,
    missingDealDestination: 1,
    missingDealNextStep: 1,
    missingDealCloseDate: 1,
    unassignedConversations: 1,
    uncategorizedBookingCosts: 1,
    unratedActiveSuppliers: 1,
  });
});

test("portfolio margin normalizes invalid money without combining currencies", () => {
  const result = buildPortfolioIntelligence({
    quotes: [
      { id: "q1", currency: "EUR", status: "draft", current_version: 1 },
    ],
    versions: [
      {
        id: "q1-v1",
        quote_id: "q1",
        version: 1,
        total_amount: -100,
      },
    ],
    costEstimates: [
      { quote_version_id: "q1-v1", estimated_cost_amount: -50 },
    ],
    deals: [],
    conversations: [],
    trips: [],
    bookings: [],
    suppliers: [],
  });

  assert.deepEqual(result.profitability.currencies, [
    {
      currency: "EUR",
      quotedRevenue: 0,
      estimatedCost: 0,
      grossMargin: 0,
      grossMarginPercent: 0,
      costedQuotes: 1,
    },
  ]);
});
