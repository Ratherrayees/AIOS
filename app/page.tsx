"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";

import {
  createContact,
  createDeal,
  createSavedView,
  deleteSavedView,
  updateDealStage,
} from "./actions/crm";
import { signOut } from "./sign-out/actions";
import { createSupabaseBrowserClient } from "../lib/supabase/browser";
import {
  loadWorkspaceContext,
  saveActiveWorkspace,
} from "../lib/supabase/workspace-context";
import type { WorkspaceChoice } from "../lib/workspace/active-workspace";
import type { Database, Json } from "../types/database";
import { assessLeadHealth } from "../lib/crm/lead-health";
import { Button } from "../components/ui/button";
import { StatusNotice } from "../components/ui/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "../components/ui/data-table";
import { ModalBoundary } from "../components/ui/modal-boundary";
import { SavedViewControls } from "../components/ui/saved-view-controls";
import "./search.css";
import "./leads-filters.css";

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
type SearchResult = {
  id: string;
  title: string;
  detail: string;
  kind: "Lead" | "Contact" | "Task";
  href: string;
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

function LeadCard({ lead, onAdvance }: { lead: Lead; onAdvance?: () => void }) {
  return (
    <article className="lead-card">
      <div>
        <Avatar
          initials={lead.name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)}
          accent={lead.accent}
        />
        <button type="button" aria-label={`More options for ${lead.name}`}>
          •••
        </button>
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
      {onAdvance && lead.stage !== "Decision" && (
        <button className="text-button" type="button" onClick={onAdvance}>
          Move forward →
        </button>
      )}
    </article>
  );
}

function KanbanColumn({
  title,
  leads,
  onCreate,
  onAdvance,
}: {
  title: string;
  leads: Lead[];
  onCreate: () => void;
  onAdvance: (lead: Lead) => void;
}) {
  const total = leads.reduce((sum, lead) => sum + lead.amount, 0);
  return (
    <div className="kanban-column">
      <div className="kanban-head">
        <span>
          <i />
          {title} <b>{leads.length}</b>
        </span>
        <strong>{formatAmount(total || null)}</strong>
      </div>
      {leads.map((lead) => (
        <LeadCard key={lead.id} lead={lead} onAdvance={() => onAdvance(lead)} />
      ))}
      <button className="add-card" type="button" onClick={onCreate}>
        + Add to {title.toLowerCase()}
      </button>
    </div>
  );
}

