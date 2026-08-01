"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { gateAiosAction } from "./aios";
import { recordAuditEvent } from "../../lib/audit";
import {
  requireActiveMembership,
  requireOrganizationRole,
} from "../../lib/authorization";
import {
  AiosProviderNotConfiguredError,
  getAiosProviderStatus,
  runItineraryDraft,
  runLeadIntake,
} from "../../lib/ai/openai-provider";
import {
  parseItineraryDraft,
  parseLeadExtraction,
} from "../../lib/ai/contracts";
import {
  inspectItineraryDraftInput,
  inspectLeadIntakeInput,
} from "../../lib/ai/input-safety";
import { assessLeadHealth } from "../../lib/crm/lead-health";
import { assessLeadSla } from "../../lib/crm/lead-sla";
import { assessItineraryReadiness } from "../../lib/crm/itinerary-readiness";
import {
  inboxSlaEscalationLevel,
  inboxSlaPriority,
} from "../../lib/crm/inbox-sla";
import {
  loadOrganizationModelBudget,
  modelBudgetBlockReason,
} from "../../lib/ai/execution-policy";
import {
  AiosJobNotAvailableError,
  prepareModelJob,
  settleModelJob,
} from "../../lib/ai/jobs";
import {
  completeAgentRun,
  createAgentRun,
  INBOX_SLA_TRIAGE_AGENT,
  ITINERARY_DRAFT_AGENT,
  ITINERARY_READINESS_AGENT,
  LEAD_INTAKE_AGENT,
  recordAgentToolCall,
  resumeAgentRun,
} from "../../lib/ai/runtime";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { AIOS_PROMPT_VERSIONS } from "../../lib/ai/prompt-versions";
import { estimateModelRunCost } from "../../lib/ai/pricing";
import type { Json } from "../../types/database";

const leadIntakeInputSchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
});
const leadRoutingInputSchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
});
const leadTriageInputSchema = z.object({ organizationId: z.uuid() });
const inboxSlaTriageInputSchema = z.object({ organizationId: z.uuid() });
const itineraryReadinessTaskSchema = z.object({ organizationId: z.uuid(), tripId: z.uuid() });
const itineraryDraftInputSchema = z.object({ organizationId: z.uuid(), tripId: z.uuid() });
const itineraryDraftHistorySchema = z.object({
  organizationId: z.uuid(),
  tripIds: z.array(z.uuid()).max(100),
});

/** AIOS may create one low-risk internal readiness task, never a booking or message. */
export async function createItineraryReadinessTask(input: z.infer<typeof itineraryReadinessTaskSchema>) {
  const data = itineraryReadinessTaskSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const actorId = claims?.claims.sub;
  if (claimsError || !actorId) throw new Error("Sign in is required.");
  const { data: trip, error: tripError } = await supabase.from("trips").select("id, name, deal_id, start_date, end_date").eq("id", data.tripId).eq("organization_id", data.organizationId).maybeSingle();
  if (tripError || !trip) throw tripError ?? new Error("This trip is not available in this workspace.");
  const { data: items, error: itemsError } = await supabase.from("itinerary_items").select("day_number, item_type").eq("organization_id", data.organizationId).eq("trip_id", trip.id);
  if (itemsError) throw itemsError;
  const readiness = assessItineraryReadiness({ startDate: trip.start_date, endDate: trip.end_date, items: (items || []).map((item) => ({ dayNumber: item.day_number, itemType: item.item_type })) });
  const startedAt = Date.now();
  const run = await createAgentRun({ organizationId: data.organizationId, initiatedBy: actorId, agentType: ITINERARY_READINESS_AGENT.type, agentVersion: ITINERARY_READINESS_AGENT.version, inputReference: { trip_id: trip.id } });
  if (readiness.status === "ready") {
    await recordAgentToolCall({ organizationId: data.organizationId, runId: run.id, toolName: "itinerary.readiness.assess", requestedAction: "itinerary.readiness.assess", decision: "allowed", arguments: { trip_id: trip.id }, result: readiness });
    await completeAgentRun({ organizationId: data.organizationId, runId: run.id, status: "succeeded", result: { readiness, follow_up: "not_needed" }, durationMs: Date.now() - startedAt });
    return { status: "ready" as const, readiness, runId: run.id };
  }
  const title = `AIOS itinerary readiness: ${trip.name}`.slice(0, 500);
  const { data: existing } = await supabase.from("tasks").select("id").eq("organization_id", data.organizationId).eq("title", title).in("status", ["open", "in_progress"]).maybeSingle();
  if (existing) {
    await recordAgentToolCall({ organizationId: data.organizationId, runId: run.id, toolName: "task.deduplication", requestedAction: "internal.task.create", decision: "allowed", arguments: { trip_id: trip.id }, result: { existing_task_id: existing.id } });
    await completeAgentRun({ organizationId: data.organizationId, runId: run.id, status: "succeeded", result: { readiness, follow_up: "already_open", task_id: existing.id }, durationMs: Date.now() - startedAt });
    return { status: "already_open" as const, readiness, taskId: existing.id, runId: run.id };
  }
  const gate = await gateAiosAction({ organizationId: data.organizationId, action: "internal.task.create", entityType: "trip", entityId: trip.id, payload: { trip_id: trip.id, task_title: title }, rationale: readiness.signals.join(" ") });
  const toolDecision = gate.decision === "execute" ? "allowed" : gate.decision === "approval_required" ? "approval_required" : gate.decision === "blocked" ? "blocked" : "allowed";
  await recordAgentToolCall({ organizationId: data.organizationId, runId: run.id, toolName: "task.create", requestedAction: "internal.task.create", decision: toolDecision, arguments: { trip_id: trip.id }, result: { decision: gate.decision } });
  if (gate.decision !== "execute") {
    await completeAgentRun({ organizationId: data.organizationId, runId: run.id, status: "blocked", result: { readiness, decision: gate.decision }, errorCode: gate.decision.toUpperCase(), durationMs: Date.now() - startedAt, approvalRequestId: gate.decision === "approval_required" ? gate.approvalId : null });
    return { status: gate.decision, readiness, approvalId: gate.decision === "approval_required" ? gate.approvalId : undefined, runId: run.id };
  }
  const { data: task, error: taskError } = await supabase.from("tasks").insert({ organization_id: data.organizationId, deal_id: trip.deal_id, title }).select("id").single();
  if (taskError) throw taskError;
  await recordAuditEvent({ organizationId: data.organizationId, eventType: "record.created", entityType: "task", entityId: task.id, metadata: { event: "aios.itinerary_readiness_task_created", trip_id: trip.id } });
  await completeAgentRun({ organizationId: data.organizationId, runId: run.id, status: "succeeded", result: { readiness, follow_up: "created", task_id: task.id }, durationMs: Date.now() - startedAt });
  return { status: "created" as const, readiness, taskId: task.id, runId: run.id };
}

/**
 * Produces a cited, internal-only itinerary suggestion. It never writes trip
 * items, customer communications, pricing, or bookings; a teammate must add
 * each item through the normal planning workflow.
 */
