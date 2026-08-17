"use client";

import {
  type DragEvent as ReactDragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  createContact,
  createDeal,
  createSavedView,
  deleteSavedView,
  updateDealStage,
} from "./actions/crm";
import { runDailyAiosCoordinator } from "./actions/agents";
import { summarizeApprovalAttention } from "../lib/ai/approval-access";
import { createSupabaseBrowserClient } from "../lib/supabase/browser";
import { loadWorkspaceContext } from "../lib/supabase/workspace-context";
import type { Database, Json } from "../types/database";
import { assessLeadHealth } from "../lib/crm/lead-health";
import { summarizeDailyWorkAttention } from "../lib/crm/work-attention";
import {
  allowedPipelineTransitions,
  isAllowedPipelineTransition,
  PIPELINE_STAGE_LABELS,
  type PipelineStage,
} from "../lib/crm/pipeline-transitions";
import { Button } from "../components/ui/button";
import { StatusNotice } from "../components/ui/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "../components/ui/data-table";
import { ModalBoundary } from "../components/ui/modal-boundary";
import { OperationalPageHeader } from "../components/ui/operational-page-header";
import { SavedViewControls } from "../components/ui/saved-view-controls";
import { SetupChecklist } from "../components/ui/setup-checklist";
import "./dashboard.css";
import "./search.css";
import "./leads-filters.css";
import "./pipeline-dnd.css";

type View = "Command center" | "Leads";
type LiveDeal = Database["public"]["Tables"]["deals"]["Row"];
type LeadStage = "New" | "Qualified" | "Proposal" | "Decision";
type Lead = {
  id: string;
  name: string;
  journey: string;
  value: string;
  amount: number;
  stage: LeadStage;
  databaseStage: LiveDeal["stage"];
  source: string;
  currency: string;
  probability: number;
  nextStep: string | null;
  ownerId: string | null;
  lastActivityAt: string | null;
  expectedCloseAt: string | null;
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  followUpDueAt: string | null;
  slaEscalationLevel: number;
  accent: string;
};
type Member = { id: string; name: string };
type SavedView = {
  id: string;
  name: string;
  filters: Json;
  created_at: string;
};
type LeadStageFilter =
  | "all"
  | "new"
  | "qualified"
  | "proposal"
  | "decision";
type LeadAttentionFilter = "all" | "attention" | "healthy";

function leadFiltersFromSavedView(savedView: SavedView | undefined) {
  const filters = savedView?.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    return null;
  const query = typeof filters.query === "string" ? filters.query : "";
  const stage =
    filters.stage === "new" ||
    filters.stage === "qualified" ||
    filters.stage === "proposal" ||
    filters.stage === "decision"
      ? filters.stage
      : "all";
  const ownerId =
    typeof filters.ownerId === "string" ? filters.ownerId : "all";
  const attention =
    filters.attention === "attention" || filters.attention === "healthy"
      ? filters.attention
      : "all";
  return { query, stage, ownerId, attention } satisfies {
    query: string;
    stage: LeadStageFilter;
    ownerId: string;
    attention: LeadAttentionFilter;
  };
}

const accents = ["violet", "pink", "blue", "lime", "orange"];

function formatAmount(amount: number | null, currency = "INR") {
  if (amount === null) return "TBC";
  if (currency === "INR" && amount >= 100_000)
    return `₹ ${(amount / 100_000).toFixed(amount % 100_000 === 0 ? 0 : 1)}L`;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function parseAmount(input: string) {
  const normalized = input.replace(/[^0-9.Ll]/g, "");
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return /l/i.test(normalized)
    ? Math.round(value * 100_000)
    : Math.round(value);
}

function leadFromDeal(deal: LiveDeal, index = 0): Lead {
  const stage: Record<LiveDeal["stage"], LeadStage> = {
    new: "New",
    qualified: "Qualified",
    proposal: "Proposal",
    decision: "Decision",
    won: "Decision",
    lost: "Decision",
  };
  return {
    id: deal.id,
    name: deal.title,
    journey: deal.destination
      ? `${deal.destination} · Details being qualified`
      : "Journey details being qualified",
    value: formatAmount(deal.value_amount, deal.currency),
    amount: deal.value_amount ?? 0,
    stage: stage[deal.stage],
    databaseStage: deal.stage,
    source: deal.source || "Manual",
    currency: deal.currency,
    probability: deal.probability,
    nextStep: deal.next_step,
    ownerId: deal.owner_id,
    lastActivityAt: deal.last_activity_at,
    expectedCloseAt: deal.expected_close_at,
    firstResponseDueAt: deal.first_response_due_at,
    firstRespondedAt: deal.first_responded_at,
    followUpDueAt: deal.follow_up_due_at,
    slaEscalationLevel: deal.sla_escalation_level,
    accent: accents[index % accents.length],
  };
}

function Avatar({
  initials,
  accent = "violet",
}: {
  initials: string;
  accent?: string;
}) {
  return <span className={`avatar ${accent}`}>{initials}</span>;
}

const recentLeadColumns: DataTableColumn<Lead>[] = [
  {
    key: "traveller",
    header: "Traveller",
    render: (lead) => (
      <div className="ui-data-primary">
        <Avatar
          initials={lead.name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)}
          accent={lead.accent}
        />
        <span>
          <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
          <small>{lead.journey}</small>
        </span>
      </div>
    ),
  },
  {
    key: "stage",
    header: "Stage",
    render: (lead) => (
      <span className={`stage ${lead.stage.toLowerCase()}`}>{lead.stage}</span>
    ),
  },
  {
    key: "value",
    header: "Value",
    align: "end",
    render: (lead) => <b>{lead.value}</b>,
  },
];

