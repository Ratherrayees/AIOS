"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  reviewLeadIntakeDraft,
  startLeadIntakeRun,
  triageAtRiskLeads,
  triageInboxSlaRisks,
} from "../actions/agents";
import {
  addAiosModelPrice,
  requeueAiosJob,
  runReadyAiosJobs,
  setAiosBudgetPolicy,
  setAutonomyEnabled,
  setAutonomyMode,
} from "../actions/aios";
import { resolveApprovalRequest } from "../actions/approvals";
import { AIOS_ACTION_CATALOG, type AutonomyMode } from "../../lib/ai/autonomy";
import {
  MODEL_PROVIDERS,
  parseModelProvider,
  parseModelProviders,
  parseOptionalModelProvider,
  type ModelProvider,
} from "../../lib/env";
import {
  leadExtractionSchema,
  type LeadExtraction,
} from "../../lib/ai/contracts";
import {
  summarizeSalesCopilotQuality,
  type SalesCopilotQualityRow,
} from "../../lib/ai/sales-copilot-quality";
import { LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import "./aios.css";

const modes: { value: AutonomyMode; label: string; help: string }[] = [
  { value: "observe", label: "Observe", help: "Monitor and recommend only" },
  { value: "assist", label: "Assist", help: "Prepare work for people" },
  { value: "auto", label: "Auto", help: "Execute within this policy" },
  {
    value: "approval_required",
    label: "Approval",
    help: "Route every action to a human",
  },
];
const providerLabels: Record<ModelProvider, string> = {
  glm: "GLM",
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Claude",
  qwen: "Qwen",
};

type DealOption = { id: string; title: string; destination: string | null };
type PendingApproval = {
  id: string;
  action: string;
  entity_type: string;
  rationale: string | null;
  expires_at: string | null;
};
type ReviewRun = { id: string; result: unknown; created_at: string };
type ReviewField =
  "destination" | "travelStart" | "travelEnd" | "travellerCount";
type ProviderStatus = {
  provider: ModelProvider;
  model: string;
  configured: boolean;
};
type RunHistory = {
  id: string;
  agent_type: string;
  status: string;
  result: unknown;
  error_code: string | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
};
type ModelUsageRun = {
  id: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  estimated_cost_currency: string | null;
};
type ModelPrice = {
  id: string;
  provider: ModelProvider;
  model: string;
  currency: string;
  input_price_per_million: number;
  output_price_per_million: number;
  effective_from: string;
};
type AiJobTelemetry = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  available_at: string;
  last_error_code: string | null;
  updated_at: string;
};

