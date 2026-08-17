"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  reviewLeadIntakeDraft,
  runDailyAiosCoordinator,
  startLeadIntakeRun,
  triageAtRiskLeads,
  triageInboxSlaRisks,
} from "../actions/agents";
import {
  addAiosModelPrice,
  requeueAiosJob,
  runReadyAiosJobs,
  setAiosBudgetPolicy,
  setAiosOperatingMode,
  setAutonomyEnabled,
  setAutonomyMode,
} from "../actions/aios";
import {
  escalateApprovalRequest,
  resolveApprovalRequest,
} from "../actions/approvals";
import { AIOS_ACTION_CATALOG, type AutonomyMode } from "../../lib/ai/autonomy";
import {
  canResolveApproval as canResolveApprovalAccess,
  isInPersonalApprovalQueue,
} from "../../lib/ai/approval-access";
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
import { OperationalPageHeader } from "../../components/ui/operational-page-header";
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
const automationCategories = [
  {
    label: "Workspace coordination",
    actions: ["workspace.daily.coordinate"],
  },
  {
    label: "Sales",
    actions: [
      "internal.task.create",
      "crm.lead.triage",
      "crm.deal.route",
      "crm.field_draft.create",
      "quote.share",
      "pricing.override",
    ],
  },
  {
    label: "Customer communication",
    actions: [
      "inbox.sla.triage",
      "inbox.reply_draft.prepare",
      "external_message.send",
    ],
  },
  {
    label: "Trips & suppliers",
    actions: [
      "trip.operations.monitor",
      "itinerary.draft.prepare",
      "supplier.follow_up.send",
      "booking.confirm",
      "document.share",
    ],
  },
  {
    label: "Finance",
    actions: ["invoice.issue", "payment.link.create", "payment.refund"],
  },
  {
    label: "Knowledge",
    actions: ["knowledge.answer.compose"],
  },
] as const;
const providerLabels: Record<ModelProvider, string> = {
  groq: "Groq",
  glm: "ZhiPuAI (GLM)",
  nvidia: "NVIDIA NIM",
  openrouter: "OpenRouter",
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
  entity_id: string | null;
  rationale: string | null;
  requester_id: string;
  approver_id: string | null;
  created_at: string;
  expires_at: string | null;
  escalation_count: number;
  last_escalated_at: string | null;
  last_escalation_outcome: string | null;
};
type ApprovalPerson = { name: string; role: string | null };
type ApprovalScope = "mine" | "workspace";
type ActivityStatus = "all" | "succeeded" | "failed" | "blocked" | "active";
type ReviewRun = { id: string; result: unknown; created_at: string };
type ReviewField =
  "destination" | "travelStart" | "travelEnd" | "travellerCount";
