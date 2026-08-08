export const SECURITY_EVENT_TYPES = [
  "auth.sign_in",
  "auth.sign_out",
  "record.created",
  "record.updated",
  "membership.changed",
  "record.exported",
  "document.accessed",
  "pricing.changed",
  "approval.requested",
  "approval.resolved",
  "approval.expired",
  "ai.tool_called",
  "ai.action_blocked",
  "ai.run_started",
  "ai.run_completed",
  "ai.run_blocked",
  "email.delivered",
  "email.delivery_failed",
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const APPROVAL_ACTIONS = [
  "external_message.send",
  "supplier.follow_up.send",
  "quote.share",
  "pricing.override",
  "booking.confirm",
  "invoice.issue",
  "payment.link.create",
  "payment.refund",
  "document.share",
] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** Actions that must never be executed by an AI agent without an approval. */
export function actionRequiresApproval(action: string): action is ApprovalAction {
  return (APPROVAL_ACTIONS as readonly string[]).includes(action);
}
