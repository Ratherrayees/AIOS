import assert from "node:assert/strict";
import test from "node:test";

import { safeDealStageError } from "../lib/crm/deal-stage-errors";
import { safeSalesWorkflowError } from "../lib/crm/sales-workflow-errors";

test("reviewed deal-stage business rules remain actionable", () => {
  assert.equal(
    safeDealStageError(
      "Complete every required qualification check before advancing this opportunity.",
    ),
    "Complete every required qualification check before advancing this opportunity.",
  );
});

test("unexpected database details are redacted", () => {
  assert.equal(
    safeDealStageError(
      "duplicate key value violates unique constraint private_internal_key",
    ),
    "The opportunity stage was not updated. Please try again.",
  );
});

test("reviewed sales-workflow rules remain actionable", () => {
  assert.equal(
    safeSalesWorkflowError(
      "apply_sequence",
      "Assign an opportunity owner before applying a follow-up sequence.",
      "23514",
    ),
    "Assign an opportunity owner before applying a follow-up sequence.",
  );
});

test("unexpected sales-workflow details are redacted", () => {
  assert.equal(
    safeSalesWorkflowError(
      "create_sequence",
      "duplicate key violates follow_up_sequences_org_name_idx",
      "23505",
    ),
    "A follow-up sequence with that name already exists.",
  );
});