function parseLeadDraft(result: unknown): LeadExtraction | null {
  const candidate =
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    "extraction" in result
      ? (result as { extraction: unknown }).extraction
      : result;
  const parsed = leadExtractionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function modelLabel(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return "Model details unavailable";
  const value = result as { provider?: unknown; model?: unknown };
  return typeof value.provider === "string" && typeof value.model === "string"
    ? `${value.provider} · ${value.model}`
    : "Model details unavailable";
}

async function fetchProviderStatus(provider?: ModelProvider) {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  const response = await fetch(`/api/aios/status${query}`, {
    cache: "no-store",
  });
  return response.ok ? ((await response.json()) as ProviderStatus) : null;
}

export default function AiosControlPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("your workspace");
  const [role, setRole] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, AutonomyMode>>({});
  const [disabledActions, setDisabledActions] = useState<Set<string>>(
    new Set(),
  );
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [reviewRuns, setReviewRuns] = useState<ReviewRun[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunHistory[]>([]);
  const [todayModelUsage, setTodayModelUsage] = useState<ModelUsageRun[]>([]);
  const [modelPrices, setModelPrices] = useState<ModelPrice[]>([]);
  const [priceModel, setPriceModel] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("USD");
  const [inputTokenPrice, setInputTokenPrice] = useState("");
  const [outputTokenPrice, setOutputTokenPrice] = useState("");
  const [aiJobs, setAiJobs] = useState<AiJobTelemetry[]>([]);
  const [copilotQualityRow, setCopilotQualityRow] =
    useState<SalesCopilotQualityRow | null>(null);
  const [copilotQualityAvailable, setCopilotQualityAvailable] = useState(false);
  const [reviewSelections, setReviewSelections] = useState<
    Record<string, ReviewField[]>
  >({});
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(
    null,
  );
  const [providerStatuses, setProviderStatuses] = useState<
    Partial<Record<ModelProvider, ProviderStatus>>
  >({});
  const [dailyModelRunLimit, setDailyModelRunLimit] = useState(30);
  const [modelExecutionEnabled, setModelExecutionEnabled] = useState(true);
  const [selectedModelProvider, setSelectedModelProvider] =
    useState<ModelProvider>("glm");
  const [fallbackModelProvider, setFallbackModelProvider] =
    useState<ModelProvider | null>(null);
  const [allowedModelProviders, setAllowedModelProviders] = useState<
    Set<ModelProvider>
  >(new Set(MODEL_PROVIDERS));
  const [notice, setNotice] = useState("");
  const [runNotice, setRunNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setNotice("No active workspace is available for this account.");
        setLoading(false);
        return;
      }
      setOrganizationId(membership.organization_id);
      setRole(membership.role);
      const utcDayStart = new Date();
      utcDayStart.setUTCHours(0, 0, 0, 0);
      const [
        { data: workspace },
        { data: policyRows },
        { data: dealRows },
        { data: approvalRows },
        { data: completedRuns },
        { data: reviewedRows },
        { data: runRows },
        { data: budgetPolicy },
        { data: usageRows },
        { data: jobRows },
        { data: priceRows },
        { data: qualityRow, error: qualityError },
      ] = await Promise.all([
        supabase
          .from("organizations")
          .select("name")
          .eq("id", membership.organization_id)
          .maybeSingle(),
        supabase
          .from("ai_autonomy_policies")
          .select("action, mode, is_enabled")
          .eq("organization_id", membership.organization_id),
        supabase
          .from("deals")
          .select("id, title, destination")
          .eq("organization_id", membership.organization_id)
          .order("updated_at", { ascending: false })
          .limit(20),
        supabase
          .from("approval_requests")
          .select("id, action, entity_type, rationale, expires_at")
          .eq("organization_id", membership.organization_id)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(20),
        supabase
          .from("ai_runs")
          .select("id, result, created_at")
          .eq("organization_id", membership.organization_id)
          .eq("agent_type", "lead_intake")
          .eq("status", "succeeded")
          .order("created_at", { ascending: false })
          .limit(12),
        supabase
          .from("ai_field_reviews")
          .select("ai_run_id")
          .eq("organization_id", membership.organization_id),
        supabase
          .from("ai_runs")
          .select(
            "id, agent_type, status, result, error_code, duration_ms, created_at, completed_at",
          )
          .eq("organization_id", membership.organization_id)
          .order("created_at", { ascending: false })
          .limit(12),
        supabase
          .from("ai_budget_policies")
          .select(
            "daily_model_run_limit, model_execution_enabled, selected_model_provider, fallback_model_provider, allowed_model_providers",
          )
          .eq("organization_id", membership.organization_id)
          .maybeSingle(),
        supabase
          .from("ai_runs")
          .select(
            "id, status, input_tokens, output_tokens, estimated_cost, estimated_cost_currency",
          )
          .eq("organization_id", membership.organization_id)
          .in("agent_type", [
            "lead_intake",
            "itinerary_draft",
            "knowledge_answer",
          ])
          .gte("created_at", utcDayStart.toISOString())
          .limit(1000),
        supabase
          .from("ai_jobs")
          .select(
            "id, job_type, status, attempts, max_attempts, available_at, last_error_code, updated_at",
          )
          .eq("organization_id", membership.organization_id)
          .order("updated_at", { ascending: false })
          .limit(1000),
        supabase
          .from("ai_model_prices")
          .select(
            "id, provider, model, currency, input_price_per_million, output_price_per_million, effective_from",
          )
          .eq("organization_id", membership.organization_id)
          .is("effective_to", null)
          .order("effective_from", { ascending: false })
          .limit(20),
        supabase
          .rpc("get_sales_copilot_quality_summary", {
            target_organization_id: membership.organization_id,
          })
          .single(),
      ]);
      if (workspace?.name) setWorkspaceName(workspace.name);
      setOverrides(
        Object.fromEntries(
          (policyRows || []).map((policy) => [policy.action, policy.mode]),
        ),
      );
      setDisabledActions(
        new Set(
          (policyRows || [])
            .filter((policy) => !policy.is_enabled)
            .map((policy) => policy.action),
        ),
      );
      const nextDeals = dealRows || [];
      setDeals(nextDeals);
      setSelectedDealId(nextDeals[0]?.id || "");
      setApprovals(approvalRows || []);
      const reviewedRunIds = new Set(
        (reviewedRows || []).map((review) => review.ai_run_id),
      );
      setReviewRuns(
        (completedRuns || []).filter((run) => !reviewedRunIds.has(run.id)),
      );
      setRecentRuns((runRows || []) as RunHistory[]);
      setTodayModelUsage((usageRows || []) as ModelUsageRun[]);
      setAiJobs((jobRows || []) as AiJobTelemetry[]);
      setModelPrices((priceRows || []) as ModelPrice[]);
      setCopilotQualityRow(
        qualityError ? null : (qualityRow as SalesCopilotQualityRow),
      );
      setCopilotQualityAvailable(!qualityError && Boolean(qualityRow));
      if (budgetPolicy) {
        const selectedProvider = parseModelProvider(
          budgetPolicy.selected_model_provider,
        );
        setDailyModelRunLimit(budgetPolicy.daily_model_run_limit);
        setModelExecutionEnabled(budgetPolicy.model_execution_enabled);
        setSelectedModelProvider(selectedProvider);
        setFallbackModelProvider(
          parseOptionalModelProvider(budgetPolicy.fallback_model_provider),
        );
        setAllowedModelProviders(
          new Set(
            parseModelProviders(budgetPolicy.allowed_model_providers),
          ),
        );
      }
      const statusEntries = await Promise.all(
        MODEL_PROVIDERS.map(async (provider) => [
          provider,
          await fetchProviderStatus(provider),
        ] as const),
      );
      const nextProviderStatuses = Object.fromEntries(
        statusEntries.filter((entry) => entry[1] !== null),
      ) as Partial<Record<ModelProvider, ProviderStatus>>;
      setProviderStatuses(nextProviderStatuses);
      const status = budgetPolicy
        ? nextProviderStatuses[
            parseModelProvider(budgetPolicy.selected_model_provider)
          ] ?? null
        : await fetchProviderStatus();
      if (status) {
        setProviderStatus(status);
        if (!budgetPolicy) setSelectedModelProvider(status.provider);
        setPriceModel(status.model);
      }
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load the control plane.");
      setLoading(false);
    });
  }, []);

  function setMode(action: string, mode: AutonomyMode) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const policy = await setAutonomyMode({ organizationId, action, mode });
        setOverrides((current) => ({
          ...current,
          [policy.action]: policy.mode,
        }));
        setNotice(`${action} is now set to ${policy.mode.replace("_", " ")}.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update this policy.",
        );
      }
    });
  }

  function setEnabled(action: string, isEnabled: boolean) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const policy = await setAutonomyEnabled({
          organizationId,
          action,
          isEnabled,
        });
        setDisabledActions((current) => {
          const next = new Set(current);
          if (policy.is_enabled) next.delete(policy.action);
          else next.add(policy.action);
          return next;
        });
        setNotice(
          `${action} is ${policy.is_enabled ? "enabled" : "disabled"}.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update this kill switch.",
        );
      }
    });
  }

  function saveBudgetPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !canManage || pending) return;
    startTransition(async () => {
      try {
        const policy = await setAiosBudgetPolicy({
          organizationId,
          dailyModelRunLimit,
          modelExecutionEnabled,
          selectedModelProvider,
          fallbackModelProvider,
          allowedModelProviders: [...allowedModelProviders],
        });
        const selectedProvider = parseModelProvider(
          policy.selected_model_provider,
        );
        setDailyModelRunLimit(policy.daily_model_run_limit);
        setModelExecutionEnabled(policy.model_execution_enabled);
        setSelectedModelProvider(selectedProvider);
        setFallbackModelProvider(
          parseOptionalModelProvider(policy.fallback_model_provider),
        );
        setAllowedModelProviders(
          new Set(parseModelProviders(policy.allowed_model_providers)),
        );
        const status = await fetchProviderStatus(
          selectedProvider,
        );
        if (status) {
          setProviderStatus(status);
          setProviderStatuses((current) => ({
            ...current,
            [status.provider]: status,
          }));
        }
        setNotice(
          policy.model_execution_enabled
            ? `Model execution is enabled with a ${policy.daily_model_run_limit}-run UTC daily ceiling.`
            : "Provider-backed model execution is disabled for this workspace.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update the model budget.",
        );
      }
    });
  }

  function selectProvider(provider: ModelProvider) {
    setSelectedModelProvider(provider);
    if (fallbackModelProvider === provider) setFallbackModelProvider(null);
    setPriceModel(providerStatuses[provider]?.model || "");
    setAllowedModelProviders((current) => {
      const next = new Set(current);
      next.add(provider);
      return next;
    });
  }

  function selectFallbackProvider(provider: ModelProvider | null) {
    setFallbackModelProvider(provider);
    if (!provider) return;
    setAllowedModelProviders((current) => new Set(current).add(provider));
  }

  function toggleAllowedProvider(provider: ModelProvider, allowed: boolean) {
    if (provider === selectedModelProvider && !allowed) return;
    if (provider === fallbackModelProvider && !allowed)
      setFallbackModelProvider(null);
    setAllowedModelProviders((current) => {
      const next = new Set(current);
      if (allowed) next.add(provider);
      else next.delete(provider);
      return next;
    });
  }

  async function refreshAiJobTelemetry() {
    if (!organizationId) return;
    const supabase = createSupabaseBrowserClient();
    const { data: jobs } = await supabase
      .from("ai_jobs")
      .select(
        "id, job_type, status, attempts, max_attempts, available_at, last_error_code, updated_at",
      )
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(1000);
    setAiJobs((jobs || []) as AiJobTelemetry[]);
  }

  function processReadyJobs() {
    if (!organizationId) return;
    startTransition(async () => {
      try {
        const summary = await runReadyAiosJobs({ organizationId });
        setRunNotice(
          `AIOS inspected ${summary.inspected} durable job${summary.inspected === 1 ? "" : "s"}: ${summary.succeeded} completed, ${summary.retried} scheduled for retry, ${summary.dead_lettered} moved to dead letter, and ${summary.skipped} safely skipped.`,
        );
        await refreshAiJobTelemetry();
      } catch {
        setRunNotice("AIOS could not process the ready job queue.");
      }
    });
  }

  function addModelPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    startTransition(async () => {
      try {
        const price = await addAiosModelPrice({
          organizationId,
          provider: selectedModelProvider,
          model: priceModel,
          currency: priceCurrency,
          inputPricePerMillion: Number(inputTokenPrice),
          outputPricePerMillion: Number(outputTokenPrice),
        });
        setModelPrices((current) => [price as ModelPrice, ...current]);
        setInputTokenPrice("");
        setOutputTokenPrice("");
        setNotice(
          `Approved ${price.provider}/${price.model} price version in ${price.currency}. Future metered runs can now estimate cost.`,
        );
      } catch {
        setNotice(
          "AIOS could not add this price. Check the model, currency, and non-negative per-million rates.",
        );
      }
    });
  }

  function requeueDeadLetter(jobId: string) {
    if (!organizationId) return;
    startTransition(async () => {
      try {
        await requeueAiosJob({ organizationId, jobId });
        setRunNotice(
          "The dead-letter job was requeued for a separate reviewed execution attempt.",
        );
        await refreshAiJobTelemetry();
      } catch {
        setRunNotice("AIOS could not requeue this dead-letter job.");
      }
    });
  }

  function runLeadIntake() {
    if (!organizationId || !selectedDealId || pending) return;
    startTransition(async () => {
      try {
        const result = await startLeadIntakeRun({
          organizationId,
          dealId: selectedDealId,
        });
        setRunNotice(
          result.status === "succeeded"
            ? `Lead intake completed: ${result.runId}. Refresh to review it.`
            : result.message || "AIOS blocked the run.",
        );
      } catch (error) {
        setRunNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not start this run.",
        );
      }
    });
  }

  function runLeadTriage() {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const result = await triageAtRiskLeads({ organizationId });
        setRunNotice(
          result.status === "completed"
            ? result.risks
              ? `AIOS triage checked ${result.risks} at-risk lead${result.risks === 1 ? "" : "s"}: ${result.created} follow-up${result.created === 1 ? "" : "s"} created, ${result.escalated} advanced to a higher SLA tier, ${result.skipped} already covered.`
              : "AIOS triage found no at-risk live opportunities."
            : result.status === "approval_required"
              ? "AIOS triage has been routed to a human approver."
              : `AIOS triage is ${result.status}.`,
        );
      } catch (error) {
        setRunNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not triage lead risks.",
        );
      }
    });
  }

  function runInboxSlaTriage() {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const result = await triageInboxSlaRisks({ organizationId });
        setRunNotice(
          result.status === "completed"
            ? result.risks
              ? `AIOS checked ${result.risks} overdue Inbox SLA${result.risks === 1 ? "" : "s"}: ${result.created} internal follow-up${result.created === 1 ? "" : "s"} created, ${result.escalated} advanced to a higher tier, ${result.skipped} already current.`
              : "AIOS found no overdue Inbox response deadlines."
            : result.status === "approval_required"
              ? "Inbox SLA triage has been routed to a human approver."
              : `Inbox SLA triage is ${result.status}.`,
        );
      } catch (error) {
        setRunNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not triage Inbox SLA risks.",
        );
      }
    });
  }

  function resolveApproval(
    approvalId: string,
    decision: "approved" | "rejected",
  ) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const result = await resolveApprovalRequest({
          organizationId,
          approvalId,
          decision,
        });
        setApprovals((current) =>
          current.filter((approval) => approval.id !== approvalId),
        );
        setRunNotice(
          result.resumedRun
            ? `Approval recorded. AIOS run ${result.resumedRun.runId} is ${result.resumedRun.status}.`
            : `Approval ${decision}.`,
        );
      } catch (error) {
        setRunNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not resolve this approval.",
        );
      }
    });
  }

  function toggleReviewField(
    runId: string,
    field: ReviewField,
    defaults: ReviewField[],
  ) {
    setReviewSelections((current) => {
      const selected = current[runId] ?? defaults;
      return {
        ...current,
        [runId]: selected.includes(field)
          ? selected.filter((candidate) => candidate !== field)
          : [...selected, field],
      };
    });
  }

  function submitLeadReview(runId: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const result = await reviewLeadIntakeDraft({
          organizationId,
          runId,
          acceptedFields: reviewSelections[runId] || [],
        });
        setReviewRuns((current) => current.filter((run) => run.id !== runId));
        const taskNotice =
          result.followUp?.status === "created"
            ? " AIOS also created an internal follow-up task."
            : result.followUp?.status === "approval_required"
              ? " The follow-up task was routed for approval."
              : "";
        setRunNotice(
          (result.acceptedFields.length
            ? `Applied ${result.acceptedFields.length} reviewed field${result.acceptedFields.length === 1 ? "" : "s"} to the lead.`
            : "Draft rejected and recorded.") + taskNotice,
        );
      } catch (error) {
        setRunNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save this review.",
        );
      }
    });
  }

  const canManage = role === "owner" || role === "admin";
  const canApprove = canManage || role === "operations" || role === "finance";
  const inputTokensToday = todayModelUsage.reduce(
    (total, run) => total + (run.input_tokens || 0),
    0,
  );
  const outputTokensToday = todayModelUsage.reduce(
    (total, run) => total + (run.output_tokens || 0),
    0,
  );
  const unmeteredRunsToday = todayModelUsage.filter(
    (run) =>
      run.status === "succeeded" &&
      run.input_tokens === null &&
      run.output_tokens === null,
  ).length;
  const pricedUsageByCurrency = Object.entries(
    todayModelUsage.reduce<Record<string, number>>((totals, run) => {
      if (
        run.estimated_cost !== null &&
        run.estimated_cost_currency !== null
      ) {
        totals[run.estimated_cost_currency] =
          (totals[run.estimated_cost_currency] || 0) + run.estimated_cost;
      }
      return totals;
    }, {}),
  );
  const queuedJobs = aiJobs.filter((job) => job.status === "queued").length;
  const runningJobs = aiJobs.filter((job) => job.status === "running").length;
  const retryJobs = aiJobs.filter((job) => job.status === "failed").length;
  const deadLetterJobs = aiJobs.filter(
    (job) => job.status === "dead_letter",
  ).length;
  const recentDeadLetters = aiJobs
    .filter((job) => job.status === "dead_letter")
    .slice(0, 5);
  const nextRetryAt = aiJobs
    .filter((job) => job.status === "failed")
    .map((job) => job.available_at)
    .sort()[0];
  const copilotQuality = summarizeSalesCopilotQuality(copilotQualityRow);

  return (
    <main className="aios-page" id="main-content" tabIndex={-1}>
      <FeatureHeader links={[{ href: "/", label: "Back to workspace" }]} />
      <section className="aios-hero">
        <p>AIOS CONTROL PLANE</p>
        <h1>Set how autonomous your travel operation should be.</h1>
        <span>
          {workspaceName} decides when AIOS observes, assists, acts
          automatically, or asks a human.
        </span>
        <div>
          <b>Policy owner:</b> {role || "loading"} <i>/</i>{" "}
          <b>
            {providerStatus
              ? `${providerStatus.provider} · ${providerStatus.model} · ${providerStatus.configured ? "ready" : "not configured"}`
              : pending
                ? "Saving policy..."
                : "Every change is audited"}
          </b>
        </div>
      </section>
      <section className="aios-safety">
        <span>*</span>
        <p>
          <b>Autonomy is bounded, not blind.</b>
          <small>
            Traveller and supplier messages, document and quote sharing,
            pricing, bookings, and refunds always require human approval. They
            cannot be put on Auto.
          </small>
        </p>
      </section>
      {notice && (
        <p className="aios-notice" role="status">
          {notice}
        </p>
      )}
      <section className="aios-budget">
        <div>
          <p>WORKSPACE MODEL BUDGET</p>
          <h2>Control provider-backed execution</h2>
          <span>
            The UTC daily ceiling covers Lead Intake and itinerary model runs.
            Internal deterministic triage remains governed by its own action
            policies.
          </span>
        </div>
        <form onSubmit={saveBudgetPolicy}>
          <label>
            Daily run ceiling
            <input
              type="number"
              min={1}
              max={1000}
              value={dailyModelRunLimit}
              disabled={!canManage || pending}
              onChange={(event) =>
                setDailyModelRunLimit(Number(event.target.value))
              }
            />
          </label>
          <label>
            Selected provider
            <select
              value={selectedModelProvider}
              disabled={!canManage || pending}
              onChange={(event) =>
                selectProvider(event.target.value as ModelProvider)
              }
            >
              {MODEL_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {providerLabels[provider]}
                  {providerStatuses[provider]
                    ? providerStatuses[provider]?.configured
                      ? " · ready"
                      : " · not configured"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Transient fallback
            <select
              aria-label="Transient fallback"
              value={fallbackModelProvider ?? ""}
              disabled={!canManage || pending}
              onChange={(event) =>
                selectFallbackProvider(
                  event.target.value
                    ? (event.target.value as ModelProvider)
                    : null,
                )
              }
            >
              <option value="">No fallback</option>
              {MODEL_PROVIDERS.map((provider) => (
                <option
                  key={provider}
                  value={provider}
                  disabled={provider === selectedModelProvider}
                >
                  {providerLabels[provider]}
                  {providerStatuses[provider]
                    ? providerStatuses[provider]?.configured
                      ? " Â· ready"
                      : " Â· not configured"
                    : ""}
                </option>
              ))}
            </select>
            <small>
              Used once only for network, timeout, rate-limit, or provider 5xx
              failures. Safety, invalid output, policy, budget, authentication,
              and approval failures never fall back.
            </small>
          </label>
          <label className="aios-budget-switch">
            <input
              type="checkbox"
              checked={modelExecutionEnabled}
              disabled={!canManage || pending}
              onChange={(event) =>
                setModelExecutionEnabled(event.target.checked)
              }
            />
            <span>
              <b>Model execution</b>
              <small>
                {modelExecutionEnabled
                  ? "Enabled within the daily ceiling"
                  : "Disabled across this workspace"}
              </small>
            </span>
          </label>
          <button disabled={!canManage || pending}>Save budget policy</button>
          <fieldset className="aios-provider-allowlist">
            <legend>Allowed providers</legend>
            {MODEL_PROVIDERS.map((provider) => (
              <label key={provider}>
                <input
                  type="checkbox"
                  checked={allowedModelProviders.has(provider)}
                  disabled={
                    !canManage ||
                    pending ||
                    provider === selectedModelProvider
                  }
                  onChange={(event) =>
                    toggleAllowedProvider(provider, event.target.checked)
                  }
                />
                <span>
                  {providerLabels[provider]}
                  <small>
                    {providerStatuses[provider]?.configured
                      ? "ready"
                      : "not configured"}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
        </form>
        <div className="aios-budget-usage" aria-label="Today's AIOS usage">
          <div>
            <small>WORKFLOW ATTEMPTS</small>
            <b>{todayModelUsage.length}</b>
          </div>
          <div>
            <small>INPUT TOKENS</small>
            <b>{inputTokensToday.toLocaleString()}</b>
          </div>
          <div>
            <small>OUTPUT TOKENS</small>
            <b>{outputTokensToday.toLocaleString()}</b>
          </div>
          <div>
            <small>UNMETERED SUCCESSES</small>
            <b>{unmeteredRunsToday}</b>
          </div>
          <p>
            UTC-day usage comes from provider responses. Cost appears only
            when the exact provider/model has an effective approved price.
          </p>
        </div>
      </section>

      <section className="aios-pricing" aria-labelledby="aios-pricing-title">
        <div>
          <p>Approved cost telemetry</p>
          <h2 id="aios-pricing-title">Model price catalog</h2>
          <span>
            AIOS never guesses vendor pricing. Add a reviewed input/output rate
            per one million tokens; earlier runs remain unpriced.
          </span>
          <div className="aios-price-list">
            {modelPrices.length ? (
              modelPrices.slice(0, 5).map((price) => (
                <small key={price.id}>
                  <b>
                    {price.provider} · {price.model}
                  </b>
                  {price.currency} {price.input_price_per_million} in /{" "}
                  {price.output_price_per_million} out
                </small>
              ))
            ) : (
              <small>No approved model prices yet.</small>
            )}
          </div>
          {pricedUsageByCurrency.length ? (
            <em>
              Today:{" "}
              {pricedUsageByCurrency
                .map(
                  ([currency, amount]) =>
                    `${currency} ${amount.toFixed(6)}`,
                )
                .join(" · ")}
            </em>
          ) : null}
        </div>
        <form onSubmit={addModelPrice}>
          <label>
            Exact model
            <input
              value={priceModel}
              onChange={(event) => setPriceModel(event.target.value)}
              placeholder={providerStatus?.model || "Provider model ID"}
              required
              disabled={!canManage || pending}
            />
          </label>
          <label>
            Currency
            <input
              value={priceCurrency}
              onChange={(event) =>
                setPriceCurrency(event.target.value.toUpperCase())
              }
              pattern="[A-Za-z]{3}"
              maxLength={3}
              required
              disabled={!canManage || pending}
            />
          </label>
          <label>
            Input / 1M
            <input
              type="number"
              min="0"
              step="0.000001"
              value={inputTokenPrice}
              onChange={(event) => setInputTokenPrice(event.target.value)}
              required
              disabled={!canManage || pending}
            />
          </label>
          <label>
            Output / 1M
            <input
              type="number"
              min="0"
              step="0.000001"
              value={outputTokenPrice}
              onChange={(event) => setOutputTokenPrice(event.target.value)}
              required
              disabled={!canManage || pending}
            />
          </label>
          <button disabled={!canManage || pending}>
            Add approved price
          </button>
        </form>
      </section>

      <section className="aios-queue" aria-labelledby="aios-queue-title">
        <header>
          <div>
            <p>Durable execution</p>
            <h2 id="aios-queue-title">AIOS job queue</h2>
            <span>
              Provider calls are idempotent, atomically leased, and retained
              across request failures without storing raw customer text.
            </span>
          </div>
          <b className={deadLetterJobs > 0 ? "attention" : ""}>
            {deadLetterJobs > 0 ? "Needs attention" : "Queue healthy"}
          </b>
        </header>
        <div className="aios-queue-stats">
          <div>
            <small>Queued</small>
            <strong>{queuedJobs}</strong>
          </div>
          <div>
            <small>Running</small>
            <strong>{runningJobs}</strong>
          </div>
          <div>
            <small>Retry wait</small>
            <strong>{retryJobs}</strong>
          </div>
          <div>
            <small>Dead letter</small>
            <strong>{deadLetterJobs}</strong>
          </div>
        </div>
        {recentDeadLetters.length ? (
          <div className="aios-dead-letters">
            <p>Reviewed replay required</p>
            {recentDeadLetters.map((job) => (
              <article key={job.id}>
                <div>
                  <b>{job.job_type.replaceAll("_", " ")}</b>
                  <span>
                    {job.last_error_code || "Unknown failure"} ·{" "}
                    {job.attempts}/{job.max_attempts} attempts ·{" "}
                    {new Date(job.updated_at).toLocaleString()}
                  </span>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => requeueDeadLetter(job.id)}
                    disabled={pending}
                  >
                    Requeue
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
        <footer>
          <div>
            <span>
              Inline execution is active now. Owners can process ready retries
              here; unattended scheduling still needs the final deployment
              worker secret and scheduler.
            </span>
            {nextRetryAt ? (
              <time dateTime={nextRetryAt}>
                Next retry ready {new Date(nextRetryAt).toLocaleString()}
              </time>
            ) : null}
          </div>
          <button
            type="button"
            onClick={processReadyJobs}
            disabled={!canManage || pending || queuedJobs + retryJobs === 0}
          >
            Process ready jobs
          </button>
        </footer>
      </section>
      <section className="aios-runtime" id="lead-intake">
        <div>
          <p>LIVE AGENT RUNTIME</p>
          <h2>Lead Intake</h2>
          <span>
            Analyse a selected CRM lead into a structured draft. AIOS records
            every run and checks the autonomy policy before the model is called.
          </span>
        </div>
        <div className="aios-runtime-controls">
          <select
            aria-label="Lead to analyse"
            value={selectedDealId}
            onChange={(event) => setSelectedDealId(event.target.value)}
            disabled={pending || deals.length === 0}
          >
            {deals.length === 0 ? (
              <option value="">No leads available</option>
            ) : (
              deals.map((deal) => (
                <option key={deal.id} value={deal.id}>
                  {deal.title}
                  {deal.destination ? ` - ${deal.destination}` : ""}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={runLeadIntake}
            disabled={pending || !selectedDealId}
          >
            Run lead intake
          </button>
          <button type="button" onClick={runLeadTriage} disabled={pending}>
            Triage lead risks
          </button>
          <button type="button" onClick={runInboxSlaTriage} disabled={pending}>
            Triage Inbox SLAs
          </button>
        </div>
      </section>
      <section
        className="aios-copilot-quality"
        aria-label="Sales Copilot review calibration"
      >
        <header>
          <div>
            <p>QUALITY FEEDBACK LOOP</p>
            <h2>Review feedback, not guesswork</h2>
            <span>
              Immutable review decisions show how often AIOS drafts are
              accepted, revised, and recovered. Draft text, feedback text,
              recipients, and reviewer identities never enter this aggregate.
            </span>
          </div>
          <b>{copilotQuality?.sample.label || "Evidence unavailable"}</b>
        </header>
        {copilotQualityAvailable && copilotQuality ? (
          <>
            <div className="copilot-quality-stats">
              <div aria-label="Reviewed AI drafts">
                <small>REVIEWED AI DRAFTS</small>
                <strong>{copilotQuality.reviewedDrafts}</strong>
                <span>
                  {copilotQuality.totalDrafts} generated in retained history
                </span>
              </div>
              <div aria-label="First-pass approval rate">
                <small>FIRST-PASS APPROVAL</small>
                <strong>
                  {copilotQuality.firstPassApprovalRate === null
                    ? "—"
                    : `${copilotQuality.firstPassApprovalRate}%`}
                </strong>
                <span>Earliest immutable decision per draft</span>
              </div>
              <div aria-label="Feedback recovery">
                <small>RECOVERED AFTER FEEDBACK</small>
                <strong>
                  {copilotQuality.recoveredAfterFeedback} /{" "}
                  {copilotQuality.initialFeedbackDrafts}
                </strong>
                <span>Later exact revision approved</span>
              </div>
              <div aria-label="Current revision approval">
                <small>CURRENT REVISION APPROVED</small>
                <strong>
                  {copilotQuality.currentRevisionApproved} /{" "}
                  {copilotQuality.activeDrafts}
                </strong>
                <span>
                  {copilotQuality.currentRevisionAttention}{" "}
                  {copilotQuality.currentRevisionAttention === 1
                    ? "current revision needs"
                    : "current revisions need"}{" "}
                  review attention
                </span>
              </div>
            </div>
            <div className="copilot-quality-decisions">
              <div>
                <span>
                  <i className="approved" /> Approved{" "}
                  {copilotQuality.decisions.approved}
                </span>
                <span>
                  <i className="changes" /> Changes requested{" "}
                  {copilotQuality.decisions.changesRequested}
                </span>
                <span>
                  <i className="rejected" /> Rejected{" "}
                  {copilotQuality.decisions.rejected}
                </span>
              </div>
              <p>
                {copilotQuality.sample.code === "none"
                  ? "Review AI-generated Inbox drafts to start this feedback loop."
                  : copilotQuality.sample.code === "emerging"
                    ? `Collect at least ${copilotQuality.sample.target} reviewed drafts before treating rates as directional.`
                    : "Use these outcomes to tune prompts and workflow—not to claim conversion impact or causal model quality."}
              </p>
              <a href="/inbox">Review Sales Copilot drafts</a>
            </div>
          </>
        ) : (
          <p className="aios-empty">
            AIOS could not verify the aggregate review ledger, so no quality
            rate is shown.
          </p>
        )}
        <footer>
          <span>Aggregate decision metadata only</span>
          <span>No conversion claim · no draft or feedback content</span>
          {copilotQuality?.latestReviewedAt ? (
            <time dateTime={copilotQuality.latestReviewedAt}>
              Latest review{" "}
              {new Date(copilotQuality.latestReviewedAt).toLocaleString()}
            </time>
          ) : null}
        </footer>
      </section>
      {runNotice && (
        <p className="aios-notice" role="status">
          {runNotice}
        </p>
      )}
      <section className="aios-reviews">
        <header>
          <div>
            <p>HUMAN REVIEW REQUIRED</p>
            <h2>Lead Intake drafts</h2>
          </div>
          <span>{reviewRuns.length} awaiting review</span>
        </header>
        {reviewRuns.length === 0 ? (
          <p className="aios-empty">
            No completed lead drafts are waiting for review.
          </p>
        ) : (
          reviewRuns.map((run) => {
            const draft = parseLeadDraft(run.result);
            if (!draft) return null;
            const fields: {
              key: ReviewField;
              label: string;
              value: string | number | null;
            }[] = [
              {
                key: "destination",
                label: "Destination",
                value: draft.destination,
              },
              {
                key: "travelStart",
                label: "Travel start",
                value: draft.travelStart,
              },
              { key: "travelEnd", label: "Travel end", value: draft.travelEnd },
              {
                key: "travellerCount",
                label: "Travellers",
                value: draft.travellerCount,
              },
            ];
            const defaults = fields
              .filter((field) => field.value !== null)
              .map((field) => field.key);
            const selected = reviewSelections[run.id] ?? defaults;
            return (
              <article key={run.id} className="lead-review-card">
                <div className="lead-review-head">
                  <div>
                    <b>AIOS Lead Intake</b>
                    <span>
                      Confidence {Math.round(draft.confidence * 100)}% /{" "}
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                  </div>
                  <small>
                    {draft.citations.length} CRM source
                    {draft.citations.length === 1 ? "" : "s"}
                  </small>
                </div>
                <div className="lead-review-fields">
                  {fields.map((field) => (
                    <label
                      key={field.key}
                      className={field.value === null ? "empty" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(field.key)}
                        disabled={field.value === null || pending}
                        onChange={() =>
                          toggleReviewField(run.id, field.key, defaults)
                        }
                      />
                      <span>
                        <b>{field.label}</b>
                        <small>
                          {field.value === null
                            ? "No value proposed"
                            : String(field.value)}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="lead-review-evidence">
                  <b>Evidence:</b>{" "}
                  {draft.citations
                    .map((citation) => citation.label)
                    .join(" / ")}
                </p>
                {draft.missingInformation.length > 0 && (
                  <p className="lead-review-missing">
                    <b>Still needed:</b> {draft.missingInformation.join(" / ")}
                  </p>
                )}
                <footer>
                  <span>
                    Select the fields you want to apply. Unselected fields are
                    recorded as rejected.
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => submitLeadReview(run.id)}
                  >
                    {selected.length ? "Apply selected fields" : "Reject draft"}
                  </button>
                </footer>
              </article>
            );
          })
        )}
      </section>
      <section className="aios-run-history">
        <header>
          <div>
            <p>AGENT RUN LEDGER</p>
            <h2>What AIOS has actually done</h2>
          </div>
          <span>{recentRuns.length} recent runs</span>
        </header>
        {recentRuns.length === 0 ? (
          <p className="aios-empty">
            No agent runs have been recorded in this workspace.
          </p>
        ) : (
          recentRuns.map((run) => (
            <article key={run.id}>
              <i className={run.status}>
                {run.status === "succeeded"
                  ? "✓"
                  : run.status === "blocked" || run.status === "failed"
                    ? "!"
                    : "•"}
              </i>
              <div>
                <b>{run.agent_type.replaceAll("_", " ")}</b>
                <span>
                  {run.status.replaceAll("_", " ")} · {modelLabel(run.result)}
                </span>
                <small>
                  {new Date(run.created_at).toLocaleString()}
                  {run.duration_ms !== null
                    ? ` · ${(run.duration_ms / 1000).toFixed(1)}s`
                    : ""}
                  {run.error_code ? ` · ${run.error_code}` : ""}
                </small>
              </div>
              <em>{run.completed_at ? "finished" : "active"}</em>
            </article>
          ))
        )}
      </section>
      <section className="aios-approvals" id="approval-queue">
        <header>
          <div>
            <p>HUMAN DECISION QUEUE</p>
            <h2>Approvals waiting for you</h2>
          </div>
          <span>{approvals.length} pending</span>
        </header>
        {approvals.length === 0 ? (
          <p className="aios-empty">
            No actions are waiting for a human decision.
          </p>
        ) : (
          approvals.map((approval) => (
            <article key={approval.id}>
              <div>
                <b>{approval.action.replaceAll(".", " ")}</b>
                <span>
                  {approval.rationale ||
                    `AIOS requested an action on a ${approval.entity_type}.`}
                </span>
                <small>
                  {approval.expires_at
                    ? `Expires ${new Date(approval.expires_at).toLocaleString()}`
                    : "No expiry configured"}
                </small>
              </div>
              <aside>
                <button
                  type="button"
                  className="approve"
                  disabled={!canApprove || pending}
                  onClick={() => resolveApproval(approval.id, "approved")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="reject"
                  disabled={!canApprove || pending}
                  onClick={() => resolveApproval(approval.id, "rejected")}
                >
                  Reject
                </button>
              </aside>
            </article>
          ))
        )}
      </section>
      <section className="autonomy-grid">
        {AIOS_ACTION_CATALOG.map((item) => {
          const current = overrides[item.action] ?? item.defaultMode;
          const disabled = disabledActions.has(item.action);
          return (
            <article className="autonomy-card" key={item.action}>
              <header>
                <div>
                  <p>{item.hardApproval ? "HUMAN GATE" : "AIOS WORKFLOW"}</p>
                  <h2>{item.title}</h2>
                </div>
                <span
                  className={`autonomy-state ${disabled ? "observe" : current}`}
                >
                  {disabled ? "disabled" : current.replace("_", " ")}
                </span>
              </header>
              <p className="autonomy-description">{item.description}</p>
              <button
                className="aios-kill-switch"
                type="button"
                disabled={!canManage || pending}
                onClick={() => setEnabled(item.action, disabled)}
              >
                {disabled ? "Enable workflow" : "Disable workflow"}
              </button>
              <div className="autonomy-modes">
                {modes.map((mode) => {
                  const locked =
                    disabled ||
                    (item.hardApproval && mode.value !== "approval_required");
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      disabled={!canManage || pending || locked}
                      className={current === mode.value ? "active" : ""}
                      onClick={() => setMode(item.action, mode.value)}
                    >
                      <b>{mode.label}</b>
                      <small>
                        {locked
                          ? disabled
                            ? "Workflow disabled"
                            : "Human approval required"
                          : mode.help}
                      </small>
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>
      {loading && (
        <div className="aios-notice">
          <LoadingState label="Loading policy controls" rows={2} />
        </div>
      )}
      <section className="aios-footer">
        <h2>How escalation works</h2>
        <p>
          When an action requires approval, AIOS creates a durable approval
          request, explains the proposed action, and routes it to an authorized
          human. The actual tool cannot execute until that gate is satisfied.
        </p>
      </section>
    </main>
  );
}