export async function prepareItineraryDraft(
  input: z.infer<typeof itineraryDraftInputSchema>,
) {
  const data = itineraryDraftInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "trip_designer",
    "operations",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const initiatedBy = claims?.claims.sub;
  if (claimsError || !initiatedBy) throw new Error("Sign in is required.");

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, name, start_date, end_date")
    .eq("id", data.tripId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (tripError || !trip)
    throw new Error("This trip is not available in the active workspace.");
  const { data: items, error: itemsError } = await supabase
    .from("itinerary_items")
    .select("day_number, item_type, title")
    .eq("organization_id", data.organizationId)
    .eq("trip_id", trip.id)
    .order("day_number")
    .order("position");
  if (itemsError) throw itemsError;

  const itineraryInput = inspectItineraryDraftInput({
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
  const startedAt = Date.now();
  const run = await createAgentRun({
    organizationId: data.organizationId,
    initiatedBy,
    agentType: ITINERARY_DRAFT_AGENT.type,
    agentVersion: ITINERARY_DRAFT_AGENT.version,
    inputReference: {
      trip_id: trip.id,
      workflow: "itinerary_draft",
      prompt_version: AIOS_PROMPT_VERSIONS.itineraryDraft,
      input_safety: itineraryInput.audit,
    },
  });
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "aios.input_safety_check",
    requestedAction: "model.input.prepare",
    decision: itineraryInput.blocked ? "blocked" : "allowed",
    arguments: { trip_id: trip.id },
    result: itineraryInput.audit,
  });
  if (itineraryInput.blocked) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: itineraryInput.errorCode,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message:
        "AIOS detected untrusted or oversized itinerary content. A teammate must rewrite the affected planning text before model analysis.",
    };
  }

  const modelBudget = await loadOrganizationModelBudget(data.organizationId);
  const budgetBlock = modelBudgetBlockReason(modelBudget);
  if (budgetBlock) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: budgetBlock.code,
      durationMs: Date.now() - startedAt,
    });
    await recordAuditEvent({
      organizationId: data.organizationId,
      eventType: "ai.action_blocked",
      entityType: "ai_run",
      entityId: run.id,
      metadata: {
        event: budgetBlock.event,
        daily_limit: modelBudget.dailyRunLimit,
        daily_run_count: modelBudget.todayModelRunCount,
        selected_provider: modelBudget.selectedModelProvider,
      },
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message: budgetBlock.message,
    };
  }

  const gate = await gateAiosAction({
    organizationId: data.organizationId,
    action: "itinerary.draft.prepare",
    entityType: "trip",
    entityId: trip.id,
    payload: { ai_run_id: run.id, workflow: "itinerary_draft" },
    rationale:
      "AIOS proposes an internal itinerary draft from the selected trip. It cannot modify the trip or act outside the CRM.",
  });
  const toolDecision =
    gate.decision === "approval_required"
      ? "approval_required"
      : gate.decision === "blocked"
        ? "blocked"
        : "allowed";
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "crm.itinerary_draft",
    requestedAction: "itinerary.draft.prepare",
    decision: toolDecision,
    arguments: { trip_id: trip.id },
    result: gate as Json,
  });
  if (gate.decision === "approval_required" || gate.decision === "blocked") {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      approvalRequestId:
        gate.decision === "approval_required" ? gate.approvalId : null,
      errorCode:
        gate.decision === "approval_required"
          ? "HUMAN_APPROVAL_REQUIRED"
          : "AUTONOMY_POLICY_BLOCKED",
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      ...(gate.decision === "approval_required"
        ? { approvalId: gate.approvalId }
        : {}),
      message:
        gate.decision === "approval_required"
          ? "AIOS routed this draft to a human approver before model analysis."
          : gate.reason,
    };
  }

  let modelJob: Awaited<ReturnType<typeof prepareModelJob>> | null = null;
  let modelResult: Awaited<ReturnType<typeof runItineraryDraft>>;
  try {
    modelJob = await prepareModelJob({
      organizationId: data.organizationId,
      aiRunId: run.id,
      jobType: "itinerary_draft",
      payload: {
        workflow: "itinerary_draft",
        trip_id: trip.id,
        prompt_version: AIOS_PROMPT_VERSIONS.itineraryDraft,
        provider: modelBudget.selectedModelProvider,
        fallback_provider: modelBudget.fallbackModelProvider,
      },
    });
    modelResult = await runItineraryDraft(
      itineraryInput.source,
      modelBudget.selectedModelProvider,
      modelBudget.fallbackModelProvider,
    );
    await settleModelJob({
      jobId: modelJob.job_id,
      workerId: modelJob.workerId,
      attempt: modelJob.job_attempts,
      succeeded: true,
    });
  } catch (error) {
    const errorCode =
      error instanceof AiosProviderNotConfiguredError
        ? "AI_PROVIDER_NOT_CONFIGURED"
        : error instanceof AiosJobNotAvailableError
          ? "AI_JOB_NOT_AVAILABLE"
          : "ITINERARY_DRAFT_FAILED";
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
      requestedAction: "itinerary.draft.prepare",
      decision: "failed",
      arguments: getAiosProviderStatus(modelBudget.selectedModelProvider),
      result: { error_code: errorCode },
    });
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "failed",
      errorCode,
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message:
        errorCode === "AI_PROVIDER_NOT_CONFIGURED"
          ? "The selected AIOS model provider is not configured."
          : errorCode === "AI_JOB_NOT_AVAILABLE"
            ? "This AIOS job is already running or waiting for its retry window."
          : "AIOS could not validate a safe itinerary draft. No itinerary changes were made.",
    };
  }
  const estimatedCost = await estimateModelRunCost({
    organizationId: data.organizationId,
    provider: modelResult.provider,
    model: modelResult.model,
    inputTokens: modelResult.inputTokens,
    outputTokens: modelResult.outputTokens,
  });
  await completeAgentRun({
    organizationId: data.organizationId,
    runId: run.id,
    status: "succeeded",
    result: {
      draft: modelResult.draft,
      primary_provider: modelBudget.selectedModelProvider,
      provider: modelResult.provider,
      attempted_providers: modelResult.attemptedProviders,
      fallback_used: modelResult.fallbackUsed,
      model: modelResult.model,
      prompt_version: modelResult.promptVersion,
      response_id: modelResult.responseId,
      input_safety: itineraryInput.audit,
    } as Json,
    citations: modelResult.draft.citations as Json,
    durationMs: Date.now() - startedAt,
    inputTokens: modelResult.inputTokens,
    outputTokens: modelResult.outputTokens,
    estimatedCost,
  });
  return {
    runId: run.id,
    status: "succeeded" as const,
    draft: modelResult.draft,
  };
}

