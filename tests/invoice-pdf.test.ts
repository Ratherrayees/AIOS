import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import {
  INVOICE_PDF_RENDERER_VERSION,
  invoiceDocumentFilename,
  renderInvoicePdf,
} from "../lib/finance/invoice-pdf";

const fixture = {
  invoiceNumber: "INV/2027-00043",
  issuedAt: "2027-02-15T09:00:00Z",
  issuanceSha256: "a".repeat(64),
  issuerLegalName: "StateAI Travel Private Limited",
  issuerRegisteredAddress:
    "12 Fictional Market Road, Bengaluru, Karnataka 560001",
  issuerJurisdictionCountryCode: "IN",
  issuerTaxRegistrationId: "29ABCDE1234F1Z5",
  billToName: "Aarav Sharma",
  currency: "INR",
  netAmount: 480_000,
  taxAmount: 24_000,
  totalAmount: 504_000,
  lineItems: [
    {
      position: 0,
      category: "accommodation",
      description: "Two rooms for five nights",
      quantity: 2,
      unit_price_amount: 150_000,
      discount_amount: 0,
      tax_percent: 5,
      net_amount: 300_000,
      tax_amount: 15_000,
      total_amount: 315_000,
    },
    {
      position: 1,
      category: "activity",
      description: "Private experiences and guided transfers",
      quantity: 1,
      unit_price_amount: 180_000,
      discount_amount: 0,
      tax_percent: 5,
      net_amount: 180_000,
      tax_amount: 9_000,
      total_amount: 189_000,
    },
  ],
  paymentTerms: [
    {
      kind: "deposit" as const,
      label: "Booking deposit",
      amount: 151_200,
      due_date: "2027-02-20",
    },
    {
      kind: "balance" as const,
      label: "Final balance",
      amount: 352_800,
      due_date: "2027-03-20",
    },
  ],
};

test("invoice document filenames are storage-safe and stable", () => {
  assert.equal(invoiceDocumentFilename(" INV/2027-00043 "), "inv-2027-00043.pdf");
  assert.equal(invoiceDocumentFilename("..."), "invoice.pdf");
  assert.match(INVOICE_PDF_RENDERER_VERSION, /^invoice-record-v\d+$/);
});

test("renders deterministic invoice evidence with compliance metadata", async () => {
  const first = await renderInvoicePdf(fixture);
  const second = await renderInvoicePdf(fixture);
  const firstHash = createHash("sha256").update(first).digest("hex");
  const secondHash = createHash("sha256").update(second).digest("hex");

  assert.equal(Buffer.from(first.subarray(0, 5)).toString("ascii"), "%PDF-");
  assert.equal(firstHash, secondHash);
  assert.ok(first.byteLength >= 512);
  assert.ok(first.byteLength <= 2_097_152);

  const parsed = await PDFDocument.load(first);
  assert.equal(parsed.getTitle(), "Invoice INV/2027-00043");
  assert.equal(
    parsed.getSubject(),
    "Internal invoice record - jurisdiction review required",
  );
  assert.equal(parsed.getPageCount(), 1);
});

test("paginates a long invoice without exceeding the private bucket limit", async () => {
  const longInvoice = {
    ...fixture,
    invoiceNumber: `INV-${"W".repeat(36)}`,
    issuerLegalName:
      `StateAI International Travel Operations and Destination Management Services Private Limited ${"Holdings ".repeat(20)}`.slice(
        0,
        180,
      ),
    issuerRegisteredAddress:
      `${"International finance operations campus, ".repeat(14)}Bengaluru 560001`.slice(
        0,
        500,
      ),
    issuerTaxRegistrationId: "T".repeat(80),
    billToName:
      `Global Corporate Retreat and Executive Travel Coordination Department ${"Operations ".repeat(20)}`.slice(
        0,
        180,
      ),
    lineItems: Array.from({ length: 50 }, (_, position) => ({
      ...fixture.lineItems[position % fixture.lineItems.length],
      position,
      description: `Detailed travel service ${position + 1} with operational inclusions and supplier evidence`,
    })),
    paymentTerms: fixture.paymentTerms.map((term) => ({
      ...term,
      label: `${term.label} ${"with reviewed finance evidence ".repeat(4)}`.slice(
        0,
        120,
      ),
    })),
  };
  const bytes = await renderInvoicePdf(longInvoice);
  const parsed = await PDFDocument.load(bytes);

  assert.ok(parsed.getPageCount() >= 3);
  assert.ok(bytes.byteLength <= 2_097_152);
});
