import { z } from "zod";

export const DAILY_COORDINATOR_LIMITS = {
  unassignedDeals: 10,
  leadRisks: 25,
  inboxSlaRisks: 25,
  externalActions: false,
} as const;

export const DAILY_COORDINATOR_WORKFLOWS = [
  {
    key: "routing",
    action: "crm.deal.route",
    maximumRecords: DAILY_COORDINATOR_LIMITS.unassignedDeals,
  },
  {
    key: "leadRisks",
    action: "crm.lead.triage",
    maximumRecords: DAILY_COORDINATOR_LIMITS.leadRisks,
  },
  {
    key: "inboxSlas",
    action: "inbox.sla.triage",
    maximumRecords: DAILY_COORDINATOR_LIMITS.inboxSlaRisks,
  },
  {
    key: "operations",
    action: "trip.operations.monitor",
    maximumRecords: null,
  },
] as const;

const coordinatorStepSchema = z.object({
  status: z.enum([
    "completed",
    "approval_required",
    "deferred",
    "blocked",
    "failed",
  ]),
  scanned: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  approvals: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export type DailyCoordinatorStep = z.infer<typeof coordinatorStepSchema>;

const coordinatorStepsSchema = z.object({
  routing: coordinatorStepSchema,
  leadRisks: coordinatorStepSchema,
  inboxSlas: coordinatorStepSchema,
  operations: coordinatorStepSchema,
});

export type DailyCoordinatorSteps = z.infer<typeof coordinatorStepsSchema>;

/**
 * Produces the durable, metadata-only result for a daily coordinator run.
 * Approvals are an expected successful outcome; only an actual child failure
 * makes the aggregate run partial.
 */
export function summarizeDailyCoordinator(input: DailyCoordinatorSteps) {
  const steps = coordinatorStepsSchema.parse(input);
  const values = Object.values(steps);
  return {
    status: values.some((step) => step.status === "failed")
      ? ("partial" as const)
      : ("completed" as const),
    externalActions: DAILY_COORDINATOR_LIMITS.externalActions,
    totals: {
      scanned: values.reduce((total, step) => total + step.scanned, 0),
      changed: values.reduce((total, step) => total + step.changed, 0),
      approvals: values.reduce((total, step) => total + step.approvals, 0),
      skipped: values.reduce((total, step) => total + step.skipped, 0),
      failed: values.filter((step) => step.status === "failed").length,
    },
    steps,
  };
}
