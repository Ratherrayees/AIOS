"use server";

import { gateAiosAction } from "./aios";
import { requireActiveMembership } from "../../lib/authorization";
import {
  inspectKnowledgeAnswerInput,
} from "../../lib/ai/input-safety";
import {
  knowledgeAnswerNeedsHumanReview,
  knowledgeAnswerQuestionSchema,
  type KnowledgeAnswer,
  type KnowledgeAnswerEvidence,
} from "../../lib/ai/knowledge-answer";
import {
  AiosProviderNotConfiguredError,
  getAiosProviderStatus,
  runKnowledgeAnswer,
} from "../../lib/ai/openai-provider";
import {
  loadOrganizationModelBudget,
  modelBudgetBlockReason,
} from "../../lib/ai/execution-policy";
import {
  AiosJobNotAvailableError,
  prepareModelJob,
  settleModelJob,
} from "../../lib/ai/jobs";
import { AIOS_PROMPT_VERSIONS } from "../../lib/ai/prompt-versions";
import { estimateModelRunCost } from "../../lib/ai/pricing";
import {
  completeAgentRun,
  createAgentRun,
  KNOWLEDGE_ANSWER_AGENT,
  recordAgentToolCall,
  setAgentRunInputReference,
} from "../../lib/ai/runtime";
import { knowledgeSearchResultSchema } from "../../lib/knowledge/schemas";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import type { Json } from "../../types/database";

export type KnowledgeAnswerResponse = {
  runId: string;
  state:
    | "supported"
    | "needs_human_review"
    | "unsupported"
    | "stale"
    | "blocked";
  message: string;
  answer?: KnowledgeAnswer;
  evidence: KnowledgeAnswerEvidence[];
  provider?: string;
  model?: string;
};

function toEvidence(
  results: Array<
    ReturnType<typeof knowledgeSearchResultSchema.parse>
  >,
): KnowledgeAnswerEvidence[] {
  return results.map((result) => ({
    sectionId: result.section_id,
    sourceId: result.source_id,
    sourceTitle: result.source_title,
    versionLabel: result.version_label,
    sourceUrl: result.source_url,
    heading: result.heading,
    excerpt: result.excerpt,
    citationLabel: result.citation_label,
    reviewDueOn: result.review_due_on,
    isStale: result.is_stale,
  }));
}

function runCitations(evidence: KnowledgeAnswerEvidence[]) {
  return evidence.map((item) => ({
    sourceType: "knowledge",
    sourceId: item.sourceId,
    label: item.citationLabel,
  }));
}

