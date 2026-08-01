import assert from "node:assert/strict";
import test from "node:test";

import {
  isQuoteProposalContentReady,
  parseQuoteProposalContent,
  splitQuoteProposalLines,
} from "../lib/crm/quote-proposal";

test("quote proposal content requires an inclusion and a term", () => {
  assert.equal(
    isQuoteProposalContentReady({
      schema_version: 1,
      inclusions: ["Private airport transfers"],
      exclusions: [],
      terms: ["Subject to availability"],
    }),
    true,
  );
  assert.equal(
    isQuoteProposalContentReady({
      schema_version: 1,
      inclusions: [],
      exclusions: ["International flights"],
      terms: ["Subject to availability"],
    }),
    false,
  );
});

test("quote proposal parsing fails closed for noncanonical or duplicate content", () => {
  for (const value of [
    {
      schema_version: 1,
      inclusions: ["Breakfast", "breakfast"],
      exclusions: [],
      terms: ["Valid for 30 days"],
    },
    {
      schema_version: 1,
      inclusions: [" Breakfast"],
      exclusions: [],
      terms: ["Valid for 30 days"],
    },
    {
      schema_version: 1,
      inclusions: ["Breakfast"],
      exclusions: [],
      terms: ["Valid for 30 days"],
      internal_margin: 20,
    },
  ]) {
    assert.equal(isQuoteProposalContentReady(value), false);
    assert.deepEqual(parseQuoteProposalContent(value).inclusions, []);
  }
});

test("proposal textarea lines are trimmed and empty lines are omitted", () => {
  assert.deepEqual(
    splitQuoteProposalLines("  Breakfast\n\nAirport transfers  \r\n"),
    ["Breakfast", "Airport transfers"],
  );
});