/** Returns only the latest validated internal preview for each requested trip. */
export async function getLatestItineraryDrafts(
  input: z.infer<typeof itineraryDraftHistorySchema>,
) {
  const data = itineraryDraftHistorySchema.parse(input);
  await requireActiveMembership(data.organizationId);
  if (data.tripIds.length === 0) return [];
  const requestedTripIds = new Set(data.tripIds);
  const supabase = await createSupabaseServerClient();
  const { data: runs, error } = await supabase
    .from("ai_runs")
    .select("input_reference, result")
    .eq("organization_id", data.organizationId)
    .eq("agent_type", ITINERARY_DRAFT_AGENT.type)
    .eq("status", "succeeded")
    .order("completed_at", { ascending: false })
    .limit(250);
  if (error) throw error;

  const drafts: Array<{ tripId: string; draft: ReturnType<typeof parseItineraryDraft> }> = [];
  const seenTripIds = new Set<string>();
  for (const run of runs || []) {
    const inputReference = recordFromJson(run.input_reference);
    const result = recordFromJson(run.result);
    const tripId = inputReference?.trip_id;
    const candidate = result?.draft;
    if (
      typeof tripId !== "string" ||
      !requestedTripIds.has(tripId) ||
      seenTripIds.has(tripId) ||
      !candidate
    )
      continue;
    try {
      drafts.push({ tripId, draft: parseItineraryDraft(candidate) });
      seenTripIds.add(tripId);
    } catch {
      // Ignore legacy or corrupted stored output; it must never be rendered as a draft.
    }
  }
  return drafts;
}

type TriageResult = {
  created: number;
  escalated: number;
  skipped: number;
  risks: number;
};

async function performAtRiskLeadTriage(
  organizationId: string,
): Promise<TriageResult> {
  const supabase = await createSupabaseServerClient();
  const [
    { data: deals, error },
    { data: escalationMembers, error: memberError },
    { data: openTriageTasks, error: taskLoadError },
  ] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, title, owner_id, next_step, last_activity_at, expected_close_at, first_response_due_at, first_responded_at, follow_up_due_at, sla_escalation_level",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .not("stage", "in", "(won,lost)")
      .limit(100),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("role", ["owner", "admin"])
      .order("created_at", { ascending: true })
      .limit(10),
    supabase
      .from("tasks")
      .select("id, deal_id, title")
      .eq("organization_id", organizationId)
      .in("status", ["open", "in_progress"])
      .like("title", "AIOS triage:%")
      .not("deal_id", "is", null)
      .limit(200),
  ]);
  if (error || memberError || taskLoadError)
    throw error || memberError || taskLoadError;

  const atRisk = (deals || [])
    .map((deal) => ({
      deal,
      health: assessLeadHealth({
        id: deal.id,
        name: deal.title,
        ownerId: deal.owner_id,
        nextStep: deal.next_step,
        lastActivityAt: deal.last_activity_at,
        expectedCloseAt: deal.expected_close_at,
        firstResponseDueAt: deal.first_response_due_at,
        firstRespondedAt: deal.first_responded_at,
        followUpDueAt: deal.follow_up_due_at,
      }),
      sla: assessLeadSla({
        firstResponseDueAt: deal.first_response_due_at,
        firstRespondedAt: deal.first_responded_at,
        followUpDueAt: deal.follow_up_due_at,
      }),
    }))
    .filter(({ health }) => health.severity !== "healthy")
    .slice(0, 25);
  let created = 0;
  let escalated = 0;
  let skipped = 0;
  const escalationOwnerId = escalationMembers?.[0]?.user_id ?? null;
  const taskByDealId = new Map(
    (openTriageTasks || []).map((task) => [task.deal_id, task]),
  );
  for (const { deal, health, sla } of atRisk) {
    const existingTask = taskByDealId.get(deal.id);
    const assigneeId =
      sla.level >= 2 ? escalationOwnerId || deal.owner_id : deal.owner_id;
    const title =
      `AIOS triage: ${sla.level ? `L${sla.level} · ` : ""}resolve ${health.reasons.map((reason) => reason.toLowerCase()).join(", ")}`.slice(
        0,
        500,
      );
    if (
      existingTask &&
      (!sla.level || deal.sla_escalation_level >= sla.level)
    ) {
      skipped += 1;
      continue;
    }
    const taskMutation = existingTask
      ? supabase
          .from("tasks")
          .update({
            title,
            assignee_id: assigneeId,
            due_at: sla.dueAt,
          })
          .eq("id", existingTask.id)
          .eq("organization_id", organizationId)
      : supabase.from("tasks").insert({
          organization_id: organizationId,
          deal_id: deal.id,
          assignee_id: assigneeId,
          due_at: sla.dueAt,
          title,
        });
    const { data: task, error: taskError } = await taskMutation
      .select("id, title")
      .maybeSingle();
    if (taskError?.code === "23505") {
      skipped += 1;
      continue;
    }
    if (taskError || !task)
      throw taskError || new Error("AIOS could not create a triage task.");
    if (existingTask) escalated += 1;
    else {
      created += 1;
      taskByDealId.set(deal.id, {
        id: task.id,
        deal_id: deal.id,
        title: task.title,
      });
    }
    if (sla.level > deal.sla_escalation_level) {
      const escalatedAt = new Date().toISOString();
      const { data: escalatedDeal, error: escalationError } = await supabase
        .from("deals")
        .update({
          sla_escalation_level: sla.level,
          sla_escalated_at: escalatedAt,
        })
        .eq("id", deal.id)
        .eq("organization_id", organizationId)
        .lt("sla_escalation_level", sla.level)
        .select("id")
        .maybeSingle();
      if (escalationError) throw escalationError;
      if (escalatedDeal) {
        const { error: escalationActivityError } = await supabase
          .from("activity_events")
          .insert({
            organization_id: organizationId,
            deal_id: deal.id,
            activity_type: "deal_sla_escalated",
            body: `AIOS escalated the ${sla.kind === "first_response" ? "first-response" : "follow-up"} SLA to level ${sla.level}.`,
            metadata: {
              escalation_level: sla.level,
              sla_kind: sla.kind,
              due_at: sla.dueAt,
              assigned_to: assigneeId,
              task_id: task.id,
            },
          });
        if (escalationActivityError) throw escalationActivityError;
      }
    }
    const { error: activityError } = await supabase
      .from("activity_events")
      .insert({
        organization_id: organizationId,
        deal_id: deal.id,
        activity_type: "task_created",
        body: `AIOS triage ${existingTask ? "escalated" : "created"} follow-up: ${task.title}`,
        metadata: {
          risk_reasons: health.reasons,
          escalation_level: sla.level,
          sla_kind: sla.kind,
          assigned_to: assigneeId,
        },
      });
    if (activityError) throw activityError;
    await recordAuditEvent({
      organizationId,
      eventType: "record.created",
      entityType: "task",
      entityId: task.id,
      metadata: {
        event: existingTask
          ? "aios.lead_triage_task_escalated"
          : "aios.lead_triage_task_created",
        deal_id: deal.id,
        risk_reasons: health.reasons,
        escalation_level: sla.level,
        sla_kind: sla.kind,
        assigned_to: assigneeId,
      },
    });
  }
  return { created, escalated, skipped, risks: atRisk.length };
}

