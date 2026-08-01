import assert from "node:assert/strict";
import test from "node:test";

import { conversationDraftReviewInputSchema } from "../lib/ai/draft-review";

const identity = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  draftId: "22222222-2222-4222-8222-222222222222",
};

test("an exact Sales Copilot revision can be approved without feedback", () => {
  const result = conversationDraftReviewInputSchema.parse({
    ...identity,
    decision: "approved",
    note: null,
  });

  assert.equal(result.decision, "approved");
  assert.equal(result.note, null);
});

test("changes requested and rejection require useful bounded feedback", () => {
  assert.equal(
    conversationDraftReviewInputSchema.safeParse({
      ...identity,
      decision: "changes_requested",
      note: "short",
    }).success,
    false,
  );
  assert.equal(
    conversationDraftReviewInputSchema.safeParse({
      ...identity,
      decision: "rejected",
      note: "x".repeat(501),
    }).success,
    false,
  );
  assert.equal(
    conversationDraftReviewInputSchema.safeParse({
      ...identity,
      decision: "changes_requested",
      note: "Confirm the hotel category before use.",
    }).success,
    true,
  );
});

test("approval cannot smuggle free-text feedback into the no-note decision", () => {
  assert.equal(
    conversationDraftReviewInputSchema.safeParse({
      ...identity,
      decision: "approved",
      note: "Hidden feedback",
    }).success,
    false,
  );
});
