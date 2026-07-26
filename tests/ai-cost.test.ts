import assert from "node:assert/strict";
import test from "node:test";

import { calculateModelCostEstimate } from "../lib/ai/cost";

test("model cost estimates use approved per-million token prices", () => {
  assert.equal(
    calculateModelCostEstimate({
      inputTokens: 12_500,
      outputTokens: 2_500,
      inputPricePerMillion: 2,
      outputPricePerMillion: 8,
    }),
    0.045,
  );
});

test("model cost estimates reject invalid telemetry", () => {
  assert.equal(
    calculateModelCostEstimate({
      inputTokens: -1,
      outputTokens: 20,
      inputPricePerMillion: 2,
      outputPricePerMillion: 8,
    }),
    null,
  );
});