/** Scans a bounded set of live deals and creates deduplicated internal risk follow-ups. */
export async function triageAtRiskLeads(
  input: z.infer<typeof leadTriageInputSchema>,
) {
  const data = leadTriageInputSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const gate = await gateAiosAction({
    organizationId: data.organizationId,
    action: "crm.lead.triage",
    entityType: "organization",
    entityId: null,
    payload: { maximum_deals: 25 },
    rationale:
      "AIOS will inspect live CRM risk signals and create at most one open internal follow-up per at-risk opportunity.",
  });
  if (gate.decision === "execute")
    return {
      status: "completed" as const,
      ...(await performAtRiskLeadTriage(data.organizationId)),
    };
  return {
    status: gate.decision,
    ...(gate.decision === "approval_required"
      ? { approvalId: gate.approvalId }
      : {}),
  };
}

/** Resumes the exact bounded internal triage workflow after a human approval. */
export async function executeApprovedLeadTriage(
  input: z.infer<typeof leadTriageInputSchema>,
) {
  const data = leadTriageInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "operations",
    "finance",
  ]);
  return performAtRiskLeadTriage(data.organizationId);
}

type InboxSlaTriageResult = {
  created: number;
  escalated: number;
  skipped: number;
  risks: number;
};

async function performInboxSlaTriage(
  organizationId: string,
): Promise<InboxSlaTriageResult> {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const [
    { data: conversations, error },
    { data: escalationMembers, error: memberError },
    { data: openSlaTasks, error: taskLoadError },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, contact_id, deal_id, assignee_id, subject, priority, response_due_at, sla_escalation_level",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .in("status", ["inbox", "open", "pending"])
      .not("response_due_at", "is", null)
      .lt("response_due_at", nowIso)
      .order("response_due_at", { ascending: true })
      .limit(25),
    supabase
      .from("memberships")
      .select("user_id, role, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "operations"])
      .order("created_at", { ascending: true }),
    supabase
      .from("tasks")
      .select("id, conversation_id")
      .eq("organization_id", organizationId)
      .in("status", ["open", "in_progress"])
      .like("title", "AIOS Inbox SLA:%")
      .not("conversation_id", "is", null)
      .limit(200),
  ]);
  if (error || memberError || taskLoadError)
    throw error || memberError || taskLoadError;

  let created = 0;
  let escalated = 0;
  let skipped = 0;
  const escalationOwnerId = escalationMembers?.[0]?.user_id ?? null;
  const taskByConversationId = new Map(
    (openSlaTasks || []).map((task) => [task.conversation_id, task]),
  );
  for (const conversation of conversations || []) {
    const level = inboxSlaEscalationLevel({
      responseDueAt: conversation.response_due_at,
      priority: inboxSlaPriority(conversation.priority),
      now,
    });
    if (!level || conversation.sla_escalation_level >= level) {
      skipped += 1;
      continue;
    }
    const existingTask = taskByConversationId.get(conversation.id);
    const assigneeId =
      level >= 2
        ? escalationOwnerId || conversation.assignee_id
        : conversation.assignee_id;
    const title =
      `AIOS Inbox SLA: L${level} respond to ${conversation.subject || "untitled conversation"}`.slice(
        0,
        500,
      );
    let task: { id: string; title: string };
    if (existingTask) {
      const { data: updatedTask, error: taskError } = await supabase
        .from("tasks")
        .update({
          assignee_id: assigneeId,
          title,
          due_at: conversation.response_due_at,
        })
        .eq("id", existingTask.id)
        .eq("organization_id", organizationId)
        .select("id, title")
        .maybeSingle();
      if (taskError || !updatedTask)
        throw taskError ||
          new Error("AIOS could not escalate an Inbox SLA task.");
      task = updatedTask;
    } else {
      const { data: createdTask, error: taskError } = await supabase
        .from("tasks")
        .insert({
          organization_id: organizationId,
          contact_id: conversation.contact_id,
          deal_id: conversation.deal_id,
          conversation_id: conversation.id,
          assignee_id: assigneeId,
          title,
          due_at: conversation.response_due_at,
        })
        .select("id, title")
        .maybeSingle();
      if (taskError?.code === "23505") {
        skipped += 1;
        continue;
      }
      if (taskError || !createdTask)
        throw taskError ||
          new Error("AIOS could not create an Inbox SLA task.");
      task = createdTask;
      taskByConversationId.set(conversation.id, {
        id: task.id,
        conversation_id: conversation.id,
      });
    }
    const { data: escalatedConversation, error: escalationError } =
      await supabase
        .from("conversations")
        .update({
          sla_escalation_level: level,
          sla_escalated_at: nowIso,
        })
        .eq("id", conversation.id)
        .eq("organization_id", organizationId)
        .lt("sla_escalation_level", level)
        .select("id")
        .maybeSingle();
    if (escalationError) throw escalationError;
    if (!escalatedConversation) {
      skipped += 1;
      continue;
    }
    if (existingTask) escalated += 1;
    else created += 1;
    const { error: activityError } = await supabase
      .from("activity_events")
      .insert({
        organization_id: organizationId,
        contact_id: conversation.contact_id,
        deal_id: conversation.deal_id,
        activity_type: "conversation_sla_escalated",
        body: `AIOS escalated the response SLA to level ${level}: ${task.title}`,
        metadata: {
          conversation_id: conversation.id,
          task_id: task.id,
          escalation_level: level,
          assigned_to: assigneeId,
          priority: conversation.priority,
          response_due_at: conversation.response_due_at,
        },
      });
    if (activityError) throw activityError;
    await recordAuditEvent({
      organizationId,
      eventType: "record.created",
      entityType: "task",
      entityId: task.id,
      metadata: {
        event: existingTask
          ? "aios.inbox_sla_task_escalated"
          : "aios.inbox_sla_task_created",
        conversation_id: conversation.id,
        escalation_level: level,
        assigned_to: assigneeId,
        priority: conversation.priority,
        response_due_at: conversation.response_due_at,
      },
    });
  }
  return {
    created,
    escalated,
    skipped,
    risks: conversations?.length || 0,
  };
}

