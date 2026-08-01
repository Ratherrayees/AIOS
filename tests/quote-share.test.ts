import assert from "node:assert/strict";
import test from "node:test";

import {
  quoteShareSnapshotSchema,
  quoteShareTokenSchema,
} from "../lib/crm/quote-share";

const validSnapshot = {
  schema_version: 1,
  published_at: "2026-08-01T12:00:00+05:30",
  expires_at: "2026-08-08T12:00:00+05:30",
  organization: { name: "StateAI Travel" },
  customer: { name: "Aarav Sharma", destination: "Kyoto, Japan" },
  quote: {
    title: "Kyoto family discovery",
    version: 5,
    currency: "INR",
    valid_until: "2026-08-31",
    total_amount: 504000,
    line_items: [
      {
        position: 0,
        category: "accommodation",
        description: "Two rooms",
        quantity: 2,
        discount_amount: 20000,
        tax_percent: 5,
        tax_amount: 19000,
        total_amount: 399000,
      },
    ],
    content: {
      schema_version: 1,
      inclusions: ["Daily breakfast"],
      exclusions: ["International flights"],
      terms: ["Subject to availability"],
    },
  },
};

test("public proposal tokens require a complete high-entropy URL shape", () => {
  assert.equal(quoteShareTokenSchema.safeParse("a".repeat(43)).success, true);
  assert.equal(quoteShareTokenSchema.safeParse("short-token").success, false);
  assert.equal(
    quoteShareTokenSchema.safeParse(`${"a".repeat(42)}/`).success,
    false,
  );
});

test("public proposal snapshots accept exact customer-safe evidence", () => {
  const parsed = quoteShareSnapshotSchema.parse(validSnapshot);
  assert.equal(parsed.quote.version, 5);
  assert.equal(parsed.quote.total_amount, 504000);
  assert.equal(parsed.quote.content.inclusions[0], "Daily breakfast");
});

test("public proposal parsing strips accidental protected commercial fields", () => {
  const parsed = quoteShareSnapshotSchema.parse({
    ...validSnapshot,
    token_hash: "never expose this",
    quote: {
      ...validSnapshot.quote,
      estimated_cost_amount: 370000,
      margin_amount: 110000,
      supplier_id: "11111111-1111-4111-8111-111111111111",
    },
  });
  assert.equal("token_hash" in parsed, false);
  assert.equal("estimated_cost_amount" in parsed.quote, false);
  assert.equal("margin_amount" in parsed.quote, false);
  assert.equal("supplier_id" in parsed.quote, false);
});
