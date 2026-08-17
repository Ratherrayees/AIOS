import assert from "node:assert/strict";
import test from "node:test";

import {
  inboundThreadKey,
  parseMailboxAddress,
  plainTextFromEmail,
} from "../lib/email/inbound-normalization";

test("mailbox parsing normalizes the address and retains a bounded name", () => {
  assert.deepEqual(parseMailboxAddress('  "Aisha Khan" <AISHA@Example.com>  '), {
    email: "aisha@example.com",
    name: "Aisha Khan",
  });
});

test("mailbox parsing rejects malformed sender identities", () => {
  assert.throws(() => parseMailboxAddress("not-an-email"));
});

test("reply and forward prefixes remain in the same inbound thread", () => {
  const original = inboundThreadKey("traveller@example.com", "Dubai itinerary");
  assert.equal(
    inboundThreadKey("TRAVELLER@example.com", "Re: Fwd: Dubai   itinerary"),
    original,
  );
});

test("plain text is preferred and bounded before provider HTML", () => {
  const oversized = "a".repeat(500_100);
  assert.equal(plainTextFromEmail(oversized, "<p>ignored</p>").length, 500_000);
});

test("HTML fallback strips scripts, styles, and markup before Inbox storage", () => {
  const result = plainTextFromEmail(
    null,
    '<style>.x{display:none}</style><script>alert(1)</script><p>Hello &amp; welcome</p><p>Dubai</p>',
  );
  assert.equal(result, "Hello & welcome\n\n Dubai");
  assert.doesNotMatch(result, /<|>|alert|display/);
});