function LeadCard({
  lead,
  moving,
  dragging,
  onAdvance,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  moving: boolean;
  dragging: boolean;
  onAdvance?: () => void;
  onMove: (stage: PipelineStage) => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const allowedTargets = allowedPipelineTransitions(lead.databaseStage);
  const canDrag = allowedTargets.length > 0 && !moving;
  return (
    <article
      className={`lead-card ${dragging ? "dragging" : ""} ${
        moving ? "moving" : ""
      }`}
      draggable={canDrag}
      aria-label={`${lead.name}, ${lead.stage} pipeline stage`}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div>
        <Avatar
          initials={lead.name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)}
          accent={lead.accent}
        />
        <span className="drag-handle" aria-hidden="true">
          ⋮⋮
        </span>
      </div>
      <h3>{lead.name}</h3>
      <p>{lead.journey}</p>
      <div className="lead-qualification">
        <span>{lead.probability}% likely</span>
        <small>{lead.nextStep || "Set the next sales step"}</small>
      </div>
      <footer>
        <span>{lead.source}</span>
        <b>{lead.value}</b>
      </footer>
      <a className="text-button" href={`/leads/${lead.id}`}>
        Open workspace →
      </a>
      {allowedTargets.length > 0 && (
        <label className="stage-picker">
          <span>Move stage</span>
          <select
            aria-label={`Move ${lead.name} to stage`}
            value=""
            disabled={moving}
            onChange={(event) => {
              if (event.target.value)
                onMove(event.target.value as PipelineStage);
            }}
          >
            <option value="">Choose a legal next stage…</option>
            {allowedTargets.map((stage) => (
              <option key={stage} value={stage}>
                {PIPELINE_STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </label>
      )}
      {onAdvance && lead.stage !== "Decision" && (
        <button
          className="text-button"
          type="button"
          disabled={moving}
          onClick={onAdvance}
        >
          Move forward →
        </button>
      )}
      {canDrag && (
        <small className="lead-card-drag-note">
          Drag between highlighted adjacent stages.
        </small>
      )}
    </article>
  );
}

function KanbanColumn({
  stage,
  title,
  leads,
  draggedLead,
  activeDropStage,
  movingLeadId,
  onCreate,
  onAdvance,
  onMove,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
}: {
  stage: PipelineStage;
  title: string;
  leads: Lead[];
  draggedLead: Lead | null;
  activeDropStage: PipelineStage | null;
  movingLeadId: string | null;
  onCreate: () => void;
  onAdvance: (lead: Lead) => void;
  onMove: (lead: Lead, stage: PipelineStage) => void;
  onDragStart: (lead: Lead, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragEnter: (stage: PipelineStage) => void;
  onDrop: (stage: PipelineStage, leadId: string) => void;
}) {
  const total = leads.reduce((sum, lead) => sum + lead.amount, 0);
  const acceptsDraggedLead = draggedLead
    ? isAllowedPipelineTransition(draggedLead.databaseStage, stage)
    : false;
  return (
    <section
      className={`kanban-column ${
        draggedLead
          ? acceptsDraggedLead
            ? "drop-allowed"
            : "drop-blocked"
          : ""
      } ${activeDropStage === stage ? "drop-active" : ""}`}
      aria-label={`${title} stage`}
      onDragEnter={() => onDragEnter(stage)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("text/plain")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = acceptsDraggedLead ? "move" : "none";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(stage, event.dataTransfer.getData("text/plain"));
      }}
    >
      <div className="kanban-head">
        <span>
          <i />
          {title} <b>{leads.length}</b>
        </span>
        <strong>{formatAmount(total || null)}</strong>
      </div>
      {leads.map((lead) => (
        <LeadCard
          key={lead.id}
          lead={lead}
          moving={movingLeadId === lead.id}
          dragging={draggedLead?.id === lead.id}
          onAdvance={() => onAdvance(lead)}
          onMove={(targetStage) => onMove(lead, targetStage)}
          onDragStart={(event) => onDragStart(lead, event)}
          onDragEnd={onDragEnd}
        />
      ))}
      <button className="add-card" type="button" onClick={onCreate}>
        + Add to {title.toLowerCase()}
      </button>
    </section>
  );
}

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const active: View = pathname === "/leads" ? "Leads" : "Command center";
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Your travel workspace");
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadStageFilter, setLeadStageFilter] =
    useState<LeadStageFilter>("all");
  const [leadOwnerFilter, setLeadOwnerFilter] = useState("all");
  const [leadAttentionFilter, setLeadAttentionFilter] =
    useState<LeadAttentionFilter>("all");
  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [overdueTaskCount, setOverdueTaskCount] = useState(0);
  const [workspaceOverdueTaskCount, setWorkspaceOverdueTaskCount] = useState(0);
  const [attentionSummary, setAttentionSummary] = useState({
    myOverdueInbox: 0,
    workspaceOverdueInbox: 0,
    myPendingApprovals: 0,
    workspacePendingApprovals: 0,
    myActiveTrips: 0,
    workspaceActiveTrips: 0,
    overduePayments: 0,
    aiCompletedToday: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [leadOpen, setLeadOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [isCreating, startCreating] = useTransition();
  const [isCoordinating, startCoordinating] = useTransition();
  const [isMoving, startMoving] = useTransition();
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [activeDropStage, setActiveDropStage] =
    useState<PipelineStage | null>(null);

  function showTimedToast(message: string) {
    setToast(message);
    window.setTimeout(
      () => setToast((current) => (current === message ? "" : current)),
      3400,
    );
  }

  useEffect(() => {
    const flash = window.sessionStorage.getItem("aios.crm.flash");
    if (!flash) return;
    window.sessionStorage.removeItem("aios.crm.flash");
    const showTimer = window.setTimeout(() => setToast(flash), 0);
    const hideTimer = window.setTimeout(
      () => setToast((current) => (current === flash ? "" : current)),
      3400,
    );
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    const loadWorkspace = async () => {
      const supabase = createSupabaseBrowserClient();
      const context = await loadWorkspaceContext(supabase);
      if (!context.active) {
        setToast("No active workspace is available for this account.");
        setIsLoading(false);
        return;
      }

      setOrganizationId(context.active.organization_id);
      setWorkspaceName(context.active.name);
      setWorkspaceRole(context.active.role);
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user)
        throw userError ?? new Error("The signed-in profile is unavailable.");
      const { data: signedInProfile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      setUserName(
        signedInProfile?.full_name?.trim() ||
          user.email?.split("@")[0] ||
          "Travel operator",
      );
      setCurrentUserId(user.id);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [
        { data: deals },
        { data: tasks },
        { data: memberRows },
        { data: savedViewRows },
        { data: conversationRows },
        { data: approvalRows },
        { data: approvalPolicyRows },
        { data: tripRows },
        { data: paymentRows },
        { data: aiRunRows },
      ] = await Promise.all([
        supabase
          .from("deals")
          .select("*")
          .eq("organization_id", context.active.organization_id)
          .is("archived_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("tasks")
          .select("status, due_at, assignee_id")
          .eq("organization_id", context.active.organization_id),
        supabase
          .from("memberships")
          .select("user_id")
          .eq("organization_id", context.active.organization_id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        supabase
          .from("saved_views")
          .select("id, name, filters, created_at")
          .eq("organization_id", context.active.organization_id)
          .eq("feature", "leads")
          .order("updated_at", { ascending: false }),
        supabase
          .from("conversations")
          .select("status, response_due_at, assignee_id")
          .eq("organization_id", context.active.organization_id),
        supabase
          .from("approval_requests")
          .select("action, approver_id")
          .eq("organization_id", context.active.organization_id)
          .eq("status", "pending"),
        supabase
          .from("ai_autonomy_policies")
          .select("action, approval_roles")
          .eq("organization_id", context.active.organization_id),
        supabase
          .from("trips")
          .select("status, owner_id")
          .eq("organization_id", context.active.organization_id),
        supabase
          .from("payments")
          .select("status")
          .eq("organization_id", context.active.organization_id),
        supabase
          .from("ai_runs")
          .select("status")
          .eq("organization_id", context.active.organization_id)
          .eq("status", "succeeded")
          .gte("created_at", todayStart.toISOString()),
      ]);
      const memberIds = (memberRows || []).map((member) => member.user_id);
      const { data: profileRows } = memberIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", memberIds)
        : { data: [] };
      const names = new Map(
        (profileRows || []).map((profile) => [profile.id, profile.full_name]),
      );
      setMembers(
        memberIds.map((id) => ({
          id,
          name: names.get(id) || "Team member",
        })),
      );
      setSavedViews(savedViewRows || []);
      setLeads(
        (deals || [])
          .filter((deal) => deal.stage !== "won" && deal.stage !== "lost")
          .map(leadFromDeal),
      );
      const now = Date.now();
      const workAttention = summarizeDailyWorkAttention({
        userId: user.id,
        now,
        tasks: tasks || [],
        conversations: conversationRows || [],
        trips: tripRows || [],
      });
      setOpenTaskCount(workAttention.tasks.workspaceActive);
      setOverdueTaskCount(workAttention.tasks.mineOverdue);
      setWorkspaceOverdueTaskCount(workAttention.tasks.workspaceOverdue);
      const approvalAttention = summarizeApprovalAttention(approvalRows || [], {
        role: context.active.role,
        userId: user.id,
        approvalRolesByAction: Object.fromEntries(
          (approvalPolicyRows || []).map((policy) => [
            policy.action,
            policy.approval_roles,
          ]),
        ),
      });
      setAttentionSummary({
        myOverdueInbox: workAttention.inbox.mineOverdue,
        workspaceOverdueInbox: workAttention.inbox.workspaceOverdue,
        myPendingApprovals: approvalAttention.mine,
        workspacePendingApprovals: approvalAttention.workspace,
        myActiveTrips: workAttention.trips.mineActive,
        workspaceActiveTrips: workAttention.trips.workspaceActive,
        overduePayments: (paymentRows || []).filter(
          (payment) => payment.status === "overdue",
        ).length,
        aiCompletedToday: (aiRunRows || []).length,
      });
      setIsLoading(false);
    };
    void loadWorkspace().catch(() => {
      setToast("AIOS could not load your active workspace.");
      setIsLoading(false);
    });
  }, []);

  const grouped = useMemo(
    () => ({
      new: leads.filter((lead) => lead.stage === "New"),
      qualified: leads.filter((lead) => lead.stage === "Qualified"),
      proposal: leads.filter((lead) => lead.stage === "Proposal"),
      decision: leads.filter((lead) => lead.stage === "Decision"),
    }),
    [leads],
  );
  const filteredLeads = useMemo(() => {
    const normalizedQuery = leadQuery.trim().toLowerCase();
    return leads.filter((lead) => {
      if (
        normalizedQuery &&
        ![lead.name, lead.journey, lead.source].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        )
      )
        return false;
      if (
        leadStageFilter !== "all" &&
        lead.stage.toLowerCase() !== leadStageFilter
      )
        return false;
      if (
        leadOwnerFilter === "unassigned"
          ? lead.ownerId !== null
          : leadOwnerFilter !== "all" && lead.ownerId !== leadOwnerFilter
      )
        return false;
      if (leadAttentionFilter !== "all") {
        const needsAttention =
          assessLeadHealth(lead).severity !== "healthy";
        if (
          (leadAttentionFilter === "attention" && !needsAttention) ||
          (leadAttentionFilter === "healthy" && needsAttention)
        )
          return false;
      }
      return true;
    });
  }, [
    leadAttentionFilter,
    leadOwnerFilter,
    leadQuery,
    leadStageFilter,
    leads,
  ]);
  const filteredGrouped = useMemo(
    () => ({
      new: filteredLeads.filter((lead) => lead.stage === "New"),
      qualified: filteredLeads.filter((lead) => lead.stage === "Qualified"),
      proposal: filteredLeads.filter((lead) => lead.stage === "Proposal"),
      decision: filteredLeads.filter((lead) => lead.stage === "Decision"),
    }),
    [filteredLeads],
  );
  const filteredPipelineValue = filteredLeads.reduce(
    (sum, lead) => sum + lead.amount,
    0,
  );
  const pipelineValue = leads.reduce((sum, lead) => sum + lead.amount, 0);
  const userFirstName = userName?.trim().split(/\s+/)[0] || "there";
  const pipelineCurrencies = [...new Set(leads.map((lead) => lead.currency))];
  const pipelineCurrency =
    pipelineCurrencies.length === 1 ? pipelineCurrencies[0] : null;
  const forecastDeadline = new Date();
  forecastDeadline.setDate(forecastDeadline.getDate() + 30);
  const forecastLeads = leads.filter((lead) => {
    if (!lead.expectedCloseAt) return false;
    const expectedClose = new Date(`${lead.expectedCloseAt}T00:00:00`);
    return (
      expectedClose >= new Date(new Date().toDateString()) &&
      expectedClose <= forecastDeadline
    );
  });
  const weightedForecast = forecastLeads.reduce(
    (sum, lead) => sum + (lead.amount * lead.probability) / 100,
    0,
  );
  const attentionLeads = leads
    .map((lead) => assessLeadHealth(lead))
    .filter((lead) => lead.severity !== "healthy")
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
  const draggedLead =
    leads.find((lead) => lead.id === draggedLeadId) ?? null;

  function openLeadModal() {
    if (!organizationId) {
      setToast(
        "Your workspace is still loading. Please try again in a moment.",
      );
      return;
    }
    setLeadOpen(true);
  }

  function runDailyCoordinator() {
    if (!organizationId || isCoordinating) return;
    startCoordinating(async () => {
      try {
        const result = await runDailyAiosCoordinator({ organizationId });
        showTimedToast(
          result.status === "completed" || result.status === "partial"
            ? `AIOS daily sweep ${result.status}: ${result.totals.changed} internal update${result.totals.changed === 1 ? "" : "s"}, ${result.totals.approvals} approval${result.totals.approvals === 1 ? "" : "s"}. No external action was available.`
            : result.status === "approval_required"
              ? "The AIOS daily sweep is waiting in Approvals. No child workflow has run."
              : `The AIOS daily sweep is ${result.status}. No external action was performed.`,
        );
        const supabase = createSupabaseBrowserClient();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const [approvalRows, approvalPolicyRows, completedRunCount] =
          await Promise.all([
          supabase
            .from("approval_requests")
            .select("action, approver_id")
            .eq("organization_id", organizationId)
            .eq("status", "pending"),
          supabase
            .from("ai_autonomy_policies")
            .select("action, approval_roles")
            .eq("organization_id", organizationId),
          supabase
            .from("ai_runs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", "succeeded")
            .gte("created_at", todayStart.toISOString()),
          ]);
        const approvalAttention = summarizeApprovalAttention(
          approvalRows.data || [],
          {
            role: workspaceRole,
            userId: currentUserId,
            approvalRolesByAction: Object.fromEntries(
              (approvalPolicyRows.data || []).map((policy) => [
                policy.action,
                policy.approval_roles,
              ]),
            ),
          },
        );
        setAttentionSummary((current) => ({
          ...current,
          myPendingApprovals: approvalAttention.mine,
          workspacePendingApprovals: approvalAttention.workspace,
          aiCompletedToday:
              completedRunCount.count ?? current.aiCompletedToday,
        }));
        window.dispatchEvent(new Event("aios:approvals-changed"));
      } catch (error) {
        showTimedToast(
          error instanceof Error
            ? error.message
            : "AIOS could not run the daily internal sweep.",
        );
      }
    });
  }

  function selectLeadSavedView(savedViewId: string) {
    setSelectedSavedViewId(savedViewId);
    if (!savedViewId) return;
    const filters = leadFiltersFromSavedView(
      savedViews.find((view) => view.id === savedViewId),
    );
    if (!filters) {
      setToast("That saved Leads view could not be read.");
      return;
    }
    setLeadQuery(filters.query);
    setLeadStageFilter(filters.stage);
    setLeadOwnerFilter(filters.ownerId);
    setLeadAttentionFilter(filters.attention);
  }

  function saveLeadView(name: string) {
    if (!organizationId || isCreating) return;
    startCreating(async () => {
      try {
        const savedView = await createSavedView({
          organizationId,
          feature: "leads",
          name,
          filters: {
            query: leadQuery,
            stage: leadStageFilter,
            ownerId: leadOwnerFilter,
            attention: leadAttentionFilter,
          },
        });
        setSavedViews((current) => [savedView, ...current]);
        setSelectedSavedViewId(savedView.id);
        setToast(`Saved “${savedView.name}” as a private Leads view.`);
      } catch (error) {
        setToast(
          error instanceof Error
            ? error.message
            : "AIOS could not save that Leads view.",
        );
      }
    });
  }

  function removeLeadSavedView() {
    if (!organizationId || !selectedSavedViewId || isCreating) return;
    startCreating(async () => {
      try {
        await deleteSavedView({
          organizationId,
          savedViewId: selectedSavedViewId,
          feature: "leads",
        });
        setSavedViews((current) =>
          current.filter((view) => view.id !== selectedSavedViewId),
        );
        setSelectedSavedViewId("");
        setToast("The private Leads view was removed.");
      } catch (error) {
        setToast(
          error instanceof Error
            ? error.message
            : "AIOS could not remove that Leads view.",
        );
      }
    });
  }

  function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const destination = String(form.get("destination") || "").trim();
    const budget = String(form.get("budget") || "").trim();
    if (!name || !destination) return;

    startCreating(async () => {
      try {
        const [firstName, ...lastName] = name.split(/\s+/);
        const contact = await createContact({
          organizationId,
          firstName,
          lastName: lastName.join(" ") || null,
          email: null,
          phone: null,
          ownerId: null,
        });
        const probability = Number.parseInt(
          String(form.get("probability") || "10"),
          10,
        );
        const nextStep = String(form.get("nextStep") || "").trim();
        const expectedCloseAt = String(
          form.get("expectedCloseAt") || "",
        ).trim();
        const deal = await createDeal({
          organizationId,
          contactId: contact.id,
          ownerId: null,
          title: name,
          stage: "new",
          valueAmount: parseAmount(budget),
          currency: "INR",
          source: "Manual",
          destination,
          probability: Number.isFinite(probability) ? probability : 10,
          nextStep: nextStep || null,
          expectedCloseAt: expectedCloseAt || null,
        });
        setLeads((current) => [leadFromDeal(deal), ...current]);
        window.sessionStorage.setItem(
          "aios.crm.flash",
          `${name} is now in your live pipeline.`,
        );
        router.push("/leads");
        setLeadOpen(false);
      } catch {
        showTimedToast("AIOS could not create that lead. Please try again.");
      }
    });
  }

  function moveLeadToStage(lead: Lead, stage: PipelineStage) {
    if (!organizationId || movingLeadId) return;
    if (!isAllowedPipelineTransition(lead.databaseStage, stage)) {
      showTimedToast(
        `${PIPELINE_STAGE_LABELS[stage]} is not a legal adjacent move from ${lead.stage}.`,
      );
      return;
    }
    setMovingLeadId(lead.id);
    startMoving(async () => {
      try {
        const result = await updateDealStage({
          organizationId,
          dealId: lead.id,
          stage,
        });
        if (!result.ok) {
          showTimedToast(result.message);
          return;
        }
        const updated = result.deal;
        setLeads((current) =>
          current.map((item, index) =>
            item.id === lead.id ? leadFromDeal(updated, index) : item,
          ),
        );
        showTimedToast(
          `${lead.name} moved to ${PIPELINE_STAGE_LABELS[stage]}.`,
        );
      } catch {
        showTimedToast("AIOS could not update that stage. Please try again.");
      } finally {
        setMovingLeadId(null);
      }
    });
  }

  function advanceLead(lead: Lead) {
    const nextStage: Partial<Record<LiveDeal["stage"], PipelineStage>> = {
      new: "qualified",
      qualified: "proposal",
      proposal: "decision",
    };
    const stage = nextStage[lead.databaseStage];
    if (stage) moveLeadToStage(lead, stage);
  }

  function beginLeadDrag(
    lead: Lead,
    event: ReactDragEvent<HTMLElement>,
  ) {
    if (movingLeadId) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", lead.id);
    setDraggedLeadId(lead.id);
    setActiveDropStage(null);
  }

  function endLeadDrag() {
    setDraggedLeadId(null);
    setActiveDropStage(null);
  }

  function dropLeadOnStage(stage: PipelineStage, transferredLeadId: string) {
    const leadId = transferredLeadId || draggedLeadId;
    const draggedLead = leads.find((lead) => lead.id === leadId);
    endLeadDrag();
    if (!draggedLead) return;
    moveLeadToStage(draggedLead, stage);
  }

  return (
    <main className="page-wrap" id="main-content" tabIndex={-1}>
          {active === "Command center" ? (
            <>
              <section className="page-intro">
                <div>
                  <p className="date">TODAY</p>
                  <h1>Good morning, {userFirstName}.</h1>
                  <p>
                    {workspaceOverdueTaskCount +
                      attentionSummary.workspaceOverdueInbox +
                      attentionSummary.overduePayments +
                      attentionSummary.workspacePendingApprovals}{" "}
                    items need attention in {workspaceName}.
                  </p>
                </div>
                <div className="intro-actions">
                  <Link
                    className="secondary-button"
                    href="/aios/approvals"
                  >
                    Review approvals
                  </Link>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={openLeadModal}
                  >
                    <span>+</span> New lead
                  </button>
                </div>
              </section>
              {leads.length === 0 ? <SetupChecklist hasLead={false} /> : null}
              <section className="crm-attention-grid" aria-label="Needs attention">
                <Link href="/tasks">
                  <span>
                    My overdue tasks · {workspaceOverdueTaskCount} workspace-wide
                  </span>
                  <b>{overdueTaskCount}</b>
                  <small>Open task queue →</small>
                </Link>
                <Link href="/inbox">
                  <span>
                    My overdue replies · {attentionSummary.workspaceOverdueInbox}{" "}
                    workspace-wide
                  </span>
                  <b>{attentionSummary.myOverdueInbox}</b>
                  <small>Open Inbox →</small>
                </Link>
                <Link href="/aios/approvals">
                  <span>
                    My approvals · {attentionSummary.workspacePendingApprovals}{" "}
                    workspace-wide
                  </span>
                  <b>{attentionSummary.myPendingApprovals}</b>
                  <small>Review decisions →</small>
                </Link>
                <Link href="/trips">
                  <span>
                    My active trips · {attentionSummary.workspaceActiveTrips}{" "}
                    workspace-wide
                  </span>
                  <b>{attentionSummary.myActiveTrips}</b>
                  <small>Open operations →</small>
                </Link>
                <Link href="/finance">
                  <span>Payments overdue</span>
                  <b>{attentionSummary.overduePayments}</b>
                  <small>Open Finance →</small>
                </Link>
              </section>
              <section className="metric-grid">
                <Metric
                  label="Pipeline value"
                  value={
                    pipelineCurrency
                      ? formatAmount(pipelineValue || null, pipelineCurrency)
                      : "Multi-currency"
                  }
                  note={
                    pipelineCurrency
                      ? "active opportunities"
                      : "currency conversion is not configured"
                  }
                  tone="purple"
                  icon="↗"
                />
                <Metric
                  label="Open leads"
                  value={String(leads.length)}
                  note="in live CRM"
                  tone="blue"
                  icon="◉"
                />
                <Metric
                  label="30-day forecast"
                  value={
                    pipelineCurrency
                      ? formatAmount(weightedForecast || null, pipelineCurrency)
                      : "Multi-currency"
                  }
                  note={
                    forecastLeads.length
                      ? `${forecastLeads.length} expected close${forecastLeads.length === 1 ? "" : "s"}`
                      : "add expected-close dates"
                  }
                  tone="green"
                  icon="⌁"
                />
                <Metric
                  label="Overdue follow-ups"
                  value={String(workspaceOverdueTaskCount)}
                  note={
                    openTaskCount
                      ? `${openTaskCount} active tasks in queue`
                      : "task queue is clear"
                  }
                  tone="orange"
                  icon="!"
                />
              </section>
              <section className="dashboard-grid top-grid">
                <article className="panel revenue">
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">LIVE SALES INTELLIGENCE</p>
                      <h2>Your active opportunity mix</h2>
                    </div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => router.push("/leads")}
                    >
                      Open pipeline →
                    </button>
                  </div>
                  <div className="revenue-body">
                    <div>
                      <strong>
                        {pipelineCurrency
                          ? formatAmount(
                              pipelineValue || null,
                              pipelineCurrency,
                            )
                          : "Multi-currency"}
                      </strong>
                      <span>
                        {forecastLeads.length
                          ? `${forecastLeads.length} expected to close within 30 days`
                          : "add expected-close dates to forecast this pipeline"}
                      </span>
                      <p>
                        <b>{leads.length}</b> opportunities ready to work
                      </p>
                    </div>
                    <div
                      className="pipeline-stage-summary"
                      aria-label="Pipeline stage summary"
                    >
                      {(
                        [
                          ["New", grouped.new],
                          ["Qualified", grouped.qualified],
                          ["Proposal", grouped.proposal],
                          ["Decision", grouped.decision],
                        ] as const
                      ).map(([stage, stageLeads]) => (
                        <Link key={stage} href="/leads">
                          <span>{stage}</span>
                          <b>{stageLeads.length}</b>
                          <small>
                            {pipelineCurrency
                              ? formatAmount(
                                  stageLeads.reduce(
                                    (sum, lead) => sum + lead.amount,
                                    0,
                                  ) || null,
                                  pipelineCurrency,
                                )
                              : `${Math.round(
                                  (stageLeads.length /
                                    Math.max(leads.length, 1)) *
                                    100,
                                )}% of pipeline`}
                          </small>
                        </Link>
                      ))}
                    </div>
                  </div>
                </article>
                <article className="panel ai-brief">
                  <div className="ai-card-head">
                    <span className="ai-star">✦</span>
                    <span>
                      <p className="eyebrow">AIOS TODAY</p>
                      <h2>Work completed and waiting</h2>
                    </span>
                  </div>
                  <div className="ai-brief-list">
                    <div className="ai-brief-row">
                      <b>01</b>
                      <span>
                        <strong>{attentionSummary.aiCompletedToday} AI actions completed</strong>
                        <small>
                          Summaries, analysis, and approved internal work today.
                        </small>
                      </span>
                    </div>
                    <div className="ai-brief-row">
                      <b>02</b>
                      <span>
                        <strong>
                          {attentionSummary.myPendingApprovals} approval
                          {attentionSummary.myPendingApprovals === 1 ? "" : "s"}{" "}
                          need your decision
                        </strong>
                        <small>
                          {attentionSummary.workspacePendingApprovals === 0
                            ? "No approval gate is waiting in this workspace."
                            : attentionSummary.myPendingApprovals === 0
                              ? `${attentionSummary.workspacePendingApprovals} pending workspace-wide; none are assigned to you.`
                              : `${attentionSummary.workspacePendingApprovals} pending across the workspace.`}
                        </small>
                      </span>
                    </div>
                    <div className="ai-brief-row">
                      <b>03</b>
                      <span>
                        <strong>
                          {attentionSummary.myOverdueInbox} conversation
                          {attentionSummary.myOverdueInbox === 1 ? "" : "s"}{" "}
                          need your reply
                        </strong>
                        <small>
                          {attentionSummary.workspaceOverdueInbox === 0
                            ? "The workspace response queue is current."
                            : `${attentionSummary.workspaceOverdueInbox} overdue across the workspace.`}
                        </small>
                      </span>
                    </div>
                  </div>
                  <button
                    className="ask-bar aios-sweep-action"
                    type="button"
                    onClick={runDailyCoordinator}
                    disabled={
                      isCoordinating ||
                      !["owner", "admin", "operations"].includes(
                        workspaceRole || "",
                      )
                    }
                  >
                    ✦ {isCoordinating ? "Coordinating work…" : "Run daily AIOS sweep"}
                    <i>internal work only</i>
                  </button>
                  <a className="ask-bar" href="/aios/approvals">
                    ✦ Review AI work <i>activity &amp; approvals →</i>
                  </a>
                </article>
              </section>
              <section className="dashboard-grid lower-grid">
                <article className="panel">
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">DEAL ROOM</p>
                      <h2>Most recent live leads</h2>
                    </div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => router.push("/leads")}
                    >
                      View pipeline →
                    </button>
                  </div>
                  <DataTable
                    caption="Most recent live leads"
                    columns={recentLeadColumns}
                    rows={leads.slice(0, 3)}
                    getRowKey={(lead) => lead.id}
                    loading={isLoading}
                    loadingLabel="Loading live opportunities"
                    emptyTitle="No live leads yet"
                    emptyDescription="Create the first lead to start your pipeline."
                    compact
                  />
                  <button
                    className="soft-action"
                    type="button"
                    onClick={openLeadModal}
                  >
                    Create a live lead <span>→</span>
                  </button>
                </article>
                <article className="panel priorities">
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">SLA ATTENTION RADAR</p>
                      <h2>Opportunities that need a human</h2>
                    </div>
                  </div>
                  <div className="priority-list">
                    {attentionLeads.length === 0 ? (
                      <p className="radar-empty">
                        All live opportunities have an owner, next step, and
                        recent activity.
                      </p>
                    ) : (
                      attentionLeads.map((lead) => (
                        <a
                          className="priority radar-item"
                          href={`/leads/${lead.id}`}
                          key={lead.id}
                        >
                          <span className={`check ${lead.severity}`} />
                          <span>
                            <strong>{lead.name}</strong>
                            <small>{lead.reasons.join(" · ")}</small>
                          </span>
                          <em
                            className={
                              lead.severity === "critical" ? "urgent" : ""
                            }
                          >
                            {lead.severity === "critical"
                              ? "Act now"
                              : "Review"}
                          </em>
                        </a>
                      ))
                    )}
                  </div>
                </article>
              </section>
            </>
          ) : (
            <section className="module-page">
              <OperationalPageHeader
                contained
                section="Sales"
                title="Leads & pipeline"
                meta={`${filteredLeads.length} active opportunities`}
                actions={
                <button
                  className="primary-button"
                  type="button"
                  onClick={openLeadModal}
                >
                  + New lead
                </button>
                }
              />
              <div className="pipeline-summary">
                <span>
                  <b>{filteredLeads.length}</b> matching leads
                </span>
                <span>
                  <b>
                    {pipelineCurrency
                      ? formatAmount(
                          filteredPipelineValue || null,
                          pipelineCurrency,
                        )
                      : "Multi-currency"}
                  </b>{" "}
                  filtered value
                </span>
                <span>
                  <b>{isMoving ? "Updating" : "Live"}</b> Supabase data
                </span>
              </div>
              <section
                className="lead-filter-workspace"
                aria-label="Lead pipeline filters"
              >
                <div className="lead-filters">
                  <label>
                    Search leads
                    <input
                      value={leadQuery}
                      placeholder="Traveller, destination, source…"
                      onChange={(event) => {
                        setLeadQuery(event.target.value);
                        setSelectedSavedViewId("");
                      }}
                    />
                  </label>
                  <label>
                    Stage
                    <select
                      value={leadStageFilter}
                      onChange={(event) => {
                        setLeadStageFilter(
                          event.target.value as LeadStageFilter,
                        );
                        setSelectedSavedViewId("");
                      }}
                    >
                      <option value="all">Every stage</option>
                      <option value="new">New</option>
                      <option value="qualified">Qualified</option>
                      <option value="proposal">Proposal</option>
                      <option value="decision">Decision</option>
                    </select>
                  </label>
                  <label>
                    Owner
                    <select
                      value={leadOwnerFilter}
                      onChange={(event) => {
                        setLeadOwnerFilter(event.target.value);
                        setSelectedSavedViewId("");
                      }}
                    >
                      <option value="all">Every owner</option>
                      <option value="unassigned">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Attention
                    <select
                      value={leadAttentionFilter}
                      onChange={(event) => {
                        setLeadAttentionFilter(
                          event.target.value as LeadAttentionFilter,
                        );
                        setSelectedSavedViewId("");
                      }}
                    >
                      <option value="all">Any health</option>
                      <option value="attention">Needs attention</option>
                      <option value="healthy">Healthy</option>
                    </select>
                  </label>
                  <span>{filteredLeads.length} shown</span>
                </div>
                <SavedViewControls
                  areaLabel="Leads"
                  disabled={isCreating || !organizationId}
                  selectedId={selectedSavedViewId}
                  views={savedViews}
                  onSelect={selectLeadSavedView}
                  onSave={saveLeadView}
                  onRemove={removeLeadSavedView}
                />
              </section>
              <p className="pipeline-guidance">
                Drag cards between valid adjacent stages, or use Move stage.
                Every change is validated before it is saved.
              </p>
              <div className="kanban">
                <KanbanColumn
                  stage="new"
                  title="New inquiry"
                  leads={filteredGrouped.new}
                  draggedLead={draggedLead}
                  activeDropStage={activeDropStage}
                  movingLeadId={movingLeadId}
                  onCreate={openLeadModal}
                  onAdvance={advanceLead}
                  onMove={moveLeadToStage}
                  onDragStart={beginLeadDrag}
                  onDragEnd={endLeadDrag}
                  onDragEnter={setActiveDropStage}
                  onDrop={dropLeadOnStage}
                />
                <KanbanColumn
                  stage="qualified"
                  title="Qualified"
                  leads={filteredGrouped.qualified}
                  draggedLead={draggedLead}
                  activeDropStage={activeDropStage}
                  movingLeadId={movingLeadId}
                  onCreate={openLeadModal}
                  onAdvance={advanceLead}
                  onMove={moveLeadToStage}
                  onDragStart={beginLeadDrag}
                  onDragEnd={endLeadDrag}
                  onDragEnter={setActiveDropStage}
                  onDrop={dropLeadOnStage}
                />
                <KanbanColumn
                  stage="proposal"
                  title="Proposal"
                  leads={filteredGrouped.proposal}
                  draggedLead={draggedLead}
                  activeDropStage={activeDropStage}
                  movingLeadId={movingLeadId}
                  onCreate={openLeadModal}
                  onAdvance={advanceLead}
                  onMove={moveLeadToStage}
                  onDragStart={beginLeadDrag}
                  onDragEnd={endLeadDrag}
                  onDragEnter={setActiveDropStage}
                  onDrop={dropLeadOnStage}
                />
                <KanbanColumn
                  stage="decision"
                  title="Decision"
                  leads={filteredGrouped.decision}
                  draggedLead={draggedLead}
                  activeDropStage={activeDropStage}
                  movingLeadId={movingLeadId}
                  onCreate={openLeadModal}
                  onAdvance={advanceLead}
                  onMove={moveLeadToStage}
                  onDragStart={beginLeadDrag}
                  onDragEnd={endLeadDrag}
                  onDragEnter={setActiveDropStage}
                  onDrop={dropLeadOnStage}
                />
              </div>
            </section>
          )}
      {toast && (
        <div className="toast"><StatusNotice>{toast}</StatusNotice></div>
      )}
      {leadOpen && (
        <LeadModal
          pending={isCreating}
          onClose={() => setLeadOpen(false)}
          onSubmit={submitLead}
        />
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  icon: string;
}) {
  return (
    <article className="metric-card">
      <span className={`metric-icon ${tone}`}>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small className={tone === "orange" ? "alert" : "up"}>{note}</small>
    </article>
  );
}

function Priority({ title, area }: { title: string; area: string }) {
  return (
    <div className="priority">
      <span className="check">→</span>
      <span>
        <strong>{title}</strong>
        <small>{area}</small>
      </span>
    </div>
  );
}

void Priority;

function LeadModal({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <ModalBoundary className="modal-layer" onClose={onClose}>
      <form
        className="lead-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-modal-title"
        tabIndex={-1}
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">CREATE LIVE LEAD</p>
            <h2 id="lead-modal-title">Start a new journey</h2>
          </div>
          <button type="button" onClick={onClose} disabled={pending}>
            ×
          </button>
        </header>
        <label>
          Traveller name
          <input name="name" required placeholder="e.g. Arjun Sharma" />
        </label>
        <label>
          Destination or journey
          <input
            name="destination"
            required
            placeholder="e.g. Japan food & culture"
          />
        </label>
        <label>
          Estimated trip value
          <input name="budget" placeholder="e.g. ₹ 4.5L" />
        </label>
        <label>
          Initial win probability
          <input
            name="probability"
            type="number"
            min="0"
            max="100"
            defaultValue="10"
          />
        </label>
        <label>
          Next step
          <input name="nextStep" placeholder="e.g. Confirm departure city" />
        </label>
        <label>
          Expected close date
          <input name="expectedCloseAt" type="date" />
        </label>
        <div className="form-ai">
          <span>✦</span>
          <p>
            <b>AIOS creates a secure CRM record first.</b>
            <small>
              No communication, price, booking, or customer-facing action is
              automated.
            </small>
          </p>
        </div>
        <footer>
          <Button
            type="button"
            variant="secondary"
            className="cancel"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create lead"} <span>→</span>
          </Button>
        </footer>
      </form>
    </ModalBoundary>
  );
}
