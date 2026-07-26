"use server";

import { z } from "zod";

import {
  executeApprovedInboxSlaTriage,
  executeApprovedLeadRouting,
  executeApprovedLeadTriage,
  resumeApprovedLeadIntakeRun,
} from "./agents";
import { requireOrganizationRole } from "../../lib/authorization";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const resolveApprovalSchema = z.object({
  organizationId: z.uuid(),
  approvalId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
});

/** Resolves a pending human gate and resumes the registered workflow when applicable. */
export async function resolveApprovalRequest(
  input: z.infer<typeof resolveApprovalSchema>,
) {
  const data = resolveApprovalSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "operations",
    "finance",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: approval, error: approvalError } = await supabase
    .rpc("resolve_approval_request", {
      target_organization_id: data.organizationId,
      target_approval_id: data.approvalId,
      target_decision: data.decision,
    })
    .single();
  if (approvalError || !approval)
    throw new Error("This approval request could not be resolved.");
  if (approval.resolved_status === "expired")
    throw new Error(
      "This approval request has expired and needs to be re-routed.",
    );

  if (data.decision !== "approved")
    return { approvalId: approval.approval_id, status: data.decision };
  if (approval.approval_action === "crm.lead.triage") {
    const triage = await executeApprovedLeadTriage({
      organizationId: data.organizationId,
    });
    return {
      approvalId: approval.approval_id,
      status: data.decision,
      triage,
    };
  }
  if (approval.approval_action === "inbox.sla.triage") {
    const runId =
      typeof approval.approval_payload === "object" &&
      approval.approval_payload !== null &&
      !Array.isArray(approval.approval_payload) &&
      typeof approval.approval_payload.ai_run_id === "string"
        ? approval.approval_payload.ai_run_id
        : null;
    if (!runId)
      throw new Error("This Inbox SLA approval is missing its agent run.");
    const triage = await executeApprovedInboxSlaTriage({
      organizationId: data.organizationId,
      runId,
    });
    return {
      approvalId: approval.approval_id,
      status: data.decision,
      triage,
    };
  }
  if (!approval.approval_entity_id)
    return { approvalId: approval.approval_id, status: data.decision };
  if (approval.approval_action === "crm.deal.route") {
    const candidateId =
      typeof approval.approval_payload === "object" &&
      approval.approval_payload !== null &&
      !Array.isArray(approval.approval_payload) &&
      typeof approval.approval_payload.candidate_id === "string"
        ? approval.approval_payload.candidate_id
        : null;
    if (!candidateId)
      throw new Error(
        "This routing approval is missing its nominated teammate.",
      );
    const routedDeal = await executeApprovedLeadRouting({
      organizationId: data.organizationId,
      dealId: approval.approval_entity_id,
      candidateId,
    });
    return {
      approvalId: approval.approval_id,
      status: data.decision,
      routedDeal,
    };
  }
  if (approval.approval_action !== "crm.field_draft.create")
    return { approvalId: approval.approval_id, status: data.decision };
  const runId =
    typeof approval.approval_payload === "object" &&
    approval.approval_payload !== null &&
    !Array.isArray(approval.approval_payload) &&
    typeof approval.approval_payload.ai_run_id === "string"
      ? approval.approval_payload.ai_run_id
      : null;
  if (!runId)
    return { approvalId: approval.approval_id, status: data.decision };

  const resumed = await resumeApprovedLeadIntakeRun({
    organizationId: data.organizationId,
    approvalId: approval.approval_id,
    runId,
    dealId: approval.approval_entity_id,
  });
  return {
    approvalId: approval.approval_id,
    status: data.decision,
    resumedRun: resumed,
  };
}
