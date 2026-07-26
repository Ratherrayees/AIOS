import assert from "node:assert/strict";
import test from "node:test";

import {
  inboxSlaEscalationLabel,
  inboxSlaEscalationLevel,
} from "../lib/crm/inbox-sla";

const now = new Date("2026-07-26T12:00:00.000Z");

test("Inbox SLA escalation is inactive before a response deadline", () => {
  assert.equal(
    inboxSlaEscalationLevel({
      responseDueAt: "2026-07-26T13:00:00.000Z",
      priority: "normal",
      now,
    }),
    0,
  );
});

test("Inbox SLA escalation advances through objective overdue tiers", () => {
  assert.equal(
    inboxSlaEscalationLevel({
      responseDueAt: "2026-07-26T11:00:00.000Z",
      priority: "normal",
      now,
    }),
    1,
  );
  assert.equal(
    inboxSlaEscalationLevel({
      responseDueAt: "2026-07-26T07:00:00.000Z",
      priority: "high",
      now,
    }),
    2,
  );
  assert.equal(
    inboxSlaEscalationLevel({
      responseDueAt: "2026-07-25T10:00:00.000Z",
      priority: "normal",
      now,
    }),
    3,
  );
});

test("urgent Inbox work advances one tier without exceeding critical", () => {
  assert.equal(
    inboxSlaEscalationLevel({
      responseDueAt: "2026-07-26T11:00:00.000Z",
      priority: "urgent",
      now,
    }),
    2,
  );
  assert.equal(
    inboxSlaEscalationLevel({
      responseDueAt: "2026-07-25T10:00:00.000Z",
      priority: "urgent",
      now,
    }),
    3,
  );
  assert.equal(inboxSlaEscalationLabel(3), "Critical escalation");
});
