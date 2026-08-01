"use server";

import { z } from "zod";

import { gateAiosAction } from "./aios";
import { requireOrganizationRole } from "../../lib/authorization";
import {
  loadOrganizationModelBudget,
  modelBudgetBlockReason,
} from "../../lib/ai/execution-policy";
import { inspectConversationCopilotInput } from "../../lib/ai/input-safety";
import {
  conversationDraftReviewInputSchema,
  type ConversationDraftReviewInput,
} from "../../lib/ai/draft-review";
import {
  conversationMessageCitations,
  loadConversationEvidence,
  persistCopilotDraft,
} from "../../lib/ai/conversation-copilot-runtime";
import {
  AiosJobNotAvailableError,
  prepareModelJob,
  settleModelJob,
} from "../../lib/ai/jobs";
import {
  AiosProviderNotConfiguredError,
  getAiosProviderStatus,
  runConversationReplyDraft,
} from "../../lib/ai/openai-provider";
import { AIOS_PROMPT_VERSIONS } from "../../lib/ai/prompt-versions";
import { estimateModelRunCost } from "../../lib/ai/pricing";
import {
  completeAgentRun,
  CONVERSATION_REPLY_DRAFT_AGENT,
  createAgentRun,
  recordAgentToolCall,
  resumeAgentRun,
} from "../../lib/ai/runtime";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import type { Json } from "../../types/database";

const inboxWriteRoles = [
  "owner",
  "admin",
  "sales",
  "operations",
  "agent",
] as const;

const conversationCopilotInputSchema = z.object({
  organizationId: z.uuid(),
  conversationId: z.uuid(),
  channel: z.enum(["email", "whatsapp"]),
});

const conversationRunReferenceSchema = z.object({
  workflow: z.literal("conversation_reply_draft"),
  conversation_id: z.uuid(),
  channel: z.enum(["email", "whatsapp"]),
  prompt_version: z.string(),
});

const resumeConversationCopilotSchema = z.object({
  organizationId: z.uuid(),
  approvalId: z.uuid(),
  runId: z.uuid(),
  conversationId: z.uuid(),
});