export default function Home() {
  const [active, setActive] = useState<View>("Command center");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Your travel workspace");
  const [availableWorkspaces, setAvailableWorkspaces] = useState<
    WorkspaceChoice[]
  >([]);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
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
  const [isLoading, setIsLoading] = useState(true);
  const [leadOpen, setLeadOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [toast, setToast] = useState("");
  const [isCreating, startCreating] = useTransition();
  const [isMoving, startMoving] = useTransition();

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
      setAvailableWorkspaces(context.workspaces);
      const [
        { data: deals },
        { data: tasks },
        { data: memberRows },
        { data: savedViewRows },
      ] = await Promise.all([
        supabase
          .from("deals")
          .select("*")
          .eq("organization_id", context.active.organization_id)
          .is("archived_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("tasks")
          .select("status, due_at")
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
      const activeTasks = (tasks || []).filter(
        (task) => task.status === "open" || task.status === "in_progress",
      );
      setOpenTaskCount(activeTasks.length);
      setOverdueTaskCount(
        activeTasks.filter(
          (task) => task.due_at && new Date(task.due_at).getTime() < Date.now(),
        ).length,
      );
      setIsLoading(false);
    };
    void loadWorkspace().catch(() => {
      setToast("AIOS could not load your active workspace.");
      setIsLoading(false);
    });
  }, []);

  function changeWorkspace(nextOrganizationId: string) {
    if (nextOrganizationId === organizationId) {
      setWorkspaceMenuOpen(false);
      return;
    }
    if (!availableWorkspaces.length) return;

    try {
      saveActiveWorkspace(nextOrganizationId, availableWorkspaces);
      setWorkspaceMenuOpen(false);
      window.location.reload();
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "AIOS could not switch workspaces.",
      );
    }
  }

  useEffect(() => {
    const openCommandPalette = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openCommandPalette);
    return () => window.removeEventListener("keydown", openCommandPalette);
  }, []);

  useEffect(() => {
    if (!searchOpen || !organizationId) return;
    const query = searchTerm.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setIsSearching(true);
        const pattern = `%${query.replace(/[\\%_(),.]/g, " ")}%`;
        const supabase = createSupabaseBrowserClient();
        const [{ data: dealRows }, { data: contactRows }, { data: taskRows }] =
          await Promise.all([
            supabase
              .from("deals")
              .select("id, title, destination")
              .eq("organization_id", organizationId)
              .ilike("title", pattern)
              .limit(5),
            supabase
              .from("contacts")
              .select("id, first_name, last_name, email")
              .eq("organization_id", organizationId)
              .ilike("first_name", pattern)
              .limit(5),
            supabase
              .from("tasks")
              .select("id, title, status")
              .eq("organization_id", organizationId)
              .ilike("title", pattern)
              .limit(5),
          ]);
        if (cancelled) return;
        setSearchResults([
          ...(dealRows || []).map((deal) => ({
            id: deal.id,
            title: deal.title,
            detail: deal.destination || "Travel opportunity",
            kind: "Lead" as const,
            href: `/leads/${deal.id}`,
          })),
          ...(contactRows || []).map((contact) => ({
            id: contact.id,
            title: [contact.first_name, contact.last_name]
              .filter(Boolean)
              .join(" "),
            detail: contact.email || "CRM contact",
            kind: "Contact" as const,
            href: "/contacts",
          })),
          ...(taskRows || []).map((task) => ({
            id: task.id,
            title: task.title,
            detail: task.status.replace("_", " "),
            kind: "Task" as const,
            href: "/tasks",
          })),
        ]);
        setIsSearching(false);
      })();
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [organizationId, searchOpen, searchTerm]);

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

  function openLeadModal() {
    if (!organizationId) {
      setToast(
        "Your workspace is still loading. Please try again in a moment.",
      );
      return;
    }
    setLeadOpen(true);
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
        setActive("Leads");
        setLeadOpen(false);
        setToast(`${name} is now in your live pipeline.`);
      } catch {
        setToast("AIOS could not create that lead. Please try again.");
      }
      window.setTimeout(() => setToast(""), 3400);
    });
  }

  function advanceLead(lead: Lead) {
    if (!organizationId || isMoving) return;
    const nextStage: Record<LeadStage, LiveDeal["stage"]> = {
      New: "qualified",
      Qualified: "proposal",
      Proposal: "decision",
      Decision: "decision",
    };
    const stage = nextStage[lead.stage];
    if (stage === "decision" && lead.stage === "Decision") return;

    startMoving(async () => {
      try {
        const updated = await updateDealStage({
          organizationId,
          dealId: lead.id,
          stage,
        });
        setLeads((current) =>
          current.map((item, index) =>
            item.id === lead.id ? leadFromDeal(updated, index) : item,
          ),
        );
        setToast(`${lead.name} moved to ${stage}.`);
      } catch {
        setToast("AIOS could not update that stage. Please try again.");
      }
      window.setTimeout(() => setToast(""), 3400);
    });
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-mark">A</span>
          <span>AIOS</span>
        </div>
        <div
          className="workspace-control"
          onKeyDown={(event) => {
            if (event.key === "Escape") setWorkspaceMenuOpen(false);
          }}
        >
          <button
            className="workspace-switcher"
            type="button"
            aria-expanded={workspaceMenuOpen}
            aria-haspopup="menu"
            onClick={() => setWorkspaceMenuOpen((current) => !current)}
          >
            <span className="workspace-glyph">◆</span>
            <span>
              <small>WORKSPACE</small>
              <b>{workspaceName}</b>
            </span>
            <i aria-hidden="true">{workspaceMenuOpen ? "⌃" : "⌄"}</i>
          </button>
          {workspaceMenuOpen && (
            <div className="workspace-menu" role="menu">
              {availableWorkspaces.map((workspace) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={workspace.organization_id === organizationId}
                  key={workspace.organization_id}
                  onClick={() => changeWorkspace(workspace.organization_id)}
                >
                  <span>{workspace.name}</span>
                  <small>{workspace.role.replace("_", " ")}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <nav aria-label="CRM navigation">
          <p className="nav-heading">WORKSPACE</p>
          <button
            className={`nav-link ${active === "Command center" ? "selected" : ""}`}
            type="button"
            onClick={() => setActive("Command center")}
          >
            <span className="nav-glyph">◫</span>
            <span>Command center</span>
          </button>
          <button
            className={`nav-link ${active === "Leads" ? "selected" : ""}`}
            type="button"
            onClick={() => setActive("Leads")}
          >
            <span className="nav-glyph">◉</span>
            <span>Leads</span>
            <b>{leads.length}</b>
          </button>
          <a className="nav-link" href="/contacts">
            <span className="nav-glyph">◎</span>
            <span>Contacts</span>
          </a>
          <a className="nav-link" href="/inbox">
            <span className="nav-glyph">◌</span>
            <span>Inbox</span>
          </a>
          <a className="nav-link" href="/tasks">
            <span className="nav-glyph">✓</span>
            <span>Tasks</span>
          </a>
          <a className="nav-link" href="/quotes">
            <span className="nav-glyph">Q</span>
            <span>Quotes</span>
          </a>
          <a className="nav-link" href="/itineraries">
            <span className="nav-glyph">I</span>
            <span>Itinerary Studio</span>
          </a>
          <a className="nav-link" href="/analytics">
            <span className="nav-glyph">↗</span>
            <span>Revenue analytics</span>
          </a>
          <a className="nav-link" href="/settings/lead-capture">
            <span className="nav-glyph">+</span>
            <span>Lead capture</span>
          </a>
          <a className="nav-link" href="/aios">
            <span className="nav-glyph">✦</span>
            <span>AIOS Control</span>
          </a>
          <a className="nav-link" href="/settings/team">
            <span className="nav-glyph">T</span>
            <span>Team access</span>
          </a>
          <a className="nav-link" href="/settings/security">
            <span className="nav-glyph">2</span>
            <span>Account security</span>
          </a>
        </nav>
        <div className="sidebar-footer">
          <div className="secure">
            <i>✓</i> Tenant-secured workspace
          </div>
          <form action={signOut}>
            <button className="profile" type="submit" title="Sign out">
              <Avatar initials="RA" accent="rayees" />
              <span>
                <b>Rayees Amin</b>
                <small>Owner · Admin · Sign out</small>
              </span>
            </button>
          </form>
        </div>
      </aside>
      <section className="workspace-main" id="main-content" tabIndex={-1}>
        <header className="header">
          <button
            className="global-search"
            type="button"
            onClick={() => setSearchOpen(true)}
          >
            <span>⌕</span>
            <span>Search leads, contacts, and tasks…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="header-actions">
            <span style={{ color: "#777588", fontSize: 11 }}>Live CRM</span>
            <Avatar initials="RA" accent="rayees" />
          </div>
        </header>
        <div className="page-wrap">
          {active === "Command center" ? (
            <>
              <section className="page-intro">
                <div>
                  <p className="date">AIOS COMMAND CENTER</p>
                  <h1>Good morning, Rayees.</h1>
                  <p>Live pipeline data for {workspaceName}.</p>
                </div>
                <div className="intro-actions">
                  <Link
                    className="secondary-button"
                    href="/aios#lead-intake"
                  >
                    ✦ Open AIOS workspace
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
                  value={String(overdueTaskCount)}
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
                      onClick={() => setActive("Leads")}
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
                    <div className="chart">
                      <div className="chart-labels">
                        <span>Decision</span>
                        <span>Proposal</span>
                        <span>Qualified</span>
                      </div>
                      <svg
                        viewBox="0 0 440 144"
                        role="img"
                        aria-label="Pipeline stage mix"
                      >
                        <defs>
                          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                            <stop stopColor="#7759f5" stopOpacity=".22" />
                            <stop
                              offset="1"
                              stopColor="#7759f5"
                              stopOpacity="0"
                            />
                          </linearGradient>
                        </defs>
                        <path
                          d="M3 118 C60 108,90 80,145 93 S230 42,290 65 S375 25,438 18 V144 H3Z"
                          fill="url(#area)"
                        />
                        <path
                          d="M3 118 C60 108,90 80,145 93 S230 42,290 65 S375 25,438 18"
                          fill="none"
                          stroke="#7657ed"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="months">
                        <span>New</span>
                        <span>Qualified</span>
                        <span>Proposal</span>
                        <span>Decision</span>
                      </div>
                    </div>
                  </div>
                  <div className="revenue-legend">
                    <span>
                      <i className="purple-dot" />
                      New <b>{grouped.new.length}</b>
                    </span>
                    <span>
                      <i className="blue-dot" />
                      Proposal <b>{grouped.proposal.length}</b>
                    </span>
                    <span>
                      <i className="gray-dot" />
                      Decision <b>{grouped.decision.length}</b>
                    </span>
                  </div>
                </article>
                <article className="panel ai-brief">
                  <div className="ai-card-head">
                    <span className="ai-star">✦</span>
                    <span>
                      <p className="eyebrow">AIOS CONTROL</p>
                      <h2>Human authority stays in control</h2>
                    </span>
                  </div>
                  <div className="ai-brief-list">
                    <button type="button">
                      <b>01</b>
                      <span>
                        <strong>Lead pipeline is live</strong>
                        <small>
                          Governed forms turn attributed requests into response
                          deadlines and deduplicated opportunities.
                        </small>
                      </span>
                    </button>
                    <button type="button">
                      <b>02</b>
                      <span>
                        <strong>Tenant boundaries are enforced</strong>
                        <small>RLS scopes each deal to its workspace.</small>
                      </span>
                    </button>
                    <button type="button">
                      <b>03</b>
                      <span>
                        <strong>Autonomy is configurable</strong>
                        <small>
                          Review drafts, approvals, and safe agent policies in
                          AIOS Control.
                        </small>
                      </span>
                    </button>
                  </div>
                  <a className="ask-bar" href="/aios">
                    ✦ Open AIOS Control <i>policies &amp; approvals →</i>
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
                      onClick={() => setActive("Leads")}
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
              <section className="module-header">
                <div>
                  <p className="date">SALES WORKSPACE</p>
                  <h1>Lead pipeline</h1>
                  <span>
                    Live, organization-scoped opportunities—not mock data.
                  </span>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={openLeadModal}
                >
                  + New lead
                </button>
              </section>
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
              <div className="kanban">
                <KanbanColumn
                  title="Qualified"
                  leads={filteredGrouped.qualified}
                  onCreate={openLeadModal}
                  onAdvance={advanceLead}
                />
                <KanbanColumn
                  title="Proposal sent"
                  leads={filteredGrouped.proposal}
                  onCreate={openLeadModal}
                  onAdvance={advanceLead}
                />
                <KanbanColumn
                  title="Decision"
                  leads={filteredGrouped.decision}
                  onCreate={openLeadModal}
                  onAdvance={advanceLead}
                />
                <KanbanColumn
                  title="New inquiry"
                  leads={filteredGrouped.new}
                  onCreate={openLeadModal}
                  onAdvance={advanceLead}
                />
              </div>
            </section>
          )}
        </div>
      </section>
      <nav className="mobile-nav" aria-label="Mobile CRM navigation">
        <Link aria-current="page" href="/">
          <span aria-hidden="true">H</span>
          Home
        </Link>
        <Link href="/contacts">
          <span aria-hidden="true">C</span>
          Contacts
        </Link>
        <Link href="/inbox">
          <span aria-hidden="true">I</span>
          Inbox
        </Link>
        <Link href="/tasks">
          <span aria-hidden="true">T</span>
          Tasks
        </Link>
        <Link href="/quotes">
          <span aria-hidden="true">Q</span>
          Quotes
        </Link>
        <Link href="/aios">
          <span aria-hidden="true">A</span>
          AIOS
        </Link>
        <Link href="/analytics">
          <span aria-hidden="true">↗</span>
          Analytics
        </Link>
      </nav>
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
      {searchOpen && (
        <SearchPalette
          term={searchTerm}
          results={searchResults}
          searching={isSearching}
          onTermChange={(value) => {
            setSearchTerm(value);
            if (value.trim().length < 2) setIsSearching(false);
          }}
          onClose={() => {
            setSearchOpen(false);
            setSearchTerm("");
            setSearchResults([]);
          }}
        />
      )}
    </main>
  );
}

function SearchPalette({
  term,
  results,
  searching,
  onTermChange,
  onClose,
}: {
  term: string;
  results: SearchResult[];
  searching: boolean;
  onTermChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <ModalBoundary className="search-layer" onClose={onClose}>
      <section
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search your workspace"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span>⌕</span>
          <input
            autoFocus
            value={term}
            onChange={(event) => onTermChange(event.target.value)}
            placeholder="Search leads, contacts, or tasks…"
          />
          <kbd>ESC</kbd>
        </header>
        <div className="search-results">
          {term.trim().length < 2 ? (
            <p>Type at least two characters to search this workspace.</p>
          ) : searching ? (
            <p>Searching tenant-scoped CRM records…</p>
          ) : results.length === 0 ? (
            <p>No matching leads, contacts, or tasks.</p>
          ) : (
            results.map((result) => (
              <a
                href={result.href}
                key={`${result.kind}-${result.id}`}
                onClick={onClose}
              >
                <i>
                  {result.kind === "Lead"
                    ? "◉"
                    : result.kind === "Contact"
                      ? "◎"
                      : "✓"}
                </i>
                <span>
                  <b>{result.title}</b>
                  <small>{result.detail}</small>
                </span>
                <em>{result.kind}</em>
              </a>
            ))
          )}
        </div>
        <footer>
          <span>Results stay inside your active workspace.</span>
          <span>↵ Open</span>
        </footer>
      </section>
    </ModalBoundary>
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
