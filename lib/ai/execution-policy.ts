import "server-only";

import {
  MODEL_PROVIDERS,
  modelProviderSchema,
  parseModelProvider,
  parseModelProviders,
} from "../env";
import { createSupabaseAdminClient } from "../supabase/admin";
import { dailyRunLimitExceeded, resolveAiosBudgetPolicy } from "./budget";
import { getAiosProviderStatus } from "./openai-provider";
import { validFallbackProvider } from "./provider-fallback";
import {
  ITINERARY_DRAFT_AGENT,
  KNOWLEDGE_ANSWER_AGENT,
  LEAD_INTAKE_AGENT,
} from "./runtime";

export async function loadOrganizationModelBudget(organizationId: string) {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const admin = createSupabaseAdminClient();
  const [
    { count, error: countError },
    { data: storedPolicy, error: policyError },
  ] = await Promise.all([
    admin
      .from("ai_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("agent_type", [
        LEAD_INTAKE_AGENT.type,
        ITINERARY_DRAFT_AGENT.type,
        KNOWLEDGE_ANSWER_AGENT.type,
      ])
      .gte("created_at", dayStart.toISOString()),
    admin
      .from("ai_budget_policies")
      .select(
        "daily_model_run_limit, model_execution_enabled, selected_model_provider, fallback_model_provider, allowed_model_providers",
      )
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  if (countError || policyError) throw countError || policyError;
  const environmentDefaultProvider = getAiosProviderStatus().provider;
  const selectedModelProvider = parseModelProvider(
    storedPolicy?.selected_model_provider,
    environmentDefaultProvider,
  );
  const allowedModelProviders = parseModelProviders(
    storedPolicy?.allowed_model_providers,
    MODEL_PROVIDERS,
  );
  const parsedFallback =
    storedPolicy?.fallback_model_provider == null
      ? null
      : modelProviderSchema.safeParse(storedPolicy.fallback_model_provider);
  const fallbackModelProvider =
    parsedFallback === null
      ? null
      : parsedFallback.success
        ? parsedFallback.data
        : null;
  const fallbackPolicyValid =
    parsedFallback === null ||
    (parsedFallback.success &&
      validFallbackProvider({
        primary: selectedModelProvider,
        fallback: fallbackModelProvider,
        allowedProviders: allowedModelProviders,
      }));
  return {
    ...resolveAiosBudgetPolicy(storedPolicy),
    todayModelRunCount: count || 0,
    selectedModelProvider,
    fallbackModelProvider,
    allowedModelProviders,
    providerAllowed: allowedModelProviders.includes(selectedModelProvider),
    fallbackPolicyValid,
  };
}

export function modelBudgetBlockReason(
  budget: Awaited<ReturnType<typeof loadOrganizationModelBudget>>,
) {
  if (!budget.modelExecutionEnabled)
    return {
      code: "AI_MODEL_EXECUTION_DISABLED",
      event: "aios.model_execution_disabled",
      message: "AIOS model execution is disabled for this workspace.",
    };
  if (!budget.providerAllowed)
    return {
      code: "AI_PROVIDER_NOT_ALLOWED",
      event: "aios.provider_not_allowed",
      message: `The selected ${budget.selectedModelProvider} provider is not allowed for this workspace.`,
    };
  if (!budget.fallbackPolicyValid)
    return {
      code: "AI_FALLBACK_POLICY_INVALID",
      event: "aios.fallback_policy_invalid",
      message:
        "The configured fallback must differ from the primary provider and remain inside the workspace allow-list.",
    };
  if (
    dailyRunLimitExceeded(
      budget.todayModelRunCount,
      budget.dailyRunLimit,
    )
  )
    return {
      code: "AI_DAILY_RUN_LIMIT",
      event: "aios.daily_run_limit_blocked",
      message: `AIOS reached this workspace's daily model-run limit (${budget.dailyRunLimit}).`,
    };
  return null;
}
