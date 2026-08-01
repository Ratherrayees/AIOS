import { z } from "zod";

export const autonomyModeSchema = z.enum([
  "observe",
  "assist",
  "auto",
  "approval_required",
]);
export type AutonomyMode = z.infer<typeof autonomyModeSchema>;

export const AIOS_ACTION_CATALOG = [
  {
    action: "internal.task.create",
    title: "Create internal follow-up tasks",
    description: "Create and assign internal tasks from approved CRM context.",
    defaultMode: "auto",
    hardApproval: false,
  },
  {
    action: "crm.lead.triage",
    title: "Triage at-risk opportunities",
    description:
      "Scan live deals and create one deduplicated internal follow-up for each objective risk signal.",
    defaultMode: "auto",
    hardApproval: false,
  },
  {
    action: "inbox.sla.triage",
    title: "Triage overdue Inbox SLAs",
    description:
      "Scan overdue response deadlines and create one deduplicated internal follow-up per conversation.",
    defaultMode: "auto",
    hardApproval: false,
  },
  {
    action: "trip.operations.monitor",
    title: "Monitor operational trip risk",
    description:
      "Detect and route objective trip, booking, document, task, and payment-due exceptions without creating an external commitment.",
    defaultMode: "auto",
    hardApproval: false,
  },
  {
    action: "crm.deal.route",
    title: "Route unassigned opportunities",
    description:
      "Assign an unowned live opportunity to the least-loaded active sales teammate.",
    defaultMode: "auto",
    hardApproval: false,
  },
  {
    action: "crm.field_draft.create",
    title: "Prepare CRM updates",
    description:
      "Extract and draft lead, traveller, and trip fields for review or automation.",
    defaultMode: "assist",
    hardApproval: false,
  },
  {
    action: "itinerary.draft.prepare",
    title: "Prepare itinerary drafts",
    description:
      "Create cited internal itinerary suggestions for a human to review one item at a time.",
    defaultMode: "assist",
    hardApproval: false,
  },
  {
    action: "knowledge.answer.compose",
    title: "Compose cited knowledge answers",
    description:
      "Answer internal questions only from approved, permission-visible evidence with server-attached citations.",
    defaultMode: "auto",
    hardApproval: false,
  },
  {
    action: "inbox.reply_draft.prepare",
    title: "Prepare Inbox reply drafts",
    description:
      "Summarize bounded conversation evidence and save an internal reply draft for human review without sending it.",
    defaultMode: "assist",
    hardApproval: false,
  },
  {
    action: "external_message.send",
    title: "Send traveller follow-ups",
    description: "Send approved, personalized customer communications.",
    defaultMode: "approval_required",
    hardApproval: true,
  },
  {
    action: "supplier.follow_up.send",
    title: "Chase supplier confirmations",
    description:
      "Request supplier confirmations and missing operational information.",
    defaultMode: "approval_required",
    hardApproval: true,
  },
  {
    action: "quote.share",
    title: "Share quotes",
    description: "Send a customer-ready quote or itinerary proposal.",
    defaultMode: "approval_required",
    hardApproval: true,
  },
  {
    action: "pricing.override",
    title: "Override pricing",
    description: "Change a quoted price, discount, or margin.",
    defaultMode: "approval_required",
    hardApproval: true,
  },
  {
    action: "booking.confirm",
    title: "Confirm bookings",
    description: "Make a supplier or customer booking commitment.",
    defaultMode: "approval_required",
    hardApproval: true,
  },
  {
    action: "payment.refund",
    title: "Refund a payment",
    description: "Issue or instruct a customer payment refund.",
    defaultMode: "approval_required",
    hardApproval: true,
  },
  {
    action: "document.share",
    title: "Share traveller documents",
    description:
      "Share passport, visa, voucher, or other traveller documents externally.",
    defaultMode: "approval_required",
    hardApproval: true,
  },
] as const satisfies ReadonlyArray<{
  action: string;
  title: string;
  description: string;
  defaultMode: AutonomyMode;
  hardApproval: boolean;
}>;

export type AiosAction = (typeof AIOS_ACTION_CATALOG)[number]["action"];

export function getAiosAction(action: string) {
  return AIOS_ACTION_CATALOG.find((candidate) => candidate.action === action);
}

export function evaluateAutonomy(action: string, mode: AutonomyMode) {
  const policy = getAiosAction(action);
  if (!policy)
    return {
      decision: "blocked" as const,
      reason: "This AIOS action is not registered.",
    };
  if (policy.hardApproval || mode === "approval_required")
    return {
      decision: "approval_required" as const,
      reason: "This action has a human approval gate.",
    };
  if (mode === "observe")
    return {
      decision: "observe" as const,
      reason:
        "AIOS may monitor and recommend but cannot alter records or communicate.",
    };
  if (mode === "assist")
    return {
      decision: "draft" as const,
      reason: "AIOS may prepare the action for a person to execute.",
    };
  return {
    decision: "execute" as const,
    reason: "AIOS is authorized to execute this bounded action.",
  };
}
