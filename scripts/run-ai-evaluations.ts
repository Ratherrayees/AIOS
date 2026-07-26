import { readFileSync } from "node:fs";

import {
  parseItineraryDraft,
  parseLeadExtraction,
  validateItineraryDraftForTrip,
} from "../lib/ai/contracts";
import { inspectLeadIntakeInput } from "../lib/ai/input-safety";
import { evaluateAgentAction } from "../lib/ai/policy";
import { AIOS_PROMPT_VERSIONS } from "../lib/ai/prompt-versions";

type FixtureSet = {
  leadInputs: Array<{
    name: string;
    source: Parameters<typeof inspectLeadIntakeInput>[0];
    expectBlocked: boolean;
    errorCode: string | null;
    expectedRedactions?: {
      email: number;
      phone: number;
      passport: number;
    };
  }>;
  leadOutputs: Array<{
    name: string;
    value: unknown;
    expectValid: boolean;
  }>;
  itineraryOutputs: Array<{
    name: string;
    value: unknown;
    context: Parameters<typeof validateItineraryDraftForTrip>[1];
    expectValid: boolean;
  }>;
  actions: Array<{
    name: string;
    action: string;
    expectedMode: "allowed" | "approval_required" | "blocked";
  }>;
};

const fixtures = JSON.parse(
  readFileSync(
    new URL("../tests/fixtures/ai-evaluations.json", import.meta.url),
    "utf8",
  ),
) as FixtureSet;

const results: Array<{ name: string; passed: boolean; diagnostic?: string }> =
  [];

function record(name: string, passed: boolean, diagnostic?: string) {
  results.push({ name, passed, ...(passed || !diagnostic ? {} : { diagnostic }) });
}

for (const fixture of fixtures.leadInputs) {
  const inspected = inspectLeadIntakeInput(fixture.source);
  record(
    fixture.name,
    inspected.blocked === fixture.expectBlocked &&
      inspected.errorCode === fixture.errorCode &&
      (!fixture.expectedRedactions ||
        JSON.stringify(inspected.audit.sensitive_redactions) ===
          JSON.stringify(fixture.expectedRedactions)),
    `expected blocked=${fixture.expectBlocked}/${fixture.errorCode}; received blocked=${inspected.blocked}/${inspected.errorCode}`,
  );
}

for (const fixture of fixtures.leadOutputs) {
  let valid = true;
  try {
    parseLeadExtraction(fixture.value);
  } catch {
    valid = false;
  }
  record(
    fixture.name,
    valid === fixture.expectValid,
    `expected valid=${fixture.expectValid}; received valid=${valid}`,
  );
}

for (const fixture of fixtures.itineraryOutputs) {
  let valid = true;
  try {
    const draft = parseItineraryDraft(fixture.value);
    validateItineraryDraftForTrip(draft, fixture.context);
  } catch {
    valid = false;
  }
  record(
    fixture.name,
    valid === fixture.expectValid,
    `expected valid=${fixture.expectValid}; received valid=${valid}`,
  );
}

for (const fixture of fixtures.actions) {
  const decision = evaluateAgentAction(fixture.action);
  record(
    fixture.name,
    decision.mode === fixture.expectedMode,
    `expected ${fixture.expectedMode}; received ${decision.mode}`,
  );
}

for (const [workflow, version] of Object.entries(AIOS_PROMPT_VERSIONS)) {
  record(
    `${workflow} prompt has a release version`,
    /^[a-z-]+\.\d{4}-\d{2}-\d{2}\.\d+$/.test(version),
    `invalid prompt version: ${version}`,
  );
}

const failed = results.filter((result) => !result.passed);
console.log(
  JSON.stringify({
    summary: {
      fixtures: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      providerCalls: 0,
    },
    results,
  }),
);
if (failed.length) process.exitCode = 1;
