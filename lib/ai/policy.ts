import { actionRequiresApproval, type ApprovalAction } from "../security";

export const AUTONOMOUS_INTERNAL_ACTIONS = [
  "internal.task.create",
  "internal.note.create",
  "internal.summary.create",
  "crm.field_draft.create",
  "itinerary.draft.prepare",
  "knowledge.answer.compose",
  "crm.lead.triage",
  "inbox.sla.triage",
  "trip.operations.monitor",
] as const;

export type AutonomousInternalAction =
  (typeof AUTONOMOUS_INTERNAL_ACTIONS)[number];

export type AgentActionDecision =
  | { mode: "allowed"; reason: string }
  | { mode: "approval_required"; action: ApprovalAction; reason: string }
  | { mode: "blocked"; reason: string };

/**
 * This policy is intentionally conservative. Any action not declared here is
 * blocked until a reviewed product/security decision adds it explicitly.
 */
export function evaluateAgentAction(action: string): AgentActionDecision {
  if ((AUTONOMOUS_INTERNAL_ACTIONS as readonly string[]).includes(action)) {
    return {
      mode: "allowed",
      reason: "Low-risk internal draft or task action.",
    };
  }

  if (actionRequiresApproval(action)) {
    return {
      mode: "approval_required",
      action,
      reason:
        "This action can affect a traveller, supplier, price, booking, payment, or sensitive document.",
    };
  }

  return {
    mode: "blocked",
    reason: "This action has not been approved for AIOS.",
  };
}
