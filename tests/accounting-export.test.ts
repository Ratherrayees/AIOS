import assert from "node:assert/strict";
import test from "node:test";

import {
  accountingExportFilename,
  buildAccountingExportRows,
  createAccountingExportCsv,
  type AccountingExportInput,
} from "../lib/finance/accounting-export";

function fixture(): AccountingExportInput {
  return {
    generatedAt: new Date("2026-08-08T12:00:00.000Z"),
    workspaceName: "StateAI Travel",
    suppliers: [{ id: "supplier-1", name: "Kyoto Ground Team" }],
    deals: [{ id: "deal-1", title: "Kyoto family journey" }],
    trips: [{ id: "trip-1", name: "Kyoto operations" }],
    issuances: [
      {
        id: "issuance-1",
        invoiceNumber: "INV/2027-00043",
        issuanceSha256: "a".repeat(64),
      },
    ],
    payments: [
      {
        id: "payment-1",
        dealId: "deal-1",
        tripId: "trip-1",
        supplierId: null,
        direction: "receivable",
        status: "partially_paid",
        title: "Customer deposit",
        description: "Accepted quote milestone",
        amount: 118000,
        paidAmount: 40000,
        currency: "INR",
        dueAt: "2026-08-15",
        paidAt: null,
        createdAt: "2026-08-08T09:00:00.000Z",
        invoiceNumber: null,
        invoiceIssuanceId: "issuance-1",
        quoteId: "quote-1",
        quoteVersionId: "version-2",
        quoteAcceptanceId: "acceptance-1",
      },
      {
        id: "payment-2",
        dealId: null,
        tripId: "trip-1",
        supplierId: "supplier-1",
        direction: "payable",
        status: "paid",
        title: "Supplier deposit",
        description: null,
        amount: 25000,
        paidAmount: 25000,
        currency: "INR",
        dueAt: "2026-08-10",
        paidAt: "2026-08-08T11:00:00.000Z",
        createdAt: "2026-08-08T10:00:00.000Z",
        invoiceNumber: "SUP-44",
        invoiceIssuanceId: null,
        quoteId: null,
        quoteVersionId: null,
        quoteAcceptanceId: null,
      },
    ],
    allocations: [
      {
        id: "allocation-1",
        paymentId: "payment-1",
        amount: 40000,
        currency: "INR",
        occurredAt: "2026-08-08T10:30:00.000Z",
        reference: "BANK-44",
        note: "Confirmed on statement",
      },
    ],
  };
}

test("accounting export keeps obligations and settlements as separate exact rows", () => {
  const rows = buildAccountingExportRows(fixture());
  const receivable = rows.find((row) => row.record_id === "payment-1");
  const payable = rows.find((row) => row.record_id === "payment-2");
  const allocation = rows.find((row) => row.record_id === "allocation-1");

  assert.equal(rows.length, 6);
  assert.deepEqual(
    {
      type: receivable?.record_type,
      amount: receivable?.amount,
      settled: receivable?.settled_amount,
      outstanding: receivable?.outstanding_amount,
      invoice: receivable?.invoice_number,
      scope: receivable?.evidence_scope,
    },
    {
      type: "payment_obligation",
      amount: 118000,
      settled: 40000,
      outstanding: 78000,
      invoice: "INV/2027-00043",
      scope: "exact_accepted_quote",
    },
  );
  assert.equal(payable?.supplier_name, "Kyoto Ground Team");
  assert.equal(allocation?.parent_payment_id, "payment-1");
  assert.equal(allocation?.settlement_reference, "BANK-44");
});

test("accounting export carries an explicit no-effect authority boundary", () => {
  const rows = buildAccountingExportRows(fixture());
  const boundary = rows.find((row) => row.record_id === "authority_boundary");

  assert.match(boundary?.description ?? "", /No accounting upload/);
  assert.equal(boundary?.evidence_scope, "human_download_only");
});

test("accounting export fails closed on incoherent money or currency", () => {
  const overSettled = fixture();
  overSettled.payments[0]!.paidAmount = 118001;
  assert.throws(
    () => buildAccountingExportRows(overSettled),
    /settled beyond its obligation amount/,
  );

  const wrongCurrency = fixture();
  wrongCurrency.allocations[0]!.currency = "USD";
  assert.throws(
    () => buildAccountingExportRows(wrongCurrency),
    /currency does not match/,
  );
});

test("accounting CSV neutralizes formulas and preserves quoted values", () => {
  const input = fixture();
  input.payments[0]!.title = '=HYPERLINK("https://example.invalid")';
  input.allocations[0]!.note = '@SUM(1,2), "unsafe"';
  const csv = createAccountingExportCsv(input);

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/);
  assert.match(csv, /"'@SUM\(1,2\), ""unsafe"""/);
  assert.match(csv, /"invoice_number"/);
});

test("accounting export filename is stable and date scoped", () => {
  assert.equal(
    accountingExportFilename(new Date("2026-08-08T23:59:59.000Z")),
    "aios-accounting-ledger-2026-08-08.csv",
  );
});
