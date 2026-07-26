import "server-only";

import type { Json } from "../../types/database";
import { recordAuditEvent } from "../audit";
import { createSupabaseAdminClient } from "../supabase/admin";

export const LEAD_INTAKE_AGENT = { type: "lead_intake", version: "2026.07.24.2" } as const;
export const ITINERARY_READINESS_AGENT = { type: "itinerary_readiness", version: "2026.07.24.1" } as const;
export const ITINERARY_DRAFT_AGENT = { type: "itinerary_draft", version: "2026.07.24.1" } as const;
export const INBOX_SLA_TRIAGE_AGENT = { type: "inbox_sla_triage", version: "2026.07.26.2" } as const;

export async function createAgentRun(input: { organizationId: string; initiatedBy: string; agentType: string; agentVersion: string; inputReference: Json }) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("ai_runs").insert({
    organization_id: input.organizationId,
    initiated_by: input.initiatedBy,
    agent_type: input.agentType,
    agent_version: input.agentVersion,
    status: "running",
    input_reference: input.inputReference,
  }).select().single();
  if (error) throw error;
  await recordAuditEvent({ organizationId: input.organizationId, eventType: "ai.run_started", entityType: "ai_run", entityId: data.id, metadata: { agent_type: input.agentType, agent_version: input.agentVersion } });
  return data;
}

export async function recordAgentToolCall(input: { organizationId: string; runId: string; toolName: string; requestedAction: string; decision: "allowed" | "approval_required" | "blocked" | "failed"; arguments: Json; result?: Json | null }) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("ai_tool_calls").insert({
    organization_id: input.organizationId,
    ai_run_id: input.runId,
    tool_name: input.toolName,
    requested_action: input.requestedAction,
    decision: input.decision,
    arguments: input.arguments,
    result: input.result ?? null,
  });
  if (error) throw error;
}

export async function resumeAgentRun(input: { organizationId: string; runId: string }) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("ai_runs").update({
    status: "running",
    result: null,
    citations: [],
    error_code: null,
    duration_ms: null,
    input_tokens: null,
    output_tokens: null,
    estimated_cost: null,
    estimated_cost_currency: null,
    model_price_id: null,
    completed_at: null,
  }).eq("id", input.runId).eq("organization_id", input.organizationId);
  if (error) throw error;
}

export async function completeAgentRun(input: { organizationId: string; runId: string; status: "succeeded" | "failed" | "blocked"; result?: Json | null; citations?: Json; errorCode?: string | null; durationMs: number; inputTokens?: number | null; outputTokens?: number | null; estimatedCost?: { amount: number; currency: string; modelPriceId: string } | null; approvalRequestId?: string | null }) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("ai_runs").update({
    status: input.status,
    result: input.result ?? null,
    citations: input.citations ?? [],
    error_code: input.errorCode ?? null,
    duration_ms: input.durationMs,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    estimated_cost: input.estimatedCost?.amount ?? null,
    estimated_cost_currency: input.estimatedCost?.currency ?? null,
    model_price_id: input.estimatedCost?.modelPriceId ?? null,
    approval_request_id: input.approvalRequestId ?? null,
    completed_at: new Date().toISOString(),
  }).eq("id", input.runId).eq("organization_id", input.organizationId);
  if (error) throw error;
  await recordAuditEvent({ organizationId: input.organizationId, eventType: input.status === "succeeded" ? "ai.run_completed" : "ai.run_blocked", entityType: "ai_run", entityId: input.runId, metadata: { status: input.status, error_code: input.errorCode ?? null } });
}
