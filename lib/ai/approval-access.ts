const DECISION_ROLES = new Set(["owner", "admin", "operations", "finance"]);
const FINANCE_APPROVAL_ACTIONS = new Set([
  "invoice.issue",
  "payment.link.create",
  "payment.refund",
]);

export type ApprovalAttentionRow = {
  action: string;
  approver_id: string | null;
};

type ApprovalAccessInput = ApprovalAttentionRow & {
  role: string | null;
  userId: string | null;
  approvalRolesByAction?: Readonly<Record<string, readonly string[]>>;
};

function requiredRoles(
  action: string,
  approvalRolesByAction: Readonly<Record<string, readonly string[]>>,
) {
  const configured = approvalRolesByAction[action];
  const roles = configured?.length
    ? configured
    : FINANCE_APPROVAL_ACTIONS.has(action)
      ? ["owner", "admin", "finance"]
      : ["owner", "admin"];

  return FINANCE_APPROVAL_ACTIONS.has(action)
    ? roles.filter((role) =>
        role === "owner" || role === "admin" || role === "finance",
      )
    : roles;
}

/** Mirrors resolve_approval_request's role and assignment checks for UI affordances. */
export function canResolveApproval({
  action,
  approver_id: approverId,
  role,
  userId,
  approvalRolesByAction = {},
}: ApprovalAccessInput) {
  if (!role || !userId || !DECISION_ROLES.has(role)) return false;

  const isManager = role === "owner" || role === "admin";
  if (!isManager && !requiredRoles(action, approvalRolesByAction).includes(role))
    return false;

  return !approverId || approverId === userId || isManager;
}

/** Keeps My decisions personal even though owners/admins may override from Workspace queue. */
export function isInPersonalApprovalQueue(input: ApprovalAccessInput) {
  if (input.approver_id && input.approver_id !== input.userId) return false;
  return canResolveApproval(input);
}

export function summarizeApprovalAttention(
  approvals: readonly ApprovalAttentionRow[],
  context: Omit<ApprovalAccessInput, keyof ApprovalAttentionRow>,
) {
  return {
    mine: approvals.filter((approval) =>
      isInPersonalApprovalQueue({ ...approval, ...context }),
    ).length,
    workspace: approvals.length,
  };
}
