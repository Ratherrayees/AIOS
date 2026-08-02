import assert from "node:assert/strict";
import test from "node:test";

import {
  assessQuoteInvoiceReadiness,
  parseQuotePaymentScheduleItems,
  quotePaymentScheduleItemsSchema,
} from "../lib/crm/quote-payment-schedule";

const validItems = [
  {
    kind: "deposit" as const,
    label: "Booking deposit",
    amount: 151200,
    dueDate: "2026-08-01",
  },
  {
    kind: "balance" as const,
    label: "Final balance",
    amount: 352800,
    dueDate: "2026-08-31",
  },
];

test("payment schedules accept ordered deposit and final balance milestones", () => {
  const parsed = quotePaymentScheduleItemsSchema.parse(validItems);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1]?.kind, "balance");
});

test("payment schedules reject duplicate labels and backwards due dates", () => {
  const parsed = quotePaymentScheduleItemsSchema.safeParse([
    validItems[0],
    {
      kind: "balance",
      label: " booking deposit ",
      amount: 352800,
      dueDate: "2026-07-31",
    },
  ]);
  assert.equal(parsed.success, false);
  assert.match(
    parsed.error?.issues.map((issue) => issue.message).join(" ") ?? "",
    /unique|backwards/,
  );
});

test("payment schedules require exactly one final balance", () => {
  assert.equal(
    quotePaymentScheduleItemsSchema.safeParse([
      {
        kind: "installment",
        label: "First installment",
        amount: 504000,
        dueDate: "2026-08-01",
      },
    ]).success,
    false,
  );
});

test("stored schedule parsing keeps only bounded customer-safe milestones", () => {
  assert.deepEqual(
    parseQuotePaymentScheduleItems([
      {
        kind: "deposit",
        label: "Booking deposit",
        amount: 151200,
        due_date: "2026-08-01",
        internal_note: "must be stripped",
      },
    ]),
    [validItems[0]],
  );
});

test("invoice readiness requires an accepted quote and exact reconciled schedule", () => {
  const draft = assessQuoteInvoiceReadiness({
    quoteStatus: "draft",
    quoteVersionId: "version-five",
    quoteTotalAmount: 504000,
    schedule: {
      quoteVersionId: "version-five",
      totalAmount: 504000,
      items: validItems,
    },
  });
  assert.equal(draft.code, "ready_after_acceptance");
  assert.equal(draft.ready, false);

  const accepted = assessQuoteInvoiceReadiness({
    quoteStatus: "accepted",
    quoteVersionId: "version-five",
    quoteTotalAmount: 504000,
    schedule: {
      quoteVersionId: "version-five",
      totalAmount: 504000,
      items: validItems,
    },
  });
  assert.equal(accepted.code, "invoice_ready");
  assert.equal(accepted.ready, true);

  const stale = assessQuoteInvoiceReadiness({
    quoteStatus: "accepted",
    quoteVersionId: "version-six",
    quoteTotalAmount: 504000,
    schedule: {
      quoteVersionId: "version-five",
      totalAmount: 504000,
      items: validItems,
    },
  });
  assert.equal(stale.code, "schedule_stale");
  assert.equal(stale.ready, false);
});