type ProviderStatus = {
  provider: ModelProvider;
  model: string;
  configured: boolean;
  source?: "deployment" | "tenant";
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

function latestPendingLeadRuns(
  completedRuns: ReviewRun[],
  reviewedRunIds: ReadonlySet<string>,
) {
  const seenLeads = new Set<string>();
  return completedRuns.filter((run) => {
    const draft = parseLeadDraft(run.result);
    const leadId = draft?.citations.find(
      (citation) => citation.sourceType === "deal",
    )?.sourceId;
    const queueKey = leadId || `run:${run.id}`;
    if (seenLeads.has(queueKey)) return false;
    seenLeads.add(queueKey);
    return !reviewedRunIds.has(run.id);
  });
}

function modelLabel(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return "Model details unavailable";
  const value = result as { provider?: unknown; model?: unknown };
  return typeof value.provider === "string" && typeof value.model === "string"
    ? `${value.provider} · ${value.model}`
    : "Model details unavailable";
}

function approvalEntityLink(approval: PendingApproval) {
  if (!approval.entity_id) return null;
  if (approval.entity_type === "deal") return `/leads/${approval.entity_id}`;
  if (approval.entity_type === "trip") return `/trips/${approval.entity_id}`;
  if (approval.entity_type === "quote") return "/quotes";
  if (approval.entity_type === "conversation") return "/inbox";
  if (
    approval.entity_type === "invoice_draft" ||
    approval.entity_type === "payment_link_draft" ||
    approval.entity_type === "payment"
  )
    return "/finance";
  return null;
}

async function fetchProviderStatus(
  provider?: ModelProvider,
  organizationId?: string,
) {
  const parameters = new URLSearchParams();
  if (provider) parameters.set("provider", provider);
  if (organizationId) parameters.set("organizationId", organizationId);
  const query = parameters.size ? `?${parameters.toString()}` : "";
  const response = await fetch(`/api/aios/status${query}`, {
    cache: "no-store",
  });
  return response.ok ? ((await response.json()) as ProviderStatus) : null;
}

export default function AiosControlPage() {
  const pathname = usePathname();
  const router = useRouter();
  const surface = pathname.startsWith("/aios/approvals")
    ? "approvals"
    : pathname.startsWith("/aios/automations")
      ? "automations"
      : "activity";
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, AutonomyMode>>({});
  const [approvalRolesByAction, setApprovalRolesByAction] = useState<
    Record<string, string[]>
  >({});
  const [disabledActions, setDisabledActions] = useState<Set<string>>(
    new Set(),
  );
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [selectedDealId, setSelectedDealId] = useState("");
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [approvalPeople, setApprovalPeople] = useState<
    Record<string, ApprovalPerson>
  >({});
  const [approvalScope, setApprovalScope] =
    useState<ApprovalScope>("mine");
  const [reviewRuns, setReviewRuns] = useState<ReviewRun[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunHistory[]>([]);
  const [activityStatus, setActivityStatus] =
    useState<ActivityStatus>("all");
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
  const [approvalClock, setApprovalClock] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (pathname !== "/aios") return;
    const hash = window.location.hash;
    router.replace(
      hash === "#approvals" || hash === "#approval-queue"
        ? "/aios/approvals"
        : hash === "#automations" || hash === "#operating-mode"
          ? "/aios/automations"
          : "/aios/activity",
    );
  }, [pathname, router]);

  useEffect(() => {
    const refreshApprovalClock = () => setApprovalClock(Date.now());
    refreshApprovalClock();
    const interval = window.setInterval(refreshApprovalClock, 30_000);
    return () => window.clearInterval(interval);
  }, []);

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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);
      const utcDayStart = new Date();
      utcDayStart.setUTCHours(0, 0, 0, 0);
      const [
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
        { data: approvalMemberRows },
      ] = await Promise.all([
        supabase
          .from("ai_autonomy_policies")
          .select("action, mode, is_enabled, approval_roles")
          .eq("organization_id", membership.organization_id),
        supabase
          .from("deals")
          .select("id, title, destination")
          .eq("organization_id", membership.organization_id)
          .order("updated_at", { ascending: false })
          .limit(20),
        supabase
          .from("approval_requests")
          .select(
            "id, action, entity_type, entity_id, rationale, requester_id, approver_id, created_at, expires_at, escalation_count, last_escalated_at, last_escalation_outcome",
          )
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
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active"),
      ]);
      const approvalUserIds = Array.from(
        new Set([
          ...(approvalMemberRows || []).map((member) => member.user_id),
          ...(approvalRows || []).map((approval) => approval.requester_id),
          ...(approvalRows || []).flatMap((approval) =>
            approval.approver_id ? [approval.approver_id] : [],
          ),
        ]),
      );
      const approvalProfileRows = approvalUserIds.length
        ? (
            await supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", approvalUserIds)
          ).data || []
        : [];
      const approvalRoles = new Map(
        (approvalMemberRows || []).map((member) => [
          member.user_id,
          member.role,
        ]),
      );
      setApprovalPeople(
        Object.fromEntries(
          approvalProfileRows.map((profile) => [
            profile.id,
            {
              name: profile.full_name?.trim() || "Workspace member",
              role: approvalRoles.get(profile.id) || null,
            },
          ]),
        ),
      );
      setOverrides(
        Object.fromEntries(
          (policyRows || []).map((policy) => [policy.action, policy.mode]),
        ),
      );
      setApprovalRolesByAction(
        Object.fromEntries(
          (policyRows || []).map((policy) => [
            policy.action,
            policy.approval_roles,
          ]),
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
        latestPendingLeadRuns(completedRuns || [], reviewedRunIds),
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
          await fetchProviderStatus(provider, membership.organization_id),
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
        setApprovalRolesByAction((current) => ({
          ...current,
          [policy.action]: policy.approval_roles,
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

  function applyOperatingMode(mode: "manual" | "assisted" | "autopilot") {
    if (!organizationId || pending) return;
    setRunNotice("");
    startTransition(async () => {
      try {
        const nextPolicies = await setAiosOperatingMode({
          organizationId,
          mode,
        });
        setOverrides((current) => ({
          ...current,
          ...Object.fromEntries(
            nextPolicies.map((policy) => [policy.action, policy.mode]),
          ),
        }));
        setApprovalRolesByAction((current) => ({
          ...current,
          ...Object.fromEntries(
            nextPolicies.map((policy) => [
              policy.action,
              policy.approval_roles,
            ]),
          ),
        }));
        setNotice(`AIOS is now operating in ${mode} mode.`);
        window.dispatchEvent(new Event("aios:mode-changed"));
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update the operating mode.",
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
          organizationId || undefined,
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

  async function refreshAgentActivity() {
    if (!organizationId) return;
    const supabase = createSupabaseBrowserClient();
    const utcDayStart = new Date();
    utcDayStart.setUTCHours(0, 0, 0, 0);
    const [
      { data: completedRuns },
      { data: reviewedRows },
      { data: runRows },
      { data: usageRows },
    ] = await Promise.all([
      supabase
        .from("ai_runs")
        .select("id, result, created_at")
        .eq("organization_id", organizationId)
        .eq("agent_type", "lead_intake")
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("ai_field_reviews")
        .select("ai_run_id")
        .eq("organization_id", organizationId),
      supabase
        .from("ai_runs")
        .select(
          "id, agent_type, status, result, error_code, duration_ms, created_at, completed_at",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("ai_runs")
        .select(
          "id, status, input_tokens, output_tokens, estimated_cost, estimated_cost_currency",
        )
        .eq("organization_id", organizationId)
        .in("agent_type", [
          "lead_intake",
          "itinerary_draft",
          "knowledge_answer",
        ])
        .gte("created_at", utcDayStart.toISOString())
        .limit(1000),
    ]);
    const reviewedRunIds = new Set(
      (reviewedRows || []).map((review) => review.ai_run_id),
    );
    setReviewRuns(
      latestPendingLeadRuns(completedRuns || [], reviewedRunIds),
    );
    setRecentRuns((runRows || []) as RunHistory[]);
    setTodayModelUsage((usageRows || []) as ModelUsageRun[]);
    await refreshAiJobTelemetry();
  }

  async function refreshApprovals() {
    if (!organizationId) return;
    const supabase = createSupabaseBrowserClient();
    const { data: pendingApprovals } = await supabase
      .from("approval_requests")
      .select(
        "id, action, entity_type, entity_id, rationale, requester_id, approver_id, created_at, expires_at, escalation_count, last_escalated_at, last_escalation_outcome",
      )
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setApprovals(pendingApprovals || []);
    window.dispatchEvent(new Event("aios:approvals-changed"));
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
            ? `Lead intake completed: ${result.runId}. The draft is ready for review below.`
            : result.message || "AIOS blocked the run.",
        );
        await Promise.all([refreshApprovals(), refreshAgentActivity()]);
      } catch (error) {
        setRunNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not start this run.",
        );
      }
    });
  }

  function runDailyCoordinator() {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const result = await runDailyAiosCoordinator({ organizationId });
        setRunNotice(
          result.status === "completed" || result.status === "partial"
            ? `Daily sweep ${result.status}: ${result.totals.scanned} records or risk signals checked, ${result.totals.changed} internal records reconciled, ${result.totals.approvals} approval${result.totals.approvals === 1 ? "" : "s"} requested${result.totals.failed ? `, ${result.totals.failed} child workflow failed safely` : ""}. No external action was available.`
            : result.status === "approval_required"
              ? "The daily AIOS sweep is waiting for human approval. No child workflow has run yet."
              : `The daily AIOS sweep is ${result.status}. No external action was performed.`,
        );
        await Promise.all([refreshApprovals(), refreshAgentActivity()]);
      } catch (error) {
        setRunNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not run the daily internal sweep.",
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
        await Promise.all([refreshApprovals(), refreshAgentActivity()]);
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
        await Promise.all([refreshApprovals(), refreshAgentActivity()]);
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
        window.dispatchEvent(new Event("aios:approvals-changed"));
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

  function escalateApproval(approvalId: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const escalation = await escalateApprovalRequest({
          organizationId,
          approvalId,
        });
        setApprovals((current) =>
          current.map((approval) =>
            approval.id === approvalId
              ? {
                  ...approval,
                  escalation_count: escalation.escalation_number,
                  last_escalated_at: escalation.escalated_at,
                  last_escalation_outcome: escalation.escalation_outcome,
                  approver_id: escalation.approver_id,
                  expires_at: escalation.next_expires_at,
                }
              : approval,
          ),
        );
        window.dispatchEvent(new Event("aios:approvals-changed"));
        setRunNotice(
          escalation.escalation_outcome === "rerouted"
            ? "Approval escalated to the next eligible human. The decision is still pending."
            : escalation.escalation_outcome === "assigned"
              ? "Approval assigned to an eligible human. The decision is still pending."
              : "No alternate approver was available. The current human was reminded and the decision deadline was renewed.",
        );
      } catch (error) {
        setRunNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not escalate this approval.",
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
  const canRunCoordinator = canManage || role === "operations";
  const canResolveApproval = (
    action: string,
    approverId: string | null,
  ) =>
    canResolveApprovalAccess({
      action,
      approver_id: approverId,
      role,
      userId: currentUserId,
      approvalRolesByAction,
    });
  const assignedApprovals = approvals.filter(
    (approval) =>
      isInPersonalApprovalQueue({
        action: approval.action,
        approver_id: approval.approver_id,
        role,
        userId: currentUserId,
        approvalRolesByAction,
      }),
  );
  const visibleApprovals =
    approvalScope === "mine" ? assignedApprovals : approvals;
  const visibleRecentRuns = recentRuns.filter((run) => {
    if (activityStatus === "all") return true;
    if (activityStatus === "active") return !run.completed_at;
    return run.status === activityStatus;
  });
  const approvalPersonLabel = (personId: string | null) => {
    if (!personId) return "Any eligible approver";
    const person = approvalPeople[personId];
    if (!person)
      return personId === currentUserId ? "You" : "Workspace member";
    const personRole = person.role?.replaceAll("_", " ");
    return `${person.name}${personId === currentUserId ? " (you)" : ""}${personRole ? ` · ${personRole}` : ""}`;
  };
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
  const internalModes = AIOS_ACTION_CATALOG.filter(
    (item) => !item.hardApproval,
  ).map((item) => overrides[item.action] ?? item.defaultMode);
  const operatingMode = internalModes.every((mode) => mode === "observe")
    ? "manual"
    : internalModes.every((mode) => mode === "auto")
      ? "autopilot"
      : "assisted";
  const pageTitle =
    surface === "approvals"
      ? "Approvals"
      : surface === "automations"
        ? "Automations"
        : "AI Activity";
  const pageMeta =
    surface === "approvals"
      ? `${assignedApprovals.length} assigned to you · ${approvals.length} workspace`
      : surface === "automations"
        ? `${operatingMode[0].toUpperCase()}${operatingMode.slice(1)} · ${AIOS_ACTION_CATALOG.length} governed workflows`
        : `${recentRuns.length} recent actions · ${reviewRuns.length} drafts awaiting review`;

  return (
    <main
      className="aios-page"
      data-surface={surface}
      id="main-content"
      tabIndex={-1}
    >
      <FeatureHeader links={[{ href: "/", label: "Back to workspace" }]} />
      <OperationalPageHeader
        section="AI work"
        title={pageTitle}
        meta={pageMeta}
      />
      <nav className="crm-record-tabs aios-record-tabs" aria-label="AIOS sections">
        <Link
          href="/aios/activity"
          aria-current={surface === "activity" ? "page" : undefined}
        >
          Activity
        </Link>
        <Link
          href="/aios/approvals"
          aria-current={surface === "approvals" ? "page" : undefined}
        >
          Approvals
        </Link>
        <Link
          href="/aios/automations"
          aria-current={surface === "automations" ? "page" : undefined}
        >
          Automations
        </Link>
      </nav>
      <section className="aios-operating-mode" id="operating-mode">
        <header>
          <div>
            <p>OPERATING MODE</p>
            <h2>{operatingMode === "manual" ? "Manual" : operatingMode === "autopilot" ? "Autopilot" : "Assisted"}</h2>
          </div>
          <span>External actions still require approval</span>
        </header>
        <div>
          <button
            type="button"
            className={operatingMode === "manual" ? "active" : ""}
            disabled={!canManage || pending}
            onClick={() => applyOperatingMode("manual")}
          >
            <b>Manual</b>
            <small>AI recommends. Your team executes.</small>
          </button>
          <button
            type="button"
            className={operatingMode === "assisted" ? "active" : ""}
            disabled={!canManage || pending}
            onClick={() => applyOperatingMode("assisted")}
          >
            <b>Assisted</b>
            <small>AI prepares work and handles safe internal tasks.</small>
          </button>
          <button
            type="button"
            className={operatingMode === "autopilot" ? "active" : ""}
            disabled={!canManage || pending}
            onClick={() => applyOperatingMode("autopilot")}
          >
            <b>Autopilot</b>
            <small>AI runs permitted workflows and asks when approval is needed.</small>
          </button>
        </div>
      </section>
      {notice && (
        <p className="aios-notice" role="status">
          {notice}
        </p>
      )}
      <section className="aios-coordinator" aria-labelledby="daily-coordinator-title">
        <div>
          <p>TODAY'S INTERNAL SWEEP</p>
          <h2 id="daily-coordinator-title">Coordinate the workday</h2>
          <span>
            Route unassigned opportunities, triage overdue follow-ups, and
            refresh trip risks. Each workflow follows its own policy; customer,
            supplier, booking, pricing, and money actions are unavailable here.
          </span>
        </div>
        <button
          type="button"
          onClick={runDailyCoordinator}
          disabled={!canRunCoordinator || pending}
        >
          Run daily AIOS sweep
        </button>
      </section>
      <details className="crm-advanced-panel">
        <summary>Model provider and budget</summary>
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
              disabled={!canManage || pending || loading}
              onChange={(event) =>
                setDailyModelRunLimit(Number(event.target.value))
              }
            />
          </label>
          <label>
            Selected provider
            <select
              value={selectedModelProvider}
              disabled={!canManage || pending || loading}
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
              disabled={!canManage || pending || loading}
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
                      ? " · ready"
                      : " · not configured"
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
              disabled={!canManage || pending || loading}
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
          <button disabled={!canManage || pending || loading}>
            Save budget policy
          </button>
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
                    loading ||
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
      </details>

      <details className="crm-advanced-panel">
        <summary>Model pricing</summary>
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
      </details>

      <details className="crm-advanced-panel">
        <summary>Execution queue and diagnostics</summary>
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
      </details>
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
      <section className="aios-run-history" id="activity">
        <header>
          <div>
            <p>AGENT RUN LEDGER</p>
            <h2>What AIOS has actually done</h2>
          </div>
          <div className="aios-run-tools">
            <label>
              Status
              <select
                value={activityStatus}
                onChange={(event) =>
                  setActivityStatus(event.target.value as ActivityStatus)
                }
                aria-label="Filter AIOS activity by status"
              >
                <option value="all">All activity</option>
                <option value="succeeded">Succeeded</option>
                <option value="active">Active</option>
                <option value="blocked">Blocked</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <span>{visibleRecentRuns.length} shown</span>
          </div>
        </header>
        {recentRuns.length === 0 ? (
          <p className="aios-empty">
            No agent runs have been recorded in this workspace.
          </p>
        ) : visibleRecentRuns.length === 0 ? (
          <p className="aios-empty">
            No agent runs match this status. Choose another filter to inspect the
            ledger.
          </p>
        ) : (
          visibleRecentRuns.map((run) => (
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
      <span className="aios-anchor-alias" id="approval-queue" />
      <section className="aios-approvals" id="approvals">
        <header>
          <div>
            <p>HUMAN DECISION QUEUE</p>
            <h2>
              {approvalScope === "mine"
                ? "Approvals waiting for you"
                : "Workspace approval queue"}
            </h2>
          </div>
          <span>{visibleApprovals.length} shown</span>
        </header>
        <div className="aios-approval-scopes" aria-label="Approval queue view">
          <button
            type="button"
            aria-pressed={approvalScope === "mine"}
            onClick={() => setApprovalScope("mine")}
          >
            My decisions <span>{assignedApprovals.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={approvalScope === "workspace"}
            onClick={() => setApprovalScope("workspace")}
          >
            Workspace queue <span>{approvals.length}</span>
          </button>
        </div>
        {visibleApprovals.length === 0 ? (
          <div className="aios-approval-empty">
            <div>
              <strong>
                {approvals.length
                  ? "Nothing is assigned to you"
                  : "No human decisions are waiting"}
              </strong>
              <p>
                {approvals.length
                  ? "Open the workspace queue to see decisions assigned to other eligible teammates."
                  : "When AIOS reaches a protected action—such as sharing, booking, or money movement—it will appear here before anything happens."}
              </p>
            </div>
            <ul aria-label="Approval categories">
              <li><b>Communication</b><span>Customer and supplier messages</span></li>
              <li><b>Commercial</b><span>Prices, proposals and bookings</span></li>
              <li><b>Finance</b><span>Invoices, payments and refunds</span></li>
            </ul>
            <Link href="/aios/automations">Review automation permissions</Link>
          </div>
        ) : (
          visibleApprovals.map((approval) => {
            const escalationDue = Boolean(
              approval.expires_at &&
                new Date(approval.expires_at).getTime() <= approvalClock,
            );
            const entityHref = approvalEntityLink(approval);
            return (
              <article key={approval.id}>
                <div>
                  <b>{approval.action.replaceAll(".", " ")}</b>
                  <span>
                    {approval.rationale ||
                      `AIOS requested an action on a ${approval.entity_type}.`}
                  </span>
                  <div className="aios-approval-meta">
                    <span>
                      Assigned to <b>{approvalPersonLabel(approval.approver_id)}</b>
                    </span>
                    <span>
                      Requested by <b>{approvalPersonLabel(approval.requester_id)}</b>
                      {` · ${new Date(approval.created_at).toLocaleString()}`}
                    </span>
                    <span>
                      Record: {approval.entity_type.replaceAll("_", " ")}
                      {approval.entity_id
                        ? ` · ${approval.entity_id.slice(0, 8)}…`
                        : " · workspace-level"}
                      {entityHref ? (
                        <Link href={entityHref}>Open record</Link>
                      ) : null}
                    </span>
                  </div>
                  <small>
                    {approval.expires_at
                      ? `${escalationDue ? "Escalation overdue" : "Escalates"} ${new Date(approval.expires_at).toLocaleString()}`
                      : "No escalation deadline configured"}
                    {approval.escalation_count
                      ? ` · Escalated ${approval.escalation_count} time${approval.escalation_count === 1 ? "" : "s"}${approval.last_escalation_outcome ? ` (${approval.last_escalation_outcome})` : ""}`
                      : ""}
                  </small>
                </div>
                <aside>
                  {canManage && approval.expires_at ? (
                    <button
                      type="button"
                      className="escalate"
                      disabled={!escalationDue || pending}
                      onClick={() => escalateApproval(approval.id)}
                    >
                      Escalate now
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="approve"
                    disabled={
                      !canResolveApproval(
                        approval.action,
                        approval.approver_id,
                      ) || pending
                    }
                    onClick={() => resolveApproval(approval.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="reject"
                    disabled={
                      !canResolveApproval(
                        approval.action,
                        approval.approver_id,
                      ) || pending
                    }
                    onClick={() => resolveApproval(approval.id, "rejected")}
                  >
                    Reject
                  </button>
                </aside>
              </article>
            );
          })
        )}
      </section>
      <section className="autonomy-categories" id="automations">
        <header>
          <div>
            <p>ADVANCED CONTROLS</p>
            <h2>Automation permissions</h2>
          </div>
          <span>{AIOS_ACTION_CATALOG.length} workflows</span>
        </header>
        {automationCategories.map((category) => {
          const items = AIOS_ACTION_CATALOG.filter((item) =>
            category.actions.some((action) => action === item.action),
          );
          const approvalCount = items.filter((item) => item.hardApproval).length;
          return (
            <details key={category.label}>
              <summary>
                <span>
                  <b>{category.label}</b>
                  <small>
                    {items.length} {items.length === 1 ? "automation" : "automations"}
                    {approvalCount
                      ? ` · ${approvalCount} ${approvalCount === 1 ? "requires" : "require"} approval`
                      : ""}
                  </small>
                </span>
                <i>Configure</i>
              </summary>
              <div className="autonomy-grid">
                {items.map((item) => {
                  const current = overrides[item.action] ?? item.defaultMode;
                  const disabled = disabledActions.has(item.action);
                  return (
                    <article className="autonomy-card" key={item.action}>
                      <header>
                        <div>
                          <p>{item.hardApproval ? "APPROVAL REQUIRED" : "INTERNAL WORKFLOW"}</p>
                          <h2>{item.title}</h2>
                        </div>
                        <span className={`autonomy-state ${disabled ? "observe" : current}`}>
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
                          const locked = disabled || (item.hardApproval && mode.value !== "approval_required");
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
              </div>
            </details>
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
