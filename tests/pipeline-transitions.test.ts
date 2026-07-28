import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedPipelineTransitions,
  isAllowedPipelineTransition,
} from "../lib/crm/pipeline-transitions";

test("open pipeline stages expose only adjacent legal moves", () => {
  assert.deepEqual(allowedPipelineTransitions("new"), ["qualified"]);
  assert.deepEqual(allowedPipelineTransitions("qualified"), [
    "new",
    "proposal",
  ]);
  assert.deepEqual(allowedPipelineTransitions("proposal"), [
    "qualified",
    "decision",
  ]);
  assert.deepEqual(allowedPipelineTransitions("decision"), ["proposal"]);
});

test("closed opportunities are not draggable through the open pipeline", () => {
  assert.deepEqual(allowedPipelineTransitions("won"), []);
  assert.deepEqual(allowedPipelineTransitions("lost"), []);
  assert.equal(isAllowedPipelineTransition("new", "decision"), false);
});
