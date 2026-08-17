import assert from "node:assert/strict";
import test from "node:test";

import {
  canResolveApproval,
  isInPersonalApprovalQueue,
  summarizeApprovalAttention,
} from "../lib/ai/approval-access";

const userId = "00000000-0000-4000-8000-000000000001";
const teammateId = "00000000-0000-4000-8000-000000000002";

test("personal approvals require both current assignment and action role", () => {
  const approvalRolesByAction = {
    "supplier.follow_up.send": ["owner", "admin", "operations"],
  };

  assert.equal(
    isInPersonalApprovalQueue({
      action: "supplier.follow_up.send",
      approver_id: userId,
      role: "operations",
      userId,
      approvalRolesByAction,
    }),
    true,
  );
  assert.equal(
    isInPersonalApprovalQueue({
      action: "supplier.follow_up.send",
      approver_id: teammateId,
      role: "operations",
      userId,
      approvalRolesByAction,
    }),
    false,
  );
  assert.equal(
    isInPersonalApprovalQueue({
      action: "supplier.follow_up.send",
      approver_id: null,
      role: "viewer",
      userId,
      approvalRolesByAction,
    }),
    false,
  );
});

test("finance gates cannot be delegated to operations by UI policy", () => {
  assert.equal(
    canResolveApproval({
      action: "payment.link.create",
      approver_id: userId,
      role: "operations",
      userId,
      approvalRolesByAction: {
        "payment.link.create": ["operations", "finance"],
      },
    }),
    false,
  );
  assert.equal(
    canResolveApproval({
      action: "payment.link.create",
      approver_id: userId,
      role: "finance",
      userId,
      approvalRolesByAction: {
        "payment.link.create": ["operations", "finance"],
      },
    }),
    true,
  );
});

test("owners can override from Workspace queue without inflating My decisions", () => {
  const input = {
    action: "quote.share",
    approver_id: teammateId,
    role: "owner",
    userId,
  };
  assert.equal(canResolveApproval(input), true);
  assert.equal(isInPersonalApprovalQueue(input), false);
});

test("approval attention separates personal decisions from workspace risk", () => {
  assert.deepEqual(
    summarizeApprovalAttention(
      [
        { action: "quote.share", approver_id: userId },
        { action: "quote.share", approver_id: teammateId },
        { action: "supplier.follow_up.send", approver_id: null },
      ],
      {
        role: "operations",
        userId,
        approvalRolesByAction: {
          "quote.share": ["owner", "admin"],
          "supplier.follow_up.send": ["owner", "admin", "operations"],
        },
      },
    ),
    { mine: 1, workspace: 3 },
  );
});
