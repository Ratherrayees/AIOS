import assert from "node:assert/strict";
import test from "node:test";

import { operationsRadarPolicySchema } from "../lib/operations/radar-schedule";

const validPolicy = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  isEnabled: true,
  scanIntervalMinutes: 60,
  confirmationWatchDays: 14,
  confirmationCriticalHours: 48,
  confirmationHighDays: 7,
  documentExpiryDays: 30,
  documentHighDays: 7,
  paymentDueDays: 7,
  paymentHighDays: 2,
  taskCriticalHours: 24,
  defaultAssigneeId: null,
};

test("Operations Radar schedules accept the bounded production defaults", () => {
  const parsed = operationsRadarPolicySchema.parse(validPolicy);
  assert.equal(parsed.scanIntervalMinutes, 60);
  assert.equal(parsed.documentExpiryDays, 30);
});

test("Operations Radar schedules reject unsupported scan frequencies", () => {
  assert.equal(
    operationsRadarPolicySchema.safeParse({
      ...validPolicy,
      scanIntervalMinutes: 5,
    }).success,
    false,
  );
});

test("Operations Radar severity windows cannot exceed their watch windows", () => {
  assert.equal(
    operationsRadarPolicySchema.safeParse({
      ...validPolicy,
      confirmationWatchDays: 3,
      confirmationHighDays: 7,
    }).success,
    false,
  );
  assert.equal(
    operationsRadarPolicySchema.safeParse({
      ...validPolicy,
      paymentDueDays: 2,
      paymentHighDays: 4,
    }).success,
    false,
  );
});
