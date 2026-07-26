import assert from "node:assert/strict";
import test from "node:test";

import { aiJobRetryDelaySeconds } from "../lib/ai/job-policy";

test("AI job retries use a deterministic bounded backoff", () => {
  assert.equal(aiJobRetryDelaySeconds(1), 30);
  assert.equal(aiJobRetryDelaySeconds(2), 120);
  assert.equal(aiJobRetryDelaySeconds(3), 480);
  assert.equal(aiJobRetryDelaySeconds(4), 1_920);
  assert.equal(aiJobRetryDelaySeconds(5), 3_600);
  assert.equal(aiJobRetryDelaySeconds(20), 3_600);
});

test("AI job retry backoff normalizes invalid attempt counters", () => {
  assert.equal(aiJobRetryDelaySeconds(0), 30);
  assert.equal(aiJobRetryDelaySeconds(-3), 30);
  assert.equal(aiJobRetryDelaySeconds(2.9), 120);
});
