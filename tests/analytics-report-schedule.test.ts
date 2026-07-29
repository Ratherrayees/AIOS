import assert from "node:assert/strict";
import test from "node:test";

import { analyticsReportScheduleSchema } from "../lib/analytics/report-schedule";

const organizationId = "10000000-0000-4000-8000-000000000001";

test("management report schedules accept bounded delivery controls", () => {
  const nextRunAt = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(
    analyticsReportScheduleSchema.safeParse({
      organizationId,
      isEnabled: true,
      cadence: "weekly",
      periodDays: 30,
      forecastHorizonDays: 90,
      nextRunAt,
    }).success,
    true,
  );
});

test("management report schedules reject unsupported cadence and windows", () => {
  const nextRunAt = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(
    analyticsReportScheduleSchema.safeParse({
      organizationId,
      isEnabled: true,
      cadence: "hourly",
      periodDays: 7,
      forecastHorizonDays: 730,
      nextRunAt,
    }).success,
    false,
  );
});

test("management report schedules reject stale and unbounded next runs", () => {
  for (const nextRunAt of [
    new Date(Date.now() - 86_400_000).toISOString(),
    new Date(Date.now() + 367 * 86_400_000).toISOString(),
  ]) {
    assert.equal(
      analyticsReportScheduleSchema.safeParse({
        organizationId,
        isEnabled: true,
        cadence: "monthly",
        periodDays: 365,
        forecastHorizonDays: 365,
        nextRunAt,
      }).success,
      false,
    );
  }
});
