import { z } from "zod";

const scheduleWindowSchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(365),
]);

export const analyticsReportScheduleSchema = z
  .object({
    organizationId: z.uuid(),
    isEnabled: z.boolean(),
    cadence: z.enum(["weekly", "monthly"]),
    periodDays: scheduleWindowSchema,
    forecastHorizonDays: scheduleWindowSchema,
    nextRunAt: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    const nextRun = new Date(value.nextRunAt).getTime();
    const now = Date.now();
    if (
      !Number.isFinite(nextRun) ||
      nextRun < now - 5 * 60_000 ||
      nextRun > now + 366 * 86_400_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextRunAt"],
        message: "The next delivery must be within the next 366 days.",
      });
    }
  });

export const analyticsReportRunNowSchema = z.object({
  organizationId: z.uuid(),
});

export type AnalyticsReportScheduleInput = z.infer<
  typeof analyticsReportScheduleSchema
>;
