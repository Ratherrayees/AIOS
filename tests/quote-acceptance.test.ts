import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_QUOTE_SIGNATORY_NAME_LENGTH,
  QUOTE_ACCEPTANCE_STATEMENT_VERSION,
  publicQuoteAcceptanceInputSchema,
  quoteAcceptanceSnapshotSchema,
} from "../lib/crm/quote-acceptance";

const token = "a".repeat(43);

test("customer acceptance requires explicit confirmation and a normalized name", () => {
  const parsed = publicQuoteAcceptanceInputSchema.parse({
    token,
    signatoryName: "  Aarav Sharma  ",
    confirmed: true,
    statementVersion: QUOTE_ACCEPTANCE_STATEMENT_VERSION,
  });

  assert.equal(parsed.signatoryName, "Aarav Sharma");
  assert.equal(parsed.confirmed, true);
});

test("customer acceptance rejects missing intent and malformed identity evidence", () => {
  assert.equal(
    publicQuoteAcceptanceInputSchema.safeParse({
      token,
      signatoryName: "A",
      confirmed: true,
      statementVersion: 1,
    }).success,
    false,
  );
  assert.equal(
    publicQuoteAcceptanceInputSchema.safeParse({
      token,
      signatoryName: "Aarav Sharma",
      confirmed: false,
      statementVersion: 1,
    }).success,
    false,
  );
  assert.equal(
    publicQuoteAcceptanceInputSchema.safeParse({
      token: "short",
      signatoryName: "Aarav Sharma",
      confirmed: true,
      statementVersion: 1,
    }).success,
    false,
  );
  assert.equal(
    publicQuoteAcceptanceInputSchema.safeParse({
      token,
      signatoryName: "A".repeat(MAX_QUOTE_SIGNATORY_NAME_LENGTH + 1),
      confirmed: true,
      statementVersion: 1,
    }).success,
    false,
  );
});

test("public acceptance snapshot exposes state but not signatory identity", () => {
  assert.deepEqual(quoteAcceptanceSnapshotSchema.parse({ status: "pending" }), {
    status: "pending",
  });
  const accepted = quoteAcceptanceSnapshotSchema.parse({
    status: "accepted",
    accepted_at: "2026-08-01T12:30:00+05:30",
    statement_version: 1,
    signatory_name: "must be stripped",
  });
  assert.equal(accepted.status, "accepted");
  assert.equal("signatory_name" in accepted, false);
});
