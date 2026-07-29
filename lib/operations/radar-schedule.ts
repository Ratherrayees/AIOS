import { z } from "zod";

export const radarScheduleIntervals = [
  15,
  30,
  60,
  180,
  360,
  720,
  1440,
] as const;

export const operationsRadarPolicySchema = z
  .object({
    organizationId: z.uuid(),
    isEnabled: z.boolean(),
    scanIntervalMinutes: z.union(
      radarScheduleIntervals.map((value) => z.literal(value)),
    ),
    confirmationWatchDays: z.number().int().min(1).max(14),
    confirmationCriticalHours: z.number().int().min(1).max(168),
    confirmationHighDays: z.number().int().min(1).max(14),
    documentExpiryDays: z.number().int().min(1).max(30),
    documentHighDays: z.number().int().min(1).max(30),
    paymentDueDays: z.number().int().min(1).max(7),
    paymentHighDays: z.number().int().min(1).max(7),
    taskCriticalHours: z.number().int().min(1).max(168),
    defaultAssigneeId: z.uuid().nullable(),
  })
  .refine(
    (value) =>
      value.confirmationCriticalHours <=
        value.confirmationHighDays * 24 &&
      value.confirmationHighDays <= value.confirmationWatchDays,
    {
      message:
        "Confirmation severity thresholds must fit inside the watch window.",
      path: ["confirmationCriticalHours"],
    },
  )
  .refine(
    (value) => value.documentHighDays <= value.documentExpiryDays,
    {
      message: "The high-risk document window cannot exceed the watch window.",
      path: ["documentHighDays"],
    },
  )
  .refine(
    (value) => value.paymentHighDays <= value.paymentDueDays,
    {
      message: "The high-risk payment window cannot exceed the watch window.",
      path: ["paymentHighDays"],
    },
  );

export const operationsRadarRunNowSchema = z.object({
  organizationId: z.uuid(),
});

export type OperationsRadarPolicyInput = z.infer<
  typeof operationsRadarPolicySchema
>;