async function executeConversationCopilot(input: {
  organizationId: string;
  conversationId: string;
  runId: string;
  initiatedBy: string;
  channel: "email" | "whatsapp";
  approvalRequestId?: string | null;
  resumed?: boolean;
  source?: Awaited<ReturnType<typeof loadConversationEvidence>>;
  inspection?: ReturnType<typeof inspectConversationCopilotInput>;
  safetyAlreadyRecorded?: boolean;
}) {
  const startedAt = Date.now();
  if (input.resumed)
    await resumeAgentRun({
      organizationId: input.organizationId,
      runId: input.runId,
    });
  const source =
    input.source ??
    (await loadConversationEvidence(
      input.organizationId,
      input.conversationId,
    ));
  const inspected =
    input.inspection ?? inspectConversationCopilotInput(source);
  if (!input.safetyAlreadyRecorded)
    await recordAgentToolCall({
      organizationId: input.organizationId,
      runId: input.runId,
      toolName: "aios.input_safety_check",
      requestedAction: "model.input.prepare",
      decision: inspected.blocked ? "blocked" : "allowed",
      arguments: { conversation_id: input.conversationId },
      result: inspected.audit,
    });
  if (inspected.blocked) {
    await completeAgentRun({
      organizationId: input.organizationId,
      runId: input.runId,
      status: "blocked",
      errorCode: inspected.errorCode,
      durationMs: Date.now() - startedAt,
      approvalRequestId: input.approvalRequestId,
    });
    return {
      runId: input.runId,
      status: "blocked" as const,
      message:
        "AIOS needs a bounded, safe conversation history before it can prepare a reply draft.",
    };
  }

  const budget = await loadOrganizationModelBudget(input.organizationId);
  const budgetBlock = modelBudgetBlockReason(budget);
  if (budgetBlock) {
    await completeAgentRun({
      organizationId: input.organizationId,
      runId: input.runId,
      status: "blocked",
      errorCode: budgetBlock.code,
      durationMs: Date.now() - startedAt,
      approvalRequestId: input.approvalRequestId,
    });
    return {
      runId: input.runId,
      status: "blocked" as const,
      message: budgetBlock.message,
    };
  }

  let modelJob: Awaited<ReturnType<typeof prepareModelJob>> | null = null;
  try {
    modelJob = await prepareModelJob({
      organizationId: input.organizationId,
      aiRunId: input.runId,
      jobType: "conversation_reply_draft",
      payload: {
        workflow: "conversation_reply_draft",
        conversation_id: input.conversationId,
        channel: input.channel,
        prompt_version: AIOS_PROMPT_VERSIONS.conversationReplyDraft,
        provider: budget.selectedModelProvider,
        fallback_provider: budget.fallbackModelProvider,
      },
    });
    const modelResult = await runConversationReplyDraft(
      inspected.source,
      input.channel,
      budget.selectedModelProvider,
      budget.fallbackModelProvider,
    );
    const draft = await persistCopilotDraft({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      runId: input.runId,
      initiatedBy: input.initiatedBy,
      channel: input.channel,
      subject: modelResult.draft.replySubject,
      body: modelResult.draft.replyBody,
    });
    await settleModelJob({
      jobId: modelJob.job_id,
      workerId: modelJob.workerId,
      attempt: modelJob.job_attempts,
      succeeded: true,
    });
    const estimatedCost = await estimateModelRunCost({
      organizationId: input.organizationId,
      provider: modelResult.provider,
      model: modelResult.model,
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens,
    });
    await recordAgentToolCall({
      organizationId: input.organizationId,
      runId: input.runId,
      toolName: "inbox.reply_draft",
      requestedAction: "inbox.reply_draft.prepare",
      decision: "allowed",
      arguments: {
        conversation_id: input.conversationId,
        channel: input.channel,
        external_message_sent: false,
      },
      result: {
        draft_id: draft.id,
        status: "ready_for_review",
        fallback_used: modelResult.fallbackUsed,
      },
    });
    await completeAgentRun({
      organizationId: input.organizationId,
      runId: input.runId,
      status: "succeeded",
      result: {
        summary: modelResult.draft.summary,
        suggested_next_steps: modelResult.draft.suggestedNextSteps,
        missing_information: modelResult.draft.missingInformation,
        confidence: modelResult.draft.confidence,
        draft_id: draft.id,
        primary_provider: budget.selectedModelProvider,
        provider: modelResult.provider,
        attempted_providers: modelResult.attemptedProviders,
        fallback_used: modelResult.fallbackUsed,
        model: modelResult.model,
        prompt_version: modelResult.promptVersion,
        response_id: modelResult.responseId,
        input_safety: inspected.audit,
      } as Json,
      citations: conversationMessageCitations(inspected.source) as Json,
      durationMs: Date.now() - startedAt,
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens,
      estimatedCost,
      approvalRequestId: input.approvalRequestId,
    });
    return {
      runId: input.runId,
      status: "succeeded" as const,
      message:
        "AIOS prepared an internal reply draft for human review. Nothing was sent.",
      summary: modelResult.draft.summary,
      suggestedNextSteps: modelResult.draft.suggestedNextSteps,
      missingInformation: modelResult.draft.missingInformation,
      confidence: modelResult.draft.confidence,
      draft,
    };
  } catch (error) {
    const errorCode =
      error instanceof AiosProviderNotConfiguredError
        ? "AI_PROVIDER_NOT_CONFIGURED"
        : error instanceof AiosJobNotAvailableError
          ? "AI_JOB_NOT_AVAILABLE"
          : "CONVERSATION_REPLY_DRAFT_FAILED";
    if (modelJob) {
      await settleModelJob({
        jobId: modelJob.job_id,
        workerId: modelJob.workerId,
        attempt: modelJob.job_attempts,
        succeeded: false,
        errorCode,
      });
    }
    await recordAgentToolCall({
      organizationId: input.organizationId,
      runId: input.runId,
      toolName: "model.structured_output",
      requestedAction: "inbox.reply_draft.prepare",
      decision: "failed",
      arguments: getAiosProviderStatus(budget.selectedModelProvider),
      result: { error_code: errorCode },
    });
    await completeAgentRun({
      organizationId: input.organizationId,
      runId: input.runId,
      status: "failed",
      errorCode,
      durationMs: Date.now() - startedAt,
      approvalRequestId: input.approvalRequestId,
    });
    if (
      error instanceof AiosProviderNotConfiguredError ||
      error instanceof AiosJobNotAvailableError
    )
      return {
        runId: input.runId,
        status: "blocked" as const,
        message: error.message,
      };
    throw error;
  }
}

