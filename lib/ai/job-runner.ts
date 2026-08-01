import "server-only";

import {
  inspectItineraryDraftInput,
  inspectKnowledgeAnswerInput,
  inspectLeadIntakeInput,
} from "./input-safety";
import {
  AiosProviderNotConfiguredError,
  getAiosProviderStatus,
  runItineraryDraft,
  runKnowledgeAnswer,
  runLeadIntake,
} from "./openai-provider";
import {
  deadLetterModelJob,
  listRunnableModelJobs,
  claimModelJobById,
  settleModelJob,
} from "./jobs";
import { modelJobPayloadSchema } from "./job-contracts";
import {
  loadOrganizationModelBudget,
  modelBudgetBlockReason,
} from "./execution-policy";
import { AIOS_PROMPT_VERSIONS } from "./prompt-versions";
import { knowledgeAnswerNeedsHumanReview } from "./knowledge-answer";
import { estimateModelRunCost } from "./pricing";
import {
  completeAgentRun,
  recordAgentToolCall,
  resumeAgentRun,
} from "./runtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import type { Json } from "../../types/database";
import {
  knowledgeAnswerRunReferenceSchema,
  loadKnowledgeAnswerEvidenceForActor,
} from "../knowledge/answer-evidence";

type JobOutcome = "succeeded" | "retried" | "dead_lettered" | "skipped";

async function markPermanentFailure(input: {
  organizationId: string;
  runId: string;
  jobId: string;
  workerId: string;
  approvalRequestId: string | null;
  errorCode: string;
  startedAt: number;
}) {
  await recordAgentToolCall({
    organizationId: input.organizationId,
    runId: input.runId,
    toolName: "aios.job_worker",
    requestedAction: "model.execute",
    decision: "blocked",
    arguments: { job_id: input.jobId },
    result: { error_code: input.errorCode },
  });
  await deadLetterModelJob({
    jobId: input.jobId,
    workerId: input.workerId,
    errorCode: input.errorCode,
  });
  await completeAgentRun({
    organizationId: input.organizationId,
    runId: input.runId,
    status: "blocked",
    errorCode: input.errorCode,
    durationMs: Date.now() - input.startedAt,
    approvalRequestId: input.approvalRequestId,
  });
  return "dead_lettered" as const;
}

async function markRetryableFailure(input: {
  organizationId: string;
  runId: string;
  jobId: string;
  workerId: string;
  attempt: number;
  approvalRequestId: string | null;
  errorCode: string;
  startedAt: number;
}) {
  await recordAgentToolCall({
    organizationId: input.organizationId,
    runId: input.runId,
    toolName: "aios.job_worker",
    requestedAction: "model.execute",
    decision: "failed",
    arguments: { job_id: input.jobId, attempt: input.attempt },
    result: { error_code: input.errorCode },
  });
  const settled = await settleModelJob({
    jobId: input.jobId,
    workerId: input.workerId,
    attempt: input.attempt,
    succeeded: false,
    errorCode: input.errorCode,
  });
  await completeAgentRun({
    organizationId: input.organizationId,
    runId: input.runId,
    status: "failed",
    errorCode: input.errorCode,
    durationMs: Date.now() - input.startedAt,
    approvalRequestId: input.approvalRequestId,
  });
  return settled.job_status === "dead_letter"
    ? ("dead_lettered" as const)
    : ("retried" as const);
}

