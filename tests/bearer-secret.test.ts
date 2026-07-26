import assert from "node:assert/strict";
import test from "node:test";

import { matchesBearerSecret } from "../lib/auth/bearer-secret";

const secret = "a".repeat(48);

test("worker bearer authentication accepts only the exact bounded secret", () => {
  assert.equal(matchesBearerSecret(`Bearer ${secret}`, secret), true);
  assert.equal(matchesBearerSecret(`Bearer ${"b".repeat(48)}`, secret), false);
  assert.equal(matchesBearerSecret(secret, secret), false);
  assert.equal(matchesBearerSecret(null, secret), false);
});

test("worker bearer authentication rejects short or oversized credentials", () => {
  assert.equal(matchesBearerSecret(`Bearer ${"a".repeat(12)}`, secret), false);
  assert.equal(
    matchesBearerSecret(`Bearer ${"a".repeat(513)}`, "a".repeat(513)),
    false,
  );
});
