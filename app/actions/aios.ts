"use server";

import { z } from "zod";

import { getAiosAction, autonomyModeSchema, evaluateAutonomy } from "../../lib/ai/autonomy";
import { recordAuditEvent } from "../../lib/audit";
import { requireActiveMembership, requireOrganizationRole } from "../../lib/authorization";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { modelProviderSchema } from "../../lib/env";
import { runDueModelJobs } from "../../lib/ai/job-runner";
import { requeueModelJob } from "../../lib/ai/jobs";
import type { Json } from "../../types/database";

const policyInputSchema = z.object({ organizationId: z.uuid(), action: z.string().min(3).max(120), mode: autonomyModeSchema });

/** Owners/admins set the degree of autonomy. Hard approval gates remain enforced. */
export async function setAutonomyMode(input: z.infer<typeof policyInputSchema>) {
  const data = policyInputSchema.parse(input);
  const action = getAiosAction(data.action);
  if (!action) throw new Error("Unknown AIOS action.");
  if (action.hardApproval && data.mode === "auto") throw new Error("This action requires human approval.");

  await requireOrganizationRole(data.organizationId, ["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: policy, error } = await supabase
    .from("ai_autonomy_policies")
    .upsert({ organization_id: data.organizationId, action: data.action, mode: data.mode }, { onConflict: "organization_id,action" })
    .select()
    .single();
  if (error) throw error;

  await recordAuditEvent({ organizationId: data.organizationId, eventType: "record.updated", entityType: "ai_autonomy_policy", entityId: policy.id, metadata: { event: "aios.autonomy_mode_updated", action: data.action, mode: data.mode } });
  return policy;
}

const enabledInputSchema = z.object({ organizationId: z.uuid(), action: z.string().min(3).max(120), isEnabled: z.boolean() });

/** Owner/admin kill switch. Disabling a workflow blocks it before any tool call. */
export async function setAutonomyEnabled(input: z.infer<typeof enabledInputSchema>) {
  const data = enabledInputSchema.parse(input);
  const action = getAiosAction(data.action);
  if (!action) throw new Error("Unknown AIOS action.");
  await requireOrganizationRole(data.organizationId, ["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: policy, error } = await supabase
    .from("ai_autonomy_policies")
    .upsert({ organization_id: data.organizationId, action: data.action, mode: action.defaultMode, is_enabled: data.isEnabled }, { onConflict: "organization_id,action" })
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({ organizationId: data.organizationId, eventType: data.isEnabled ? "record.updated" : "ai.action_blocked", entityType: "ai_autonomy_policy", entityId: policy.id, metadata: { event: "aios.autonomy_enabled_updated", action: data.action, is_enabled: data.isEnabled } });
  return policy;
}

const budgetPolicyInputSchema = z.object({
  organizationId: z.uuid(),
  dailyModelRunLimit: z.number().int().min(1).max(1000),
  modelExecutionEnabled: z.boolean(),
  selectedModelProvider: modelProviderSchema,
  allowedModelProviders: z
    .array(modelProviderSchema)
    .min(1)
    .max(5)
    .refine(
      (providers) => new Set(providers).size === providers.length,
      "Providers must be unique.",
    ),
}).refine(
  (policy) =>
    policy.allowedModelProviders.includes(policy.selectedModelProvider),
  {
    message: "The selected provider must be allowed.",
    path: ["selectedModelProvider"],
  },
);

/** Owners/admins govern provider-backed model use for their workspace. */
export async function setAiosBudgetPolicy(
  input: z.infer<typeof budgetPolicyInputSchema>,
) {
  const data = budgetPolicyInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, ["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const actorId = claims?.claims.sub;
  if (claimsError || !actorId) throw new Error("Sign in is required.");
  const { data: policy, error } = await supabase
    .from("ai_budget_policies")
    .upsert(
      {
        organization_id: data.organizationId,
        daily_model_run_limit: data.dailyModelRunLimit,
        model_execution_enabled: data.modelExecutionEnabled,
        selected_model_provider: data.selectedModelProvider,
        allowed_model_providers: data.allowedModelProviders,
        updated_by: actorId,
      },
      { onConflict: "organization_id" },
    )
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: policy.model_execution_enabled
      ? "record.updated"
      : "ai.action_blocked",
    entityType: "ai_budget_policy",
    entityId: policy.id,
    metadata: {
      event: "aios.budget_policy_updated",
      daily_model_run_limit: policy.daily_model_run_limit,
      model_execution_enabled: policy.model_execution_enabled,
      selected_model_provider: policy.selected_model_provider,
      allowed_model_providers: policy.allowed_model_providers,
    },
  });
  return policy;
}

const modelPriceSchema = z.object({
  organizationId: z.uuid(),
  provider: modelProviderSchema,
  model: z.string().trim().min(1).max(120),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  inputPricePerMillion: z.number().finite().min(0).max(1_000_000),
  outputPricePerMillion: z.number().finite().min(0).max(1_000_000),
});

/** Adds an immutable, owner-approved price version; no vendor rates are inferred. */
export async function addAiosModelPrice(
  input: z.infer<typeof modelPriceSchema>,
) {
  const data = modelPriceSchema.parse(input);
  await requireOrganizationRole(data.organizationId, ["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const actorId = claims?.claims.sub;
  if (claimsError || !actorId) throw new Error("Sign in is required.");
  const { data: price, error } = await supabase
    .from("ai_model_prices")
    .insert({
      organization_id: data.organizationId,
      provider: data.provider,
      model: data.model,
      currency: data.currency,
      input_price_per_million: data.inputPricePerMillion,
      output_price_per_million: data.outputPricePerMillion,
      approved_by: actorId,
    })
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "ai_model_price",
    entityId: price.id,
    metadata: {
      event: "aios.model_price_approved",
      provider: price.provider,
      model: price.model,
      currency: price.currency,
      effective_from: price.effective_from,
    },
  });
  return price;
}

const runReadyJobsSchema = z.object({ organizationId: z.uuid() });

/** Human-operated fallback until the scheduled deployment worker is enabled. */
export async function runReadyAiosJobs(
  input: z.infer<typeof runReadyJobsSchema>,
) {
  const data = runReadyJobsSchema.parse(input);
  await requireOrganizationRole(data.organizationId, ["owner", "admin"]);
  const summary = await runDueModelJobs(5, data.organizationId);
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "ai.tool_called",
    entityType: "ai_job_worker",
    metadata: {
      event: "aios.job_worker_invoked",
      ...summary,
    },
  });
  return summary;
}

const requeueJobSchema = z.object({
  organizationId: z.uuid(),
  jobId: z.uuid(),
});

/** Requeueing a dead letter is always an explicit owner/admin operation. */
export async function requeueAiosJob(
  input: z.infer<typeof requeueJobSchema>,
) {
  const data = requeueJobSchema.parse(input);
  await requireOrganizationRole(data.organizationId, ["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: job, error } = await supabase
    .from("ai_jobs")
    .select("id, status, last_error_code")
    .eq("id", data.jobId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (error || !job || job.status !== "dead_letter")
    throw error ?? new Error("This dead-letter job is not available.");
  const requeued = await requeueModelJob(job.id);
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "ai.tool_called",
    entityType: "ai_job",
    entityId: job.id,
    metadata: {
      event: "aios.dead_letter_requeued",
      previous_error_code: job.last_error_code,
    },
  });
  return requeued;
}

const gateInputSchema = z.object({
  organizationId: z.uuid(),
  action: z.string().min(3).max(120),
  entityType: z.string().trim().min(1).max(120),
  entityId: z.uuid().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  rationale: z.string().trim().max(2_000).nullable().optional(),
});

/**
 * Mandatory action gate for future agent tools. It returns authority to execute
 * only; it never performs an external effect itself. Approval requests are
 * durable, tenant-scoped, and routed to human approvers.
 */
export async function gateAiosAction(input: z.infer<typeof gateInputSchema>) {
  const data = gateInputSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const requesterId = claims?.claims.sub;
  if (claimsError || !requesterId) throw new Error("Sign in is required.");

  const { data: policy } = await supabase
    .from("ai_autonomy_policies")
    .select("mode, approval_roles, escalation_after_minutes, is_enabled")
    .eq("organization_id", data.organizationId)
    .eq("action", data.action)
    .maybeSingle();
  const catalogAction = getAiosAction(data.action);
  if (policy && !policy.is_enabled) {
    await recordAuditEvent({ organizationId: data.organizationId, eventType: "ai.action_blocked", entityType: data.entityType, entityId: data.entityId ?? undefined, metadata: { event: "aios.action_disabled", action: data.action } });
    return { decision: "blocked" as const, reason: "This AIOS workflow is disabled by a workspace owner." };
  }
  const decision = evaluateAutonomy(data.action, policy?.mode ?? catalogAction?.defaultMode ?? "approval_required");

  if (decision.decision === "approval_required") {
    const approvalRoles = policy?.approval_roles ?? ["owner", "admin"];
    const { data: approver } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("organization_id", data.organizationId)
      .eq("status", "active")
      .in("role", approvalRoles)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!approver) throw new Error("No active human approver is configured for this AIOS action.");

    const expiresAt = new Date(Date.now() + (policy?.escalation_after_minutes ?? 30) * 60_000).toISOString();
    const { data: approval, error } = await supabase.from("approval_requests").insert({
      organization_id: data.organizationId,
      requester_id: requesterId,
      approver_id: approver.user_id,
      action: data.action,
      entity_type: data.entityType,
      entity_id: data.entityId ?? null,
      payload: data.payload as Json,
      rationale: data.rationale ?? decision.reason,
      expires_at: expiresAt,
    }).select().single();
    if (error) throw error;
    await recordAuditEvent({ organizationId: data.organizationId, eventType: "approval.requested", entityType: data.entityType, entityId: data.entityId ?? undefined, metadata: { event: "aios.action_gated", action: data.action, approval_id: approval.id } });
    return { ...decision, approvalId: approval.id, approverId: approver.user_id, expiresAt };
  }

  const eventType = decision.decision === "blocked" ? "ai.action_blocked" : "ai.tool_called";
  await recordAuditEvent({ organizationId: data.organizationId, eventType, entityType: data.entityType, entityId: data.entityId ?? undefined, metadata: { event: "aios.action_gated", action: data.action, decision: decision.decision } });
  return decision;
}
