import assert from "node:assert/strict";
import test from "node:test";
import { assessLeadHealth } from "../lib/crm/lead-health";

test("lead health escalates an unassigned stale opportunity without a next step", () => {
  const health = assessLeadHealth({ id: "lead-1", name: "Japan family trip", ownerId: null, nextStep: null, lastActivityAt: "2026-07-20T10:00:00.000Z", expectedCloseAt: null }, new Date("2026-07-24T12:00:00.000Z"));
  assert.equal(health.severity, "critical");
});

test("lead health flags a passed expected-close date", () => {
  const health = assessLeadHealth({ id: "lead-2", name: "Goa break", ownerId: "owner-1", nextStep: "Confirm package", lastActivityAt: "2026-07-24T10:00:00.000Z", expectedCloseAt: "2026-07-23" }, new Date("2026-07-24T12:00:00.000Z"));
  assert.equal(health.severity, "watch");
  assert.deepEqual(health.reasons, ["Expected close date passed"]);
});