/** Creates one internal, review-ready draft and never sends a message. */
export async function prepareConversationReplyDraft(
  input: z.infer<typeof conversationCopilotInputSchema>,
) {
  const data = conversationCopilotInputSchema.parse(input);
  const startedAt = Date.now();
  await requireOrganizationRole(data.organizationId, [...inboxWriteRoles]);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const initiatedBy = claims?.claims.sub;
  if (claimsError || !initiatedBy) throw new Error("Sign in is required.");
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", data.organizationId)
    .eq("id", data.conversationId)
    .maybeSingle();
  if (conversationError || !conversation)
    throw new Error("This conversation is unavailable in your workspace.");

  const run = await createAgentRun({
    organizationId: data.organizationId,
    initiatedBy,
    agentType: CONVERSATION_REPLY_DRAFT_AGENT.type,
    agentVersion: CONVERSATION_REPLY_DRAFT_AGENT.version,
    inputReference: {
      workflow: "conversation_reply_draft",
      conversation_id: conversation.id,
      channel: data.channel,
      prompt_version: AIOS_PROMPT_VERSIONS.conversationReplyDraft,
    },
  });
  const source = await loadConversationEvidence(
    data.organizationId,
    conversation.id,
  );
  const initialInspection = inspectConversationCopilotInput(source);
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "aios.input_safety_check",
    requestedAction: "model.input.prepare",
    decision: initialInspection.blocked ? "blocked" : "allowed",
    arguments: { conversation_id: conversation.id },
    result: initialInspection.audit,
  });
  if (initialInspection.blocked) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: initialInspection.errorCode,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message:
        "AIOS needs a bounded, safe conversation history before it can prepare a reply draft.",
    };
  }
  const budget = await loadOrganizationModelBudget(data.organizationId);
  const budgetBlock = modelBudgetBlockReason(budget);
  if (budgetBlock) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: budgetBlock.code,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message: budgetBlock.message,
    };
  }

  const gate = await gateAiosAction({
    organizationId: data.organizationId,
    action: "inbox.reply_draft.prepare",
    entityType: "conversation",
    entityId: conversation.id,
    payload: {
      ai_run_id: run.id,
      workflow: "conversation_reply_draft",
      channel: data.channel,
      external_message_sent: false,
    },
    rationale:
      "AIOS will create one internal reply draft from bounded conversation evidence. It cannot send the draft or make an external commitment.",
  });
  const allowed = gate.decision === "execute" || gate.decision === "draft";
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "inbox.reply_draft",
    requestedAction: "inbox.reply_draft.prepare",
    decision: allowed
      ? "allowed"
      : gate.decision === "approval_required"
        ? "approval_required"
        : "blocked",
    arguments: {
      conversation_id: conversation.id,
      channel: data.channel,
      external_message_sent: false,
    },
    result: gate as Json,
  });
  if (!allowed) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode:
        gate.decision === "approval_required"
          ? "HUMAN_APPROVAL_REQUIRED"
          : gate.decision === "observe"
            ? "AUTONOMY_OBSERVE_ONLY"
            : "AUTONOMY_POLICY_BLOCKED",
      approvalRequestId:
        gate.decision === "approval_required" ? gate.approvalId : null,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      status:
        gate.decision === "approval_required"
          ? ("approval_required" as const)
          : ("blocked" as const),
      message:
        gate.decision === "approval_required"
          ? "AIOS routed this internal draft request to a human approver. Nothing was sent."
          : gate.decision === "observe"
            ? "AIOS is observing this workflow and did not create a draft."
            : gate.reason,
      ...(gate.decision === "approval_required"
        ? { approvalId: gate.approvalId }
        : {}),
    };
  }
  return executeConversationCopilot({
    organizationId: data.organizationId,
    conversationId: conversation.id,
    runId: run.id,
    initiatedBy,
    channel: data.channel,
    source,
    inspection: initialInspection,
    safetyAlreadyRecorded: true,
  });
}