async function processRunnableJob(
  job: Awaited<ReturnType<typeof listRunnableModelJobs>>[number],
): Promise<JobOutcome> {
  const admin = createSupabaseAdminClient();
  const { data: run, error: runError } = await admin
    .from("ai_runs")
    .select(
      "id, status, approval_request_id, initiated_by, input_reference",
    )
    .eq("id", job.ai_run_id)
    .eq("organization_id", job.organization_id)
    .maybeSingle();
  if (runError || !run) throw runError ?? new Error("AI run is unavailable.");

  if (run.status === "succeeded") {
    const claimed = await claimModelJobById({
      organizationId: job.organization_id,
      aiRunId: job.ai_run_id,
      jobId: job.id,
      jobType: job.job_type,
    });
    if (!claimed) return "skipped";
    await settleModelJob({
      jobId: job.id,
      workerId: claimed.workerId,
      attempt: claimed.job_attempts,
      succeeded: true,
    });
    return "succeeded";
  }

  const parsedPayload = modelJobPayloadSchema.safeParse(job.payload);
  const budget = await loadOrganizationModelBudget(job.organization_id);
  const budgetBlock = modelBudgetBlockReason(budget);
  const selectedStatus = getAiosProviderStatus(budget.selectedModelProvider);
  if (
    budgetBlock?.code === "AI_MODEL_EXECUTION_DISABLED" ||
    budgetBlock?.code === "AI_DAILY_RUN_LIMIT" ||
    !selectedStatus.configured
  ) {
    return "skipped";
  }

  const claimed = await claimModelJobById({
    organizationId: job.organization_id,
    aiRunId: job.ai_run_id,
    jobId: job.id,
    jobType: job.job_type,
  });
  if (!claimed) return "skipped";
  const startedAt = Date.now();

  if (!parsedPayload.success) {
    return markPermanentFailure({
      organizationId: job.organization_id,
      runId: run.id,
      jobId: job.id,
      workerId: claimed.workerId,
      approvalRequestId: run.approval_request_id,
      errorCode: "AI_JOB_PAYLOAD_INVALID",
      startedAt,
    });
  }
  const payload = parsedPayload.data;
  const payloadFallback = payload.fallback_provider ?? null;
  if (
    payload.workflow !== job.job_type ||
    payload.provider !== budget.selectedModelProvider ||
    payloadFallback !== budget.fallbackModelProvider ||
    !budget.allowedModelProviders.includes(payload.provider)
  ) {
    return markPermanentFailure({
      organizationId: job.organization_id,
      runId: run.id,
      jobId: job.id,
      workerId: claimed.workerId,
      approvalRequestId: run.approval_request_id,
      errorCode: "AI_JOB_POLICY_STALE",
      startedAt,
    });
  }
  const currentPromptVersion =
    payload.workflow === "lead_intake"
      ? AIOS_PROMPT_VERSIONS.leadIntake
      : payload.workflow === "itinerary_draft"
        ? AIOS_PROMPT_VERSIONS.itineraryDraft
        : AIOS_PROMPT_VERSIONS.knowledgeAnswer;
  if (payload.prompt_version !== currentPromptVersion) {
    return markPermanentFailure({
      organizationId: job.organization_id,
      runId: run.id,
      jobId: job.id,
      workerId: claimed.workerId,
      approvalRequestId: run.approval_request_id,
      errorCode: "AI_PROMPT_VERSION_STALE",
      startedAt,
    });
  }
  await resumeAgentRun({
    organizationId: job.organization_id,
    runId: run.id,
  });
  await recordAgentToolCall({
    organizationId: job.organization_id,
    runId: run.id,
    toolName: "aios.job_worker",
    requestedAction: "model.execute",
    decision: "allowed",
    arguments: {
      job_id: job.id,
      attempt: claimed.job_attempts,
      workflow: payload.workflow,
    },
    result: { lease: "claimed" },
  });

  try {
    if (payload.workflow === "lead_intake") {
      const { data: deal, error } = await admin
        .from("deals")
        .select(
          "id, title, source, destination, travel_start, travel_end, traveller_count, notes",
        )
        .eq("id", payload.deal_id)
        .eq("organization_id", job.organization_id)
        .maybeSingle();
      if (error) throw error;
      if (!deal)
        return markPermanentFailure({
          organizationId: job.organization_id,
          runId: run.id,
          jobId: job.id,
          workerId: claimed.workerId,
          approvalRequestId: run.approval_request_id,
          errorCode: "AI_JOB_ENTITY_MISSING",
          startedAt,
        });
      const inspected = inspectLeadIntakeInput({
        id: deal.id,
        title: deal.title,
        source: deal.source,
        destination: deal.destination,
        travelStart: deal.travel_start,
        travelEnd: deal.travel_end,
        travellerCount: deal.traveller_count,
        notes: deal.notes,
      });
      if (inspected.blocked)
        return markPermanentFailure({
          organizationId: job.organization_id,
          runId: run.id,
          jobId: job.id,
          workerId: claimed.workerId,
          approvalRequestId: run.approval_request_id,
          errorCode: inspected.errorCode ?? "AI_INPUT_SAFETY_BLOCKED",
          startedAt,
        });
      const modelResult = await runLeadIntake(
        inspected.source,
        payload.provider,
        payloadFallback,
      );
      await settleModelJob({
        jobId: job.id,
        workerId: claimed.workerId,
        attempt: claimed.job_attempts,
        succeeded: true,
      });
      const estimatedCost = await estimateModelRunCost({
        organizationId: job.organization_id,
        provider: modelResult.provider,
        model: modelResult.model,
        inputTokens: modelResult.inputTokens,
        outputTokens: modelResult.outputTokens,
      });
      await completeAgentRun({
        organizationId: job.organization_id,
        runId: run.id,
        status: "succeeded",
        result: {
          extraction: modelResult.extraction,
          primary_provider: payload.provider,
          provider: modelResult.provider,
          attempted_providers: modelResult.attemptedProviders,
          fallback_used: modelResult.fallbackUsed,
          model: modelResult.model,
          prompt_version: modelResult.promptVersion,
          response_id: modelResult.responseId,
          input_safety: inspected.audit,
        } as Json,
        citations: modelResult.extraction.citations as Json,
        durationMs: Date.now() - startedAt,
        inputTokens: modelResult.inputTokens,
        outputTokens: modelResult.outputTokens,
        estimatedCost,
        approvalRequestId: run.approval_request_id,
      });
      return "succeeded";
    }

    if (payload.workflow === "knowledge_answer") {
      const reference = knowledgeAnswerRunReferenceSchema.safeParse(
        run.input_reference,
      );
      if (!reference.success || !run.initiated_by)
        return markPermanentFailure({
          organizationId: job.organization_id,
          runId: run.id,
          jobId: job.id,
          workerId: claimed.workerId,
          approvalRequestId: run.approval_request_id,
          errorCode: "AI_JOB_REFERENCE_INVALID",
          startedAt,
        });
      const evidence = await loadKnowledgeAnswerEvidenceForActor({
        organizationId: job.organization_id,
        actorId: run.initiated_by,
        sectionIds: reference.data.section_ids,
      });
      const freshEvidence = evidence.filter((item) => !item.isStale);
      if (freshEvidence.length === 0)
        return markPermanentFailure({
          organizationId: job.organization_id,
          runId: run.id,
          jobId: job.id,
          workerId: claimed.workerId,
          approvalRequestId: run.approval_request_id,
          errorCode: "KNOWLEDGE_EVIDENCE_UNAVAILABLE",
          startedAt,
        });
      const inspected = inspectKnowledgeAnswerInput({
        question: reference.data.question,
        evidence: freshEvidence,
      });
      if (inspected.blocked)
        return markPermanentFailure({
          organizationId: job.organization_id,
          runId: run.id,
          jobId: job.id,
          workerId: claimed.workerId,
          approvalRequestId: run.approval_request_id,
          errorCode:
            inspected.errorCode ?? "UNTRUSTED_KNOWLEDGE_CONTENT",
          startedAt,
        });
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
      const modelResult = await runKnowledgeAnswer(
        {
          question: inspected.input.question,
          evidence: safeEvidence,
        },
        payload.provider,
        payloadFallback,
      );
      await settleModelJob({
        jobId: job.id,
        workerId: claimed.workerId,
        attempt: claimed.job_attempts,
        succeeded: true,
      });
      const estimatedCost = await estimateModelRunCost({
        organizationId: job.organization_id,
        provider: modelResult.provider,
        model: modelResult.model,
        inputTokens: modelResult.inputTokens,
        outputTokens: modelResult.outputTokens,
      });
      const humanReviewRequired = knowledgeAnswerNeedsHumanReview(
        inspected.input.question,
      );
      await completeAgentRun({
        organizationId: job.organization_id,
        runId: run.id,
        status: "succeeded",
        result: {
          answer_state: humanReviewRequired
            ? "needs_human_review"
            : "supported",
          answer: modelResult.answer,
          primary_provider: payload.provider,
          provider: modelResult.provider,
          attempted_providers: modelResult.attemptedProviders,
          fallback_used: modelResult.fallbackUsed,
          model: modelResult.model,
          prompt_version: modelResult.promptVersion,
          response_id: modelResult.responseId,
          input_safety: inspected.audit,
        } as Json,
        citations: safeEvidence.map((item) => ({
          sourceType: "knowledge",
          sourceId: item.sourceId,
          label: item.citationLabel,
        })) as Json,
        durationMs: Date.now() - startedAt,
        inputTokens: modelResult.inputTokens,
        outputTokens: modelResult.outputTokens,
        estimatedCost,
        approvalRequestId: run.approval_request_id,
      });
      return "succeeded";
    }

    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("id, name, start_date, end_date")
      .eq("id", payload.trip_id)
      .eq("organization_id", job.organization_id)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip)
      return markPermanentFailure({
        organizationId: job.organization_id,
        runId: run.id,
        jobId: job.id,
        workerId: claimed.workerId,
        approvalRequestId: run.approval_request_id,
        errorCode: "AI_JOB_ENTITY_MISSING",
        startedAt,
      });
    const { data: items, error: itemsError } = await admin
      .from("itinerary_items")
      .select("day_number, item_type, title")
      .eq("organization_id", job.organization_id)
      .eq("trip_id", trip.id)
      .order("day_number")
      .order("position");
    if (itemsError) throw itemsError;
    const inspected = inspectItineraryDraftInput({
      id: trip.id,
      name: trip.name,
      startDate: trip.start_date,
      endDate: trip.end_date,
      items: (items || []).map((item) => ({
        dayNumber: item.day_number,
        itemType: item.item_type,
        title: item.title,
      })),
    });
    if (inspected.blocked)
      return markPermanentFailure({
        organizationId: job.organization_id,
        runId: run.id,
        jobId: job.id,
        workerId: claimed.workerId,
        approvalRequestId: run.approval_request_id,
        errorCode: inspected.errorCode ?? "AI_INPUT_SAFETY_BLOCKED",
        startedAt,
      });
    const modelResult = await runItineraryDraft(
      inspected.source,
      payload.provider,
      payloadFallback,
    );
    await settleModelJob({
      jobId: job.id,
      workerId: claimed.workerId,
      attempt: claimed.job_attempts,
      succeeded: true,
    });
    const estimatedCost = await estimateModelRunCost({
      organizationId: job.organization_id,
      provider: modelResult.provider,
      model: modelResult.model,
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens,
    });
    await completeAgentRun({
      organizationId: job.organization_id,
      runId: run.id,
      status: "succeeded",
      result: {
        draft: modelResult.draft,
        primary_provider: payload.provider,
        provider: modelResult.provider,
        attempted_providers: modelResult.attemptedProviders,
        fallback_used: modelResult.fallbackUsed,
        model: modelResult.model,
        prompt_version: modelResult.promptVersion,
        response_id: modelResult.responseId,
        input_safety: inspected.audit,
      } as Json,
      citations: modelResult.draft.citations as Json,
      durationMs: Date.now() - startedAt,
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens,
      estimatedCost,
      approvalRequestId: run.approval_request_id,
    });
    return "succeeded";
  } catch (error) {
    const errorCode =
      error instanceof AiosProviderNotConfiguredError
        ? "AI_PROVIDER_NOT_CONFIGURED"
        : payload.workflow === "lead_intake"
          ? "LEAD_INTAKE_FAILED"
          : payload.workflow === "itinerary_draft"
            ? "ITINERARY_DRAFT_FAILED"
            : "KNOWLEDGE_ANSWER_FAILED";
    return markRetryableFailure({
      organizationId: job.organization_id,
      runId: run.id,
      jobId: job.id,
      workerId: claimed.workerId,
      attempt: claimed.job_attempts,
      approvalRequestId: run.approval_request_id,
      errorCode,
      startedAt,
    });
  }
}

export async function runDueModelJobs(limit = 5, organizationId?: string) {
  const jobs = await listRunnableModelJobs(limit, organizationId);
  const summary: Record<JobOutcome, number> = {
    succeeded: 0,
    retried: 0,
    dead_lettered: 0,
    skipped: 0,
  };
  for (const job of jobs) {
    try {
      summary[await processRunnableJob(job)] += 1;
    } catch {
      summary.skipped += 1;
    }
  }
  return { inspected: jobs.length, ...summary };
}
