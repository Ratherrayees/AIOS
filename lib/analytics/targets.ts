import { z } from "zod";

import type { GrowthDeal } from "./management-intelligence";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    );
  }, "Use a real calendar date.");

export const analyticsTargetSchema = z
  .object({
    organizationId: z.uuid(),
    targetId: z.uuid().nullable(),
    label: z.string().trim().min(3).max(80),
    currency: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{3}$/)),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    targetAmount: z.number().finite().positive().max(999_999_999_999_999),
    isActive: z.boolean(),
  })
  .superRefine((value, context) => {
    const start = new Date(`${value.periodStart}T00:00:00.000Z`).getTime();
    const end = new Date(`${value.periodEnd}T00:00:00.000Z`).getTime();
    if (end < start) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "The target end date cannot precede its start date.",
      });
    }
    if (end - start > 365 * 86_400_000) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "One analytics target cannot span more than 366 days.",
      });
    }
  });

export type AnalyticsTargetInput = z.infer<typeof analyticsTargetSchema>;

export type AnalyticsTarget = {
  id: string;
  label: string;
  currency: string;
  period_start: string;
  period_end: string;
  target_amount: number;
  is_active: boolean;
};

const openStages = new Set(["new", "qualified", "proposal", "decision"]);

export function buildTargetCoverage(
  deals: GrowthDeal[],
  targets: AnalyticsTarget[],
  now = new Date(),
) {
  const today = now.toISOString().slice(0, 10);

  return targets
    .filter((target) => target.is_active && target.period_end >= today)
    .map((target) => {
      const pipelineDeals = deals.filter(
        (deal) =>
          openStages.has(deal.stage) &&
          deal.currency.toUpperCase() === target.currency.toUpperCase() &&
          deal.expected_close_at !== null &&
          deal.expected_close_at >= today &&
          deal.expected_close_at >= target.period_start &&
          deal.expected_close_at <= target.period_end &&
          deal.value_amount !== null &&
          deal.value_amount > 0,
      );
      const pipelineValue = pipelineDeals.reduce(
        (sum, deal) => sum + deal.value_amount!,
        0,
      );
      const weightedForecast = pipelineDeals.reduce((sum, deal) => {
        const probability = Number.isFinite(deal.probability)
          ? Math.min(100, Math.max(0, deal.probability))
          : 0;
        return sum + deal.value_amount! * (probability / 100);
      }, 0);
      return {
        ...target,
        pipelineValue,
        weightedForecast,
        opportunities: pipelineDeals.length,
        pipelineCoveragePercent:
          target.target_amount > 0
            ? (pipelineValue / target.target_amount) * 100
            : null,
        weightedCoveragePercent:
          target.target_amount > 0
            ? (weightedForecast / target.target_amount) * 100
            : null,
      };
    })
    .sort(
      (left, right) =>
        left.period_start.localeCompare(right.period_start) ||
        left.currency.localeCompare(right.currency) ||
        left.label.localeCompare(right.label),
    );
}