/** Creates bounded, deduplicated internal tasks for overdue response SLAs. */
export async function triageInboxSlaRisks(
  input: z.infer<typeof inboxSlaTriageInputSchema>,
) {
  const data = inboxSlaTriageInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "operations",
    "agent",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const actorId = claims?.claims.sub;
  if (claimsError || !actorId) throw new Error("Sign in is required.");
  const startedAt = Date.now();
  const run = await createAgentRun({
    organizationId: data.organizationId,
    initiatedBy: actorId,
    agentType: INBOX_SLA_TRIAGE_AGENT.type,
    agentVersion: INBOX_SLA_TRIAGE_AGENT.version,
    inputReference: {
      maximum_conversations: 25,
      maximum_escalation_level: 3,
      manager_escalation: true,
      external_messages: false,
    },
  });
  const gate = await gateAiosAction({
    organizationId: data.organizationId,
    action: "inbox.sla.triage",
    entityType: "organization",
    entityId: null,
    payload: {
      maximum_conversations: 25,
      maximum_escalation_level: 3,
      manager_escalation: true,
      external_messages: false,
      ai_run_id: run.id,
    },
    rationale:
      "AIOS will inspect overdue response deadlines and create or advance at most one open internal follow-up per conversation through three bounded escalation tiers. It will not send any message.",
  });
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "inbox.sla.triage",
    requestedAction: "inbox.sla.triage",
    decision:
      gate.decision === "execute"
        ? "allowed"
        : gate.decision === "approval_required"
          ? "approval_required"
          : gate.decision === "blocked"
            ? "blocked"
            : "allowed",
    arguments: {
      maximum_conversations: 25,
      maximum_escalation_level: 3,
      manager_escalation: true,
      external_messages: false,
    },
    result: { decision: gate.decision },
  });
  if (gate.decision === "execute") {
    try {
      const result = await performInboxSlaTriage(data.organizationId);
      await completeAgentRun({
        organizationId: data.organizationId,
        runId: run.id,
        status: "succeeded",
        result,
        durationMs: Date.now() - startedAt,
      });
      return { status: "completed" as const, ...result, runId: run.id };
    } catch (error) {
      await completeAgentRun({
        organizationId: data.organizationId,
        runId: run.id,
        status: "failed",
        result: { workflow: "inbox_sla_triage" },
        errorCode: "INBOX_SLA_TRIAGE_FAILED",
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
  await completeAgentRun({
    organizationId: data.organizationId,
    runId: run.id,
    status: "blocked",
    result: { decision: gate.decision },
    errorCode: gate.decision.toUpperCase(),
    durationMs: Date.now() - startedAt,
    approvalRequestId:
      gate.decision === "approval_required" ? gate.approvalId : null,
  });
  return {
    status: gate.decision,
    runId: run.id,
    ...(gate.decision === "approval_required"
      ? { approvalId: gate.approvalId }
      : {}),
  };
}

/** Resumes the same bounded internal SLA triage after a human approval. */
export async function executeApprovedInboxSlaTriage(
  input: z.infer<typeof inboxSlaTriageInputSchema> & { runId: string },
) {
  const data = inboxSlaTriageInputSchema
    .extend({ runId: z.uuid() })
    .parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "operations",
    "finance",
  ]);
  const startedAt = Date.now();
  await resumeAgentRun({
    organizationId: data.organizationId,
    runId: data.runId,
  });
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: data.runId,
    toolName: "inbox.sla.triage",
    requestedAction: "inbox.sla.triage",
    decision: "allowed",
    arguments: { approved_resume: true, external_messages: false },
    result: { decision: "approved" },
  });
  try {
    const result = await performInboxSlaTriage(data.organizationId);
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: data.runId,
      status: "succeeded",
      result,
      durationMs: Date.now() - startedAt,
    });
    return { ...result, runId: data.runId };
  } catch (error) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: data.runId,
      status: "failed",
      result: { workflow: "inbox_sla_triage" },
      errorCode: "INBOX_SLA_TRIAGE_FAILED",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

