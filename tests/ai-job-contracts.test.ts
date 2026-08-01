import assert from "node:assert/strict";
import test from "node:test";

import { modelJobPayloadSchema } from "../lib/ai/job-contracts";

test("durable model jobs accept only reference metadata", () => {
  const parsed = modelJobPayloadSchema.parse({
    workflow: "lead_intake",
    deal_id: "019c0000-0000-7000-8000-000000000001",
    prompt_version: "lead-intake.2026-07-26.1",
    provider: "glm",
    fallback_provider: "qwen",
  });
  assert.equal(parsed.workflow, "lead_intake");
  assert.equal(parsed.fallback_provider, "qwen");
  assert.equal("notes" in parsed, false);

  const knowledgeJob = modelJobPayloadSchema.parse({
    workflow: "knowledge_answer",
    prompt_version: "knowledge-answer.2026-07-29.1",
    provider: "glm",
  });
  assert.equal(knowledgeJob.workflow, "knowledge_answer");
  assert.equal(knowledgeJob.fallback_provider, undefined);
  assert.equal("question" in knowledgeJob, false);
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
  assert.equal(
    modelJobPayloadSchema.safeParse({
      workflow: "knowledge_answer",
      prompt_version: "knowledge-answer.2026-07-29.1",
      provider: "glm",
      fallback_provider: "unknown",
    }).success,
    false,
  );
});
