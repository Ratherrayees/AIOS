import assert from "node:assert/strict";
import test from "node:test";

import { modelJobPayloadSchema } from "../lib/ai/job-contracts";

test("durable model jobs accept only reference metadata", () => {
  const parsed = modelJobPayloadSchema.parse({
    workflow: "lead_intake",
    deal_id: "019c0000-0000-7000-8000-000000000001",
    prompt_version: "lead-intake.2026-07-26.1",
    provider: "glm",
  });
  assert.equal(parsed.workflow, "lead_intake");
  assert.equal("notes" in parsed, false);
});

test("durable model jobs reject raw text and mismatched record references", () => {
  assert.equal(
    modelJobPayloadSchema.safeParse({
      workflow: "itinerary_draft",
      deal_id: "019c0000-0000-7000-8000-000000000001",
      prompt_version: "itinerary-draft.2026-07-26.1",
      provider: "glm",
    }).success,
    false,
  );
  assert.equal(
    modelJobPayloadSchema.safeParse({
      workflow: "lead_intake",
      deal_id: "019c0000-0000-7000-8000-000000000001",
      prompt_version: "lead-intake.2026-07-26.1",
      provider: "unknown",
      notes: "raw customer content must not be queued",
    }).success,
    false,
  );
});