async function assignRoutedDeal(input: {
  organizationId: string;
  dealId: string;
  candidateId: string;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: candidate, error: candidateError } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.candidateId)
    .eq("status", "active")
    .in("role", ["owner", "admin", "sales"])
    .maybeSingle();
  if (candidateError || !candidate)
    throw new Error(
      "The nominated routing teammate is no longer active and eligible.",
    );
  const { data: deal, error } = await supabase
    .from("deals")
    .update({
      owner_id: input.candidateId,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", input.dealId)
    .eq("organization_id", input.organizationId)
    .is("owner_id", null)
    .not("stage", "in", "(won,lost)")
    .select("id, title, owner_id")
    .maybeSingle();
  if (error) throw error;
  if (!deal)
    throw new Error(
      "This opportunity was already assigned or closed before AIOS could route it.",
    );
  await supabase.from("activity_events").insert({
    organization_id: input.organizationId,
    deal_id: deal.id,
    activity_type: "deal_owner_routed",
    body: "AIOS routed this opportunity to an active sales teammate.",
    metadata: {
      owner_id: deal.owner_id,
      strategy: "least_active_sales_load",
    },
  });
  await recordAuditEvent({
    organizationId: input.organizationId,
    eventType: "record.updated",
    entityType: "deal",
    entityId: deal.id,
    metadata: {
      event: "aios.deal_routed",
      owner_id: deal.owner_id,
      strategy: "least_active_sales_load",
    },
  });
  return deal;
}

/** Routes a live unassigned lead only through the workspace's AIOS policy. */
export async function routeUnassignedDeal(
  input: z.infer<typeof leadRoutingInputSchema>,
) {
  const data = leadRoutingInputSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id, owner_id, stage")
    .eq("id", data.dealId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (
    dealError ||
    !deal ||
    deal.owner_id ||
    deal.stage === "won" ||
    deal.stage === "lost"
  )
    throw new Error(
      "Only a live unassigned opportunity can be routed by AIOS.",
    );
  const [
    { data: members, error: membersError },
    { data: liveDeals, error: loadError },
  ] = await Promise.all([
    supabase
      .from("memberships")
      .select("user_id, role, created_at")
      .eq("organization_id", data.organizationId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "sales"]),
    supabase
      .from("deals")
      .select("owner_id, stage")
      .eq("organization_id", data.organizationId)
      .is("archived_at", null),
  ]);
  if (membersError || loadError) throw membersError || loadError;
  if (!members?.length)
    throw new Error(
      "AIOS needs at least one active owner, admin, or sales teammate to route this opportunity.",
    );
  const workloads = new Map(members.map((member) => [member.user_id, 0]));
  for (const current of liveDeals || [])
    if (
      current.owner_id &&
      current.stage !== "won" &&
      current.stage !== "lost" &&
      workloads.has(current.owner_id)
    )
      workloads.set(
        current.owner_id,
        (workloads.get(current.owner_id) || 0) + 1,
      );
  const candidate = [...members].sort(
    (left, right) =>
      workloads.get(left.user_id)! - workloads.get(right.user_id)! ||
      left.created_at.localeCompare(right.created_at),
  )[0]!;
  const gate = await gateAiosAction({
    organizationId: data.organizationId,
    action: "crm.deal.route",
    entityType: "deal",
    entityId: deal.id,
    payload: {
      deal_id: deal.id,
      candidate_id: candidate.user_id,
      strategy: "least_active_sales_load",
    },
    rationale:
      "AIOS selected the least-loaded active sales-capable teammate for an unassigned opportunity.",
  });
  if (gate.decision === "execute")
    return {
      status: "routed" as const,
      deal: await assignRoutedDeal({
        organizationId: data.organizationId,
        dealId: deal.id,
        candidateId: candidate.user_id,
      }),
    };
  return {
    status: gate.decision,
    candidateId: candidate.user_id,
    ...(gate.decision === "approval_required"
      ? { approvalId: gate.approvalId }
      : {}),
  };
}

/** Executes a human-approved routing request using the original nominated candidate. */
export async function executeApprovedLeadRouting(input: {
  organizationId: string;
  dealId: string;
  candidateId: string;
}) {
  await requireOrganizationRole(input.organizationId, [
    "owner",
    "admin",
    "operations",
    "finance",
  ]);
  return assignRoutedDeal(input);
}

/** Starts a bounded analysis run. It never changes the deal or performs an external action. */
export async function startLeadIntakeRun(
  input: z.infer<typeof leadIntakeInputSchema>,
) {
  const data = leadIntakeInputSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const initiatedBy = claims?.claims.sub;
  if (claimsError || !initiatedBy) throw new Error("Sign in is required.");

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select(
      "id, title, source, destination, travel_start, travel_end, traveller_count, notes",
    )
    .eq("id", data.dealId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (dealError || !deal)
    throw new Error("This lead is not available in the active workspace.");

  const leadInput = inspectLeadIntakeInput({
    id: deal.id,
    title: deal.title,
    source: deal.source,
    destination: deal.destination,
    travelStart: deal.travel_start,
    travelEnd: deal.travel_end,
    travellerCount: deal.traveller_count,
    notes: deal.notes,
  });
  const startedAt = Date.now();
  const run = await createAgentRun({
    organizationId: data.organizationId,
    initiatedBy,
    agentType: LEAD_INTAKE_AGENT.type,
    agentVersion: LEAD_INTAKE_AGENT.version,
    inputReference: {
      deal_id: deal.id,
      workflow: "lead_intake",
      prompt_version: AIOS_PROMPT_VERSIONS.leadIntake,
      input_safety: leadInput.audit,
    },
  });
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "aios.input_safety_check",
    requestedAction: "model.input.prepare",
    decision: leadInput.blocked ? "blocked" : "allowed",
    arguments: { deal_id: deal.id },
    result: leadInput.audit,
  });
  if (leadInput.blocked) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: leadInput.errorCode,
      durationMs: Date.now() - startedAt,
    });
    await recordAuditEvent({
      organizationId: data.organizationId,
      eventType: "ai.action_blocked",
      entityType: "ai_run",
      entityId: run.id,
      metadata: {
        event: "aios.lead_input_safety_blocked",
        error_code: leadInput.errorCode,
      },
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message:
        "AIOS detected untrusted or oversized lead content. A teammate must review and rewrite the lead notes before model analysis.",
    };
  }

  const modelBudget = await loadOrganizationModelBudget(data.organizationId);
  const budgetBlock = modelBudgetBlockReason(modelBudget);
  if (budgetBlock) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: budgetBlock.code,
      durationMs: Date.now() - startedAt,
    });
    await recordAuditEvent({
      organizationId: data.organizationId,
      eventType: "ai.action_blocked",
      entityType: "ai_run",
      entityId: run.id,
      metadata: {
        event: budgetBlock.event,
        daily_limit: modelBudget.dailyRunLimit,
        daily_run_count: modelBudget.todayModelRunCount,
        selected_provider: modelBudget.selectedModelProvider,
      },
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message: budgetBlock.message,
    };
  }

  const gate = await gateAiosAction({
    organizationId: data.organizationId,
    action: "crm.field_draft.create",
    entityType: "deal",
    entityId: deal.id,
    payload: { ai_run_id: run.id, workflow: "lead_intake" },
    rationale:
      "AIOS proposes a structured lead-intake draft from the selected CRM deal.",
  });

  const toolDecision =
    gate.decision === "approval_required"
      ? "approval_required"
      : gate.decision === "blocked"
        ? "blocked"
        : "allowed";
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "crm.lead_intake_draft",
    requestedAction: "crm.field_draft.create",
    decision: toolDecision,
    arguments: { deal_id: deal.id },
    result: gate as Json,
  });

  if (gate.decision === "approval_required") {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      approvalRequestId: gate.approvalId,
      errorCode: "HUMAN_APPROVAL_REQUIRED",
      durationMs: Date.now() - startedAt,
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      approvalId: gate.approvalId,
      message:
        "AIOS routed this run to a human approver before it can create a draft.",
    };
  }
  if (gate.decision === "blocked") {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: "AUTONOMY_POLICY_BLOCKED",
      durationMs: Date.now() - startedAt,
    });
    return { runId: run.id, status: "blocked" as const, message: gate.reason };
  }

  let modelJob: Awaited<ReturnType<typeof prepareModelJob>> | null = null;
  let modelResult: Awaited<ReturnType<typeof runLeadIntake>>;
  try {
    modelJob = await prepareModelJob({
      organizationId: data.organizationId,
      aiRunId: run.id,
      jobType: "lead_intake",
      payload: {
        workflow: "lead_intake",
        deal_id: deal.id,
        prompt_version: AIOS_PROMPT_VERSIONS.leadIntake,
        provider: modelBudget.selectedModelProvider,
        fallback_provider: modelBudget.fallbackModelProvider,
      },
    });
    modelResult = await runLeadIntake(
      leadInput.source,
      modelBudget.selectedModelProvider,
      modelBudget.fallbackModelProvider,
    );
    await settleModelJob({
      jobId: modelJob.job_id,
      workerId: modelJob.workerId,
      attempt: modelJob.job_attempts,
      succeeded: true,
    });
  } catch (error) {
    const errorCode =
      error instanceof AiosProviderNotConfiguredError
        ? "AI_PROVIDER_NOT_CONFIGURED"
        : error instanceof AiosJobNotAvailableError
          ? "AI_JOB_NOT_AVAILABLE"
          : "LEAD_INTAKE_FAILED";
    if (modelJob) {
      await settleModelJob({
        jobId: modelJob.job_id,
        workerId: modelJob.workerId,
        attempt: modelJob.job_attempts,
        succeeded: false,
        errorCode,
      });
    }
    const provider = getAiosProviderStatus(
      modelBudget.selectedModelProvider,
    );
    await recordAgentToolCall({
      organizationId: data.organizationId,
      runId: run.id,
      toolName: "model.structured_output",
      requestedAction: "crm.field_draft.create",
      decision: "failed",
      arguments: provider,
      result: { error_code: errorCode },
    });
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode,
      durationMs: Date.now() - startedAt,
    });
    if (error instanceof AiosProviderNotConfiguredError)
      return {
        runId: run.id,
        status: "blocked" as const,
        message: error.message,
      };
    if (error instanceof AiosJobNotAvailableError)
      return {
        runId: run.id,
        status: "blocked" as const,
        message:
          "This AIOS job is already running or waiting for its retry window.",
      };
    throw error;
  }
  const estimatedCost = await estimateModelRunCost({
    organizationId: data.organizationId,
    provider: modelResult.provider,
    model: modelResult.model,
    inputTokens: modelResult.inputTokens,
    outputTokens: modelResult.outputTokens,
  });
  await completeAgentRun({
    organizationId: data.organizationId,
    runId: run.id,
    status: "succeeded",
    result: {
      extraction: modelResult.extraction,
      primary_provider: modelBudget.selectedModelProvider,
      provider: modelResult.provider,
      attempted_providers: modelResult.attemptedProviders,
      fallback_used: modelResult.fallbackUsed,
      model: modelResult.model,
      prompt_version: modelResult.promptVersion,
      response_id: modelResult.responseId,
      input_safety: leadInput.audit,
    } as Json,
    citations: modelResult.extraction.citations as Json,
    durationMs: Date.now() - startedAt,
    inputTokens: modelResult.inputTokens,
    outputTokens: modelResult.outputTokens,
    estimatedCost,
  });
  return {
    runId: run.id,
    status: "succeeded" as const,
    extraction: modelResult.extraction,
  };
}

