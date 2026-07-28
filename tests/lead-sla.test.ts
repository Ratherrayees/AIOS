import assert from "node:assert/strict";
import test from "node:test";

import { assessLeadSla } from "../lib/crm/lead-sla";

const now = new Date("2026-07-28T12:00:00.000Z");

test("lead SLA advances overdue first responses through bounded tiers", () => {
  assert.equal(
    assessLeadSla(
      {
        firstResponseDueAt: "2026-07-28T11:59:00.000Z",
        firstRespondedAt: null,
        followUpDueAt: null,
      },
      now,
    ).level,
    1,
  );
  assert.equal(
    assessLeadSla(
      {
        firstResponseDueAt: "2026-07-28T06:00:00.000Z",
        firstRespondedAt: null,
        followUpDueAt: null,
      },
      now,
    ).level,
    2,
  );
  assert.equal(
    assessLeadSla(
      {
        firstResponseDueAt: "2026-07-27T11:00:00.000Z",
        firstRespondedAt: null,
        followUpDueAt: null,
      },
      now,
    ).level,
    3,
  );
});

test("lead SLA uses follow-up deadline only after the first response", () => {
  const assessment = assessLeadSla(
    {
      firstResponseDueAt: "2026-07-28T08:00:00.000Z",
      firstRespondedAt: "2026-07-28T07:45:00.000Z",
      followUpDueAt: "2026-07-28T10:00:00.000Z",
    },
    now,
  );
  assert.equal(assessment.kind, "follow_up");
  assert.equal(assessment.level, 1);
});
