import assert from "node:assert/strict";
import test from "node:test";

import {
  dailyRunLimitExceeded,
  resolveAiosBudgetPolicy,
} from "../lib/ai/budget";

test("AIOS blocks only after an organization reaches its daily model-run ceiling", () => {
  assert.equal(dailyRunLimitExceeded(3, 3), false);
  assert.equal(dailyRunLimitExceeded(4, 3), true);
});

test("workspace AIOS budget policy overrides the server fallback", () => {
  assert.deepEqual(
    resolveAiosBudgetPolicy({
      daily_model_run_limit: 12,
      model_execution_enabled: false,
    }),
    { dailyRunLimit: 12, modelExecutionEnabled: false },
  );
});
