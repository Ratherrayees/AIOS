import assert from "node:assert/strict";
import test from "node:test";

import { acceptedQuoteReceivablesInputSchema } from "../lib/crm/schemas";

test("accepted quote receivable handoff stays tenant and quote scoped", () => {
  const parsed = acceptedQuoteReceivablesInputSchema.parse({
    organizationId: "11111111-1111-4111-8111-111111111111",
    quoteId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(parsed.quoteId, "22222222-2222-4222-8222-222222222222");
});

test("accepted quote receivable handoff rejects incomplete identifiers", () => {
  assert.equal(
    acceptedQuoteReceivablesInputSchema.safeParse({
      organizationId: "not-a-tenant",
      quoteId: "22222222-2222-4222-8222-222222222222",
    }).success,
    false,
  );
  assert.equal(
    acceptedQuoteReceivablesInputSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
    }).success,
    false,
  );
});