const resumeLeadIntakeSchema = z.object({
  organizationId: z.uuid(),
  runId: z.uuid(),
  dealId: z.uuid(),
  approvalId: z.uuid(),
});

/** Continues the same run only after a durable approval has been resolved as approved. */
export async function resumeApprovedLeadIntakeRun(
  input: z.infer<typeof resumeLeadIntakeSchema>,
) {
  const data = resumeLeadIntakeSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "operations",
    "finance",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: approval, error: approvalError } = await supabase
    .from("approval_requests")
    .select("id, action, status, entity_id")
    .eq("id", data.approvalId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (
    approvalError ||
    !approval ||
    approval.status !== "approved" ||
    approval.action !== "crm.field_draft.create" ||
    approval.entity_id !== data.dealId
  ) {
    throw new Error(
      "This approved request cannot resume the selected AIOS run.",
    );
  }

  const { data: run, error: runError } = await supabase
    .from("ai_runs")
    .select("id, status, agent_type, approval_request_id")
    .eq("id", data.runId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (
    runError ||
    !run ||
    run.agent_type !== LEAD_INTAKE_AGENT.type ||
    run.approval_request_id !== approval.id ||
    run.status === "succeeded"
  ) {
    throw new Error("This AIOS run is not eligible to resume.");
  }

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select(
      "id, title, source, destination, travel_start, travel_end, traveller_count, notes",
    )
    .eq("id", data.dealId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (dealError || !deal)
    throw new Error("The associated lead is no longer available.");

  const leadInput = inspectLeadIntakeInput({
    id: deal.id,
    title: deal.title,
    source: deal.source,
    destination: deal.destination,
    travelStart: deal.travel_start,
    travelEnd: deal.travel_end,
    travellerCount: deal.traveller_count,
    notes: deal.notes,
  });
  const startedAt = Date.now();
  await resumeAgentRun({ organizationId: data.organizationId, runId: run.id });
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "approval.resume",
    requestedAction: "crm.field_draft.create",
    decision: "allowed",
    arguments: { approval_id: approval.id },
    result: { status: "approved" },
  });
  await recordAgentToolCall({
    organizationId: data.organizationId,
    runId: run.id,
    toolName: "aios.input_safety_check",
    requestedAction: "model.input.prepare",
    decision: leadInput.blocked ? "blocked" : "allowed",
    arguments: { deal_id: deal.id },
    result: leadInput.audit,
  });
  if (leadInput.blocked) {
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: leadInput.errorCode,
      durationMs: Date.now() - startedAt,
      approvalRequestId: approval.id,
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message:
        "AIOS detected untrusted or oversized lead content. A teammate must rewrite the lead notes before model analysis.",
    };
  }

  const modelBudget = await loadOrganizationModelBudget(data.organizationId);
  const budgetBlock = modelBudgetBlockReason(modelBudget);
  if (budgetBlock) {
    await recordAgentToolCall({
      organizationId: data.organizationId,
      runId: run.id,
      toolName: "aios.model_budget_check",
      requestedAction: "model.execute",
      decision: "blocked",
      arguments: {
        selected_provider: modelBudget.selectedModelProvider,
        daily_limit: modelBudget.dailyRunLimit,
      },
      result: { error_code: budgetBlock.code },
    });
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode: budgetBlock.code,
      durationMs: Date.now() - startedAt,
      approvalRequestId: approval.id,
    });
    return {
      runId: run.id,
      status: "blocked" as const,
      message: `Approval was recorded. ${budgetBlock.message}`,
    };
  }

  let modelJob: Awaited<ReturnType<typeof prepareModelJob>> | null = null;
  let modelResult: Awaited<ReturnType<typeof runLeadIntake>>;
  try {
    modelJob = await prepareModelJob({
      organizationId: data.organizationId,
      aiRunId: run.id,
      jobType: "lead_intake",
      payload: {
        workflow: "lead_intake",
        deal_id: deal.id,
        prompt_version: AIOS_PROMPT_VERSIONS.leadIntake,
        provider: modelBudget.selectedModelProvider,
        fallback_provider: modelBudget.fallbackModelProvider,
      },
    });
    modelResult = await runLeadIntake(
      leadInput.source,
      modelBudget.selectedModelProvider,
      modelBudget.fallbackModelProvider,
    );
    await settleModelJob({
      jobId: modelJob.job_id,
      workerId: modelJob.workerId,
      attempt: modelJob.job_attempts,
      succeeded: true,
    });
  } catch (error) {
    const errorCode =
      error instanceof AiosProviderNotConfiguredError
        ? "AI_PROVIDER_NOT_CONFIGURED"
        : error instanceof AiosJobNotAvailableError
          ? "AI_JOB_NOT_AVAILABLE"
          : "LEAD_INTAKE_FAILED";
    if (modelJob) {
      await settleModelJob({
        jobId: modelJob.job_id,
        workerId: modelJob.workerId,
        attempt: modelJob.job_attempts,
        succeeded: false,
        errorCode,
      });
    }
    const provider = getAiosProviderStatus(
      modelBudget.selectedModelProvider,
    );
    await recordAgentToolCall({
      organizationId: data.organizationId,
      runId: run.id,
      toolName: "model.structured_output",
      requestedAction: "crm.field_draft.create",
      decision: "failed",
      arguments: provider,
      result: { error_code: errorCode },
    });
    await completeAgentRun({
      organizationId: data.organizationId,
      runId: run.id,
      status: "blocked",
      errorCode,
      durationMs: Date.now() - startedAt,
      approvalRequestId: approval.id,
    });
    if (error instanceof AiosProviderNotConfiguredError)
      return {
        runId: run.id,
        status: "blocked" as const,
        message: `Approval was recorded. ${error.message}`,
      };
    if (error instanceof AiosJobNotAvailableError)
      return {
        runId: run.id,
        status: "blocked" as const,
        message:
          "Approval was recorded. This AIOS job is already running or waiting for its retry window.",
      };
    throw error;
  }
  const estimatedCost = await estimateModelRunCost({
    organizationId: data.organizationId,
    provider: modelResult.provider,
    model: modelResult.model,
    inputTokens: modelResult.inputTokens,
    outputTokens: modelResult.outputTokens,
  });
  await completeAgentRun({
    organizationId: data.organizationId,
    runId: run.id,
    status: "succeeded",
    result: {
      extraction: modelResult.extraction,
      primary_provider: modelBudget.selectedModelProvider,
      provider: modelResult.provider,
      attempted_providers: modelResult.attemptedProviders,
      fallback_used: modelResult.fallbackUsed,
      model: modelResult.model,
      prompt_version: modelResult.promptVersion,
      response_id: modelResult.responseId,
      input_safety: leadInput.audit,
    } as Json,
    citations: modelResult.extraction.citations as Json,
    durationMs: Date.now() - startedAt,
    inputTokens: modelResult.inputTokens,
    outputTokens: modelResult.outputTokens,
    estimatedCost,
    approvalRequestId: approval.id,
  });
  return {
    runId: run.id,
    status: "succeeded" as const,
    extraction: modelResult.extraction,
  };
}