export async function composeKnowledgeAnswer(input: {
  organizationId: string;
  question: string;
}): Promise<KnowledgeAnswerResponse> {
  const data = knowledgeAnswerQuestionSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const initiatedBy = claims?.claims.sub;
  if (claimsError || !initiatedBy) throw new Error("Sign in is required.");

  const initialInspection = inspectKnowledgeAnswerInput({
    question: data.question,
    evidence: [],
  });
  const startedAt = Date.now();
  const run = await createAgentRun({
    organizationId: data.organizationId,
    initiatedBy,
    agentType: KNOWLEDGE_ANSWER_AGENT.type,
    agentVersion: KNOWLEDGE_ANSWER_AGENT.version,
    inputReference: {
      workflow: "knowledge_answer",
      prompt_version: AIOS_PROMPT_VERSIONS.knowledgeAnswer,
      question: initialInspection.input.question,
      input_safety: initialInspection.audit,
    },
  });
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "aios.input_safety_check",
    requestedAction: "model.input.prepare",
    decision: initialInspection.blocked ? "blocked" : "allowed",
    arguments: { question_character_count: data.question.length },
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
      state: "blocked",
      message:
        "AIOS detected instruction-like or oversized question content. Rewrite the question as a plain evidence request.",
      evidence: [],
    };
  }

  const { data: retrieved, error: retrievalError } = await supabase.rpc(
    "search_approved_knowledge",
    {
      target_organization_id: data.organizationId,
      target_query: initialInspection.input.question,
      target_limit: 8,
    },
  );
  if (retrievalError) throw retrievalError;
  const evidence = toEvidence(
    knowledgeSearchResultSchema.array().parse(retrieved ?? []),
  );
  const freshEvidence = evidence.filter((item) => !item.isStale);
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "knowledge.search_approved",
    requestedAction: "knowledge.retrieve",
    decision: "allowed",
    arguments: { result_limit: 8 },
    result: {
      result_count: evidence.length,
      fresh_count: freshEvidence.length,
      stale_count: evidence.length - freshEvidence.length,
    },
  });

  if (evidence.length === 0) {
    const result = {
      answer_state: "unsupported",
      message:
        "No approved evidence supports an answer. AIOS will not guess.",
    };
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "succeeded",
      result,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      state: "unsupported",
      message: result.message,
      evidence: [],
    };
  }

  if (freshEvidence.length === 0) {
    const message =
      "Matching evidence exists, but every source is past its review date. A human must renew it before AIOS composes an answer.";
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "succeeded",
      result: { answer_state: "stale", message },
      citations: runCitations(evidence) as Json,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      state: "stale",
      message,
      evidence,
    };
  }

  const inspected = inspectKnowledgeAnswerInput({
    question: data.question,
    evidence: freshEvidence,
  });
  await setAgentRunInputReference({
    organizationId: data.organizationId,
    runId: run.id,
    inputReference: {
      workflow: "knowledge_answer",
      prompt_version: AIOS_PROMPT_VERSIONS.knowledgeAnswer,
      question: inspected.input.question,
      section_ids: freshEvidence.map((item) => item.sectionId),
      input_safety: inspected.audit,
    },
  });
  if (inspected.blocked) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: inspected.errorCode,
      citations: runCitations(freshEvidence) as Json,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      state: "blocked",
      message:
        "A retrieved passage contains instruction-like content. AIOS stopped before the model boundary and routed the source back to human review.",
      evidence: freshEvidence,
    };
  }

  const safeEvidence = freshEvidence.map((item) => {
    const safe = inspected.input.evidence.find(
      (candidate) => candidate.sectionId === item.sectionId,
    );
    return {
      ...item,
      heading: safe?.heading ?? item.heading,
      excerpt: safe?.excerpt ?? item.excerpt,
    };
  });
  const modelBudget = await loadOrganizationModelBudget(data.organizationId);
  const budgetBlock = modelBudgetBlockReason(modelBudget);
  if (budgetBlock) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: budgetBlock.code,
      citations: runCitations(safeEvidence) as Json,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      state: "blocked",
      message: budgetBlock.message,
      evidence: safeEvidence,
    };
  }

  const gate = await gateAiosAction({
    organizationId: data.organizationId,
    action: "knowledge.answer.compose",
    entityType: "knowledge_source",
    entityId: safeEvidence[0]?.sourceId,
    payload: {
      ai_run_id: run.id,
      evidence_count: safeEvidence.length,
    },
    rationale:
      "AIOS will compose an internal answer only from permission-visible approved passages. It cannot mutate records or act externally.",
  });
  const gateAllowed =
    gate.decision === "execute" || gate.decision === "draft";
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "knowledge.answer_compose",
    requestedAction: "knowledge.answer.compose",
    decision: gateAllowed
      ? "allowed"
      : gate.decision === "approval_required"
        ? "approval_required"
        : "blocked",
    arguments: { evidence_count: safeEvidence.length },
    result: gate as Json,
  });
  if (!gateAllowed) {
    const message =
      gate.decision === "approval_required"
        ? "This Answer Desk run is waiting for the configured human approval."
        : gate.decision === "observe"
          ? "The Answer Desk is in Observe mode. AIOS retrieved evidence but did not compose an answer."
          : gate.reason;
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
      citations: runCitations(safeEvidence) as Json,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      state: "blocked",
      message,
      evidence: safeEvidence,
    };
  }

  let modelJob: Awaited<ReturnType<typeof prepareModelJob>> | null = null;
  try {
    modelJob = await prepareModelJob({
      organizationId: data.organizationId,
      aiRunId: run.id,
      jobType: "knowledge_answer",
      payload: {
        workflow: "knowledge_answer",
        prompt_version: AIOS_PROMPT_VERSIONS.knowledgeAnswer,
        provider: modelBudget.selectedModelProvider,
      },
    });
    const modelResult = await runKnowledgeAnswer(
      {
        question: inspected.input.question,
        evidence: safeEvidence,
      },
      modelBudget.selectedModelProvider,
    );
    await settleModelJob({
      jobId: modelJob.job_id,
      workerId: modelJob.workerId,
      attempt: modelJob.job_attempts,
      succeeded: true,
    });
    const estimatedCost = await estimateModelRunCost({
      organizationId: data.organizationId,
      provider: modelResult.provider,
      model: modelResult.model,
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens,
    });
    const humanReviewRequired = knowledgeAnswerNeedsHumanReview(data.question);
    const answer = {
      ...modelResult.answer,
      caveats: [
        ...modelResult.answer.caveats,
        ...(evidence.length > freshEvidence.length
          ? [
              `${evidence.length - freshEvidence.length} stale passage${evidence.length - freshEvidence.length === 1 ? " was" : "s were"} excluded from composition.`,
            ]
          : []),
      ],
    };
    const state = humanReviewRequired
      ? ("needs_human_review" as const)
      : ("supported" as const);
    await recordAgentToolCall({
      organizationId: data.organizationId,
      runId: run.id,
      toolName: "model.structured_output",
      requestedAction: "knowledge.answer.compose",
      decision: "allowed",
      arguments: getAiosProviderStatus(modelBudget.selectedModelProvider),
      result: {
        claims: answer.claims.length,
        human_review_required: humanReviewRequired,
      },
    });
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "succeeded",
      result: {
        answer_state: state,
        answer,
        provider: modelResult.provider,
        model: modelResult.model,
        prompt_version: modelResult.promptVersion,
        response_id: modelResult.responseId,
        input_safety: inspected.audit,
      } as Json,
      citations: runCitations(safeEvidence) as Json,
      durationMs: Date.now() - startedAt,
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens,
      estimatedCost,
    });
    return {
      runId: run.id,
      state,
      message: humanReviewRequired
        ? "AIOS composed a cited advisory, but this topic requires a human decision."
        : "AIOS composed a grounded answer from approved evidence.",
      answer,
      evidence: safeEvidence,
      provider: modelResult.provider,
      model: modelResult.model,
    };
  } catch (error) {
    const errorCode =
      error instanceof AiosProviderNotConfiguredError
        ? "AI_PROVIDER_NOT_CONFIGURED"
        : error instanceof AiosJobNotAvailableError
          ? "AI_JOB_NOT_AVAILABLE"
          : "KNOWLEDGE_ANSWER_FAILED";
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
      organizationId: data.organizationId,
      runId: run.id,
      toolName: "model.structured_output",
      requestedAction: "knowledge.answer.compose",
      decision: "failed",
      arguments: getAiosProviderStatus(modelBudget.selectedModelProvider),
      result: { error_code: errorCode },
    });
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "failed",
      errorCode,
      citations: runCitations(safeEvidence) as Json,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      state: "blocked",
      message:
        errorCode === "AI_PROVIDER_NOT_CONFIGURED"
          ? "The selected AIOS provider is not configured. Approved evidence remains visible below."
          : errorCode === "AI_JOB_NOT_AVAILABLE"
            ? "This Answer Desk job is already running or waiting for its retry window."
            : "AIOS rejected the model output because it could not prove a safely grounded cited answer.",
      evidence: safeEvidence,
    };
  }
}
