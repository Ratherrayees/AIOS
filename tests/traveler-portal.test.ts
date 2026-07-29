import assert from "node:assert/strict";
import test from "node:test";

import {
  travelerPortalSnapshotSchema,
  travelerPortalTokenSchema,
} from "../lib/crm/traveler-portal";

const validSnapshot = {
  schema_version: 1,
  generated_at: "2026-07-29T13:30:00+05:30",
  portal_expires_at: "2026-08-05T13:30:00+05:30",
  trip: {
    name: "Kyoto discovery journey",
    destination: "Kyoto, Japan",
    start_date: "2026-10-10",
    end_date: "2026-10-18",
    status: "confirmed",
  },
  travelers: [
    { first_name: "Aarav", last_name: "Sharma", role: "lead_traveler" },
  ],
  itinerary: [],
  confirmed_services: [
    {
      booking_type: "hotel",
      title: "Kyoto stay",
      confirmation_reference: "KYO-42",
      service_start_at: "2026-10-10T15:00:00+09:00",
      service_end_at: "2026-10-18T11:00:00+09:00",
    },
  ],
  payment_status_included: true,
  receivables: [
    {
      title: "Journey balance",
      amount: 480000,
      paid_amount: 100000,
      outstanding_amount: 380000,
      currency: "INR",
      due_at: "2026-09-15",
      status: "partially_paid",
    },
  ],
  documents: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      file_name: "journey-voucher.pdf",
      mime_type: "application/pdf",
      document_kind: "voucher",
      expires_at: null,
    },
  ],
};

test("traveler portal tokens require the complete high-entropy URL shape", () => {
  assert.equal(
    travelerPortalTokenSchema.safeParse("a".repeat(43)).success,
    true,
  );
  assert.equal(
    travelerPortalTokenSchema.safeParse("short-token").success,
    false,
  );
  assert.equal(
    travelerPortalTokenSchema.safeParse(`${"a".repeat(42)}/`).success,
    false,
  );
});

test("traveler portal snapshots accept the deliberately narrow public shape", () => {
  const parsed = travelerPortalSnapshotSchema.parse(validSnapshot);
  assert.equal(parsed.trip.name, "Kyoto discovery journey");
  assert.equal(parsed.receivables[0].outstanding_amount, 380000);
  assert.equal(parsed.documents[0].document_kind, "voucher");
});

test("traveler portal parsing strips accidental internal commercial fields", () => {
  const parsed = travelerPortalSnapshotSchema.parse({
    ...validSnapshot,
    operations_notes: "Never expose this",
    supplier_terms: { margin: 0.25 },
    trip: {
      ...validSnapshot.trip,
      internal_cost: 250000,
    },
  });
  assert.equal("operations_notes" in parsed, false);
  assert.equal("supplier_terms" in parsed, false);
  assert.equal("internal_cost" in parsed.trip, false);
});