const reviewableLeadFields = [
  "destination",
  "travelStart",
  "travelEnd",
  "travellerCount",
] as const;
const reviewLeadIntakeSchema = z.object({
  organizationId: z.uuid(),
  runId: z.uuid(),
  acceptedFields: z
    .array(z.enum(reviewableLeadFields))
    .max(reviewableLeadFields.length),
});

function recordFromJson(value: Json | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : null;
}

/** Applies only explicit human selections from a completed, cited lead-intake draft. */
export async function reviewLeadIntakeDraft(
  input: z.infer<typeof reviewLeadIntakeSchema>,
) {
  const data = reviewLeadIntakeSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const reviewerId = claims?.claims.sub;
  if (claimsError || !reviewerId) throw new Error("Sign in is required.");

  const { data: run, error: runError } = await supabase
    .from("ai_runs")
    .select("id, agent_type, status, input_reference, result")
    .eq("id", data.runId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (
    runError ||
    !run ||
    run.agent_type !== LEAD_INTAKE_AGENT.type ||
    run.status !== "succeeded"
  )
    throw new Error("Only a completed Lead Intake draft can be reviewed.");

  const inputReference = recordFromJson(run.input_reference);
  if (!run.result)
    throw new Error("This AIOS run has no structured draft to review.");
  const result = recordFromJson(run.result);
  const extractionCandidate = result?.extraction ?? run.result;
  const extractionPayload = recordFromJson(extractionCandidate)
    ? extractionCandidate
    : run.result;
  const dealId =
    typeof inputReference?.deal_id === "string" ? inputReference.deal_id : null;
  if (!dealId || !z.uuid().safeParse(dealId).success)
    throw new Error("This AIOS run is missing its linked lead.");
  const extraction = parseLeadExtraction(extractionPayload);

  const proposedValues = {
    destination: extraction.destination,
    travelStart: extraction.travelStart,
    travelEnd: extraction.travelEnd,
    travellerCount: extraction.travellerCount,
  } as const;
  for (const field of data.acceptedFields)
    if (proposedValues[field] === null)
      throw new Error(`AIOS did not propose a value for ${field}.`);

  const { data: linkedDeal, error: linkedDealError } = await supabase
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (linkedDealError || !linkedDeal)
    throw new Error("The linked lead is no longer available for review.");

  const updates: {
    destination?: string;
    travel_start?: string;
    travel_end?: string;
    traveller_count?: number;
  } = {};
  if (data.acceptedFields.includes("destination") && extraction.destination)
    updates.destination = extraction.destination;
  if (data.acceptedFields.includes("travelStart") && extraction.travelStart)
    updates.travel_start = extraction.travelStart;
  if (data.acceptedFields.includes("travelEnd") && extraction.travelEnd)
    updates.travel_end = extraction.travelEnd;
  if (
    data.acceptedFields.includes("travellerCount") &&
    extraction.travellerCount
  )
    updates.traveller_count = extraction.travellerCount;

  // Claim the review before CRM mutation. The database unique index is the
  // concurrency guard; a second reviewer cannot apply this draft twice.
  const admin = createSupabaseAdminClient();
  const { error: reviewError } = await admin.from("ai_field_reviews").insert(
    reviewableLeadFields.map((field) => ({
      organization_id: data.organizationId,
      ai_run_id: run.id,
      entity_type: "deal",
      entity_id: dealId,
      field_name: field,
      proposed_value: proposedValues[field],
      decision: data.acceptedFields.includes(field) ? "accepted" : "rejected",
      reviewed_by: reviewerId,
    })),
  );
  if (reviewError?.code === "23505")
    throw new Error("This AIOS draft has already been reviewed.");
  if (reviewError) throw reviewError;

  if (Object.keys(updates).length > 0) {
    const { data: updatedDeal, error: updateError } = await supabase
      .from("deals")
      .update(updates)
      .eq("id", dealId)
      .eq("organization_id", data.organizationId)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedDeal)
      throw new Error("The linked lead is no longer available for review.");
  }

  let followUp: {
    status: "created" | "draft" | "approval_required" | "observe" | "blocked";
    taskId?: string;
    approvalId?: string;
  } | null = null;
  if (extraction.missingInformation.length > 0) {
    const taskTitle =
      `Gather lead details: ${extraction.missingInformation.slice(0, 3).join(", ")}`.slice(
        0,
        180,
      );
    const decision = await gateAiosAction({
      organizationId: data.organizationId,
      action: "internal.task.create",
      entityType: "deal",
      entityId: dealId,
      payload: { ai_run_id: run.id, task_title: taskTitle },
      rationale:
        "AIOS identified missing lead qualification information after human review.",
    });
    if (decision.decision === "execute") {
      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .insert({
          organization_id: data.organizationId,
          deal_id: dealId,
          title: taskTitle,
        })
        .select("id, title")
        .single();
      if (taskError) throw taskError;
      const { error: activityError } = await supabase
        .from("activity_events")
        .insert({
          organization_id: data.organizationId,
          deal_id: dealId,
          activity_type: "task_created",
          body: `AIOS created follow-up: ${task.title}`,
        });
      if (activityError) throw activityError;
      await recordAuditEvent({
        organizationId: data.organizationId,
        eventType: "record.created",
        entityType: "task",
        entityId: task.id,
        metadata: {
          event: "aios.follow_up_task_created",
          ai_run_id: run.id,
          deal_id: dealId,
        },
      });
      followUp = { status: "created", taskId: task.id };
    } else if (decision.decision === "approval_required")
      followUp = {
        status: "approval_required",
        approvalId: decision.approvalId,
      };
    else followUp = { status: decision.decision };
  }

  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "deal",
    entityId: dealId,
    metadata: {
      event: "aios.lead_intake_reviewed",
      ai_run_id: run.id,
      accepted_fields: data.acceptedFields,
    },
  });
  revalidatePath("/");
  revalidatePath("/aios");
  return {
    runId: run.id,
    dealId,
    acceptedFields: data.acceptedFields,
    followUp,
  };
}