/** Resumes exactly the approved Sales Copilot run under current policy. */
export async function resumeApprovedConversationReplyDraft(
  input: z.infer<typeof resumeConversationCopilotSchema>,
) {
  const data = resumeConversationCopilotSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "operations",
    "finance",
  ]);
  const supabase = await createSupabaseServerClient();
  const [{ data: approval }, { data: run }] = await Promise.all([
    supabase
      .from("approval_requests")
      .select("id, action, status, entity_id")
      .eq("organization_id", data.organizationId)
      .eq("id", data.approvalId)
      .maybeSingle(),
    supabase
      .from("ai_runs")
      .select("id, status, agent_type, initiated_by, input_reference, approval_request_id")
      .eq("organization_id", data.organizationId)
      .eq("id", data.runId)
      .maybeSingle(),
  ]);
  const reference = conversationRunReferenceSchema.safeParse(
    run?.input_reference,
  );
  if (
    !approval ||
    approval.status !== "approved" ||
    approval.action !== "inbox.reply_draft.prepare" ||
    approval.entity_id !== data.conversationId ||
    !run ||
    run.agent_type !== CONVERSATION_REPLY_DRAFT_AGENT.type ||
    run.approval_request_id !== approval.id ||
    run.status === "succeeded" ||
    !run.initiated_by ||
    !reference.success ||
    reference.data.conversation_id !== data.conversationId
  )
    throw new Error("This approved Sales Copilot run cannot be resumed.");
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "approval.resume",
    requestedAction: "inbox.reply_draft.prepare",
    decision: "allowed",
    arguments: { approval_id: approval.id },
    result: { status: "approved" },
  });
  return executeConversationCopilot({
    organizationId: data.organizationId,
    conversationId: data.conversationId,
    runId: run.id,
    initiatedBy: run.initiated_by,
    channel: reference.data.channel,
    approvalRequestId: approval.id,
    resumed: true,
  });
}

/** Records one human decision for the exact current AI draft revision. */
export async function reviewConversationReplyDraft(
  input: ConversationDraftReviewInput,
) {
  const data = conversationDraftReviewInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [...inboxWriteRoles]);
  const supabase = await createSupabaseServerClient();
  const { data: review, error } = await supabase
    .rpc("review_ai_message_draft", {
      target_organization_id: data.organizationId,
      target_message_draft_id: data.draftId,
      target_decision: data.decision,
      ...(data.note ? { target_note: data.note } : {}),
    })
    .single();
  if (error?.code === "23505")
    throw new Error(
      "This exact draft revision already has a human decision. Revise it before reviewing again.",
    );
  if (error?.code === "22023")
    throw new Error(
      "This review is invalid for the current Sales Copilot draft revision.",
    );
  if (error?.code === "P0002")
    throw new Error("This Sales Copilot draft is no longer available.");
  if (error || !review)
    throw new Error("The Sales Copilot draft could not be reviewed.");
  return {
    review,
    message:
      review.decision === "approved"
        ? "Draft approved for human use. Nothing was sent."
        : review.decision === "changes_requested"
          ? "Changes requested and recorded. Nothing was sent."
          : "Draft rejected with feedback. Nothing was sent.",
  };
}
