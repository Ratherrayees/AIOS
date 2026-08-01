"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { saveAnalyticsTarget } from "../actions/analytics";
import { createSavedView, deleteSavedView } from "../actions/crm";
import { LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { AnalyticsReportSchedule } from "../../components/ui/analytics-report-schedule";
import { SavedViewControls } from "../../components/ui/saved-view-controls";
import {
  buildManagementIntelligence,
  buildPortfolioIntelligence,
  buildGrowthIntelligence,
  type ManagementBooking,
  type ManagementException,
  type ManagementKnowledgeConflict,
  type ManagementKnowledgeSource,
  type ManagementPayment,
  type ManagementSupplier,
  type ManagementTrip,
  type PortfolioCostEstimate,
  type PortfolioQuote,
  type PortfolioQuoteVersion,
  type QualityConversation,
} from "../../lib/analytics/management-intelligence";
import {
  createManagementExportCsv,
  managementExportFilename,
} from "../../lib/analytics/management-export";
import {
  buildTargetCoverage,
  type AnalyticsTarget,
} from "../../lib/analytics/targets";
import {
  buildCompletedTripEconomics,
  type EconomicsBooking,
  type EconomicsPayment,
  type EconomicsQuote,
  type EconomicsQuoteVersion,
  type EconomicsTrip,
} from "../../lib/analytics/trip-economics";
import { buildRetentionCohorts } from "../../lib/analytics/retention-cohorts";
import {
  buildManagementPeriodComparison,
  type ManagementPeriodPreset,
  type PeriodException,
  type PeriodKnowledgeSource,
  type PeriodPayment,
  type PeriodQuote,
  type PeriodTripTransition,
} from "../../lib/analytics/management-period";
import { buildManagementAnomalyDesk } from "../../lib/analytics/management-anomalies";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import type { Json } from "../../types/database";
import "./analytics.css";

type AnalyticsRange = "30d" | "90d" | "365d" | "all";
type ForecastHorizon = 30 | 90 | 365;
type Deal = {
  id: string;
  contact_id: string | null;
  owner_id: string | null;
  source: string | null;
  source_campaign: string | null;
  destination: string | null;
  next_step: string | null;
  expected_close_at: string | null;
  stage: "new" | "qualified" | "proposal" | "decision" | "won" | "lost";
  value_amount: number | null;
  currency: string;
  probability: number;
  created_at: string;
  qualified_at: string | null;
  first_response_due_at: string | null;
  first_responded_at: string | null;
  won_at: string | null;
  lost_at: string | null;
};
type StageHistory = {
  id: string;
  deal_id: string;
  from_stage: Deal["stage"] | null;
  to_stage: Deal["stage"];
  duration_seconds: number | null;
  changed_at: string;
};
type Member = { id: string; name: string };
type SavedView = { id: string; name: string; filters: Json; created_at: string };
type ManagementIntelligence = ReturnType<typeof buildManagementIntelligence>;
type PortfolioIntelligence = ReturnType<typeof buildPortfolioIntelligence>;
type TripEconomics = ReturnType<typeof buildCompletedTripEconomics>;
type ManagementPeriodEvidence = {
  tripTransitions: PeriodTripTransition[];
  exceptions: PeriodException[];
  payments: PeriodPayment[];
  quotes: PeriodQuote[];
  knowledgeSources: PeriodKnowledgeSource[];
};

const ranges: { value: AnalyticsRange; label: string; days: number | null }[] = [
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "365d", label: "Last year", days: 365 },
  { value: "all", label: "All time", days: null },
];
const activeStages = new Set<Deal["stage"]>([
  "new",
  "qualified",
  "proposal",
  "decision",
]);

function currency(value: number, code: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(value);
}

function compactDuration(seconds: number) {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

function cohortWindowLabel(window: {
  eligibleCustomers: number;
  returnedCustomers: number;
  returnRate: number | null;
}) {
  if (window.returnRate === null) return "Collecting";
  return `${window.returnedCustomers} / ${window.eligibleCustomers} · ${window.returnRate.toFixed(1)}%`;
}

function managementPeriodHref(key: string) {
  if (key === "won-opportunities") return "/?view=leads";
  if (key === "accepted-quotes") return "/quotes";
  if (key === "completed-trips" || key === "detected-exceptions")
    return "/trips";
  if (key === "knowledge-approvals") return "/knowledge";
  return "/finance";
}

function analyticsFiltersFromSavedView(savedView: SavedView | undefined) {
  const filters = savedView?.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    return null;
  const range =
    filters.range === "30d" ||
    filters.range === "90d" ||
    filters.range === "365d" ||
    filters.range === "all"
      ? filters.range
      : "90d";
  const managementPeriod =
    filters.managementPeriod === 30 ||
    filters.managementPeriod === 90 ||
    filters.managementPeriod === 365 ||
    filters.managementPeriod === "custom"
      ? filters.managementPeriod
      : 30;
  return {
    range: range as AnalyticsRange,
    source: typeof filters.source === "string" ? filters.source : "all",
    ownerId: typeof filters.ownerId === "string" ? filters.ownerId : "all",
    managementPeriod: managementPeriod as ManagementPeriodPreset,
    customPeriodStart:
      typeof filters.customPeriodStart === "string"
        ? filters.customPeriodStart
        : "",
    customPeriodEnd:
      typeof filters.customPeriodEnd === "string"
        ? filters.customPeriodEnd
        : "",
  };
}

export default function AnalyticsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [range, setRange] = useState<AnalyticsRange>("90d");
  const [forecastHorizon, setForecastHorizon] =
    useState<ForecastHorizon>(90);
  const [managementPeriodPreset, setManagementPeriodPreset] =
    useState<ManagementPeriodPreset>(30);
  const [customPeriodStart, setCustomPeriodStart] = useState("");
  const [customPeriodEnd, setCustomPeriodEnd] = useState("");
  const [source, setSource] = useState("all");
  const [ownerId, setOwnerId] = useState("all");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterTimestamp, setFilterTimestamp] = useState(0);
  const [management, setManagement] =
    useState<ManagementIntelligence | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioIntelligence | null>(null);
  const [tripEconomics, setTripEconomics] = useState<TripEconomics | null>(
    null,
  );
  const [managementPeriodEvidence, setManagementPeriodEvidence] =
    useState<ManagementPeriodEvidence | null>(null);
  const [targets, setTargets] = useState<AnalyticsTarget[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active } = await loadWorkspaceContext(supabase);
      if (!active) {
        setNotice("No active workspace is available.");
        setLoading(false);
        return;
      }
      setOrganizationId(active.organization_id);
      setRole(active.role);
      const [
        { data: dealRows, error: dealError },
        { data: historyRows, error: historyError },
        { data: memberRows },
        { data: savedViewRows },
        { data: tripRows, error: tripError },
        { data: exceptionRows, error: exceptionError },
        { data: bookingRows, error: bookingError },
        { data: supplierRows, error: supplierError },
        { data: paymentRows, error: paymentError },
        { data: knowledgeSourceRows, error: knowledgeSourceError },
        { data: knowledgeConflictRows, error: knowledgeConflictError },
        { data: quoteRows, error: quoteError },
        { data: quoteVersionRows, error: quoteVersionError },
        { data: quoteCostRows, error: quoteCostError },
        { data: conversationRows, error: conversationError },
        { data: targetRows, error: targetError },
        { data: tripTransitionRows, error: tripTransitionError },
      ] = await Promise.all([
        supabase
          .from("deals")
          .select(
            "id, contact_id, owner_id, source, source_campaign, destination, next_step, expected_close_at, stage, value_amount, currency, probability, created_at, qualified_at, first_response_due_at, first_responded_at, won_at, lost_at",
          )
          .eq("organization_id", active.organization_id)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("deal_stage_history")
          .select(
            "id, deal_id, from_stage, to_stage, duration_seconds, changed_at",
          )
          .eq("organization_id", active.organization_id)
          .order("changed_at", { ascending: false })
          .limit(5000),
        supabase
          .from("memberships")
          .select("user_id")
          .eq("organization_id", active.organization_id)
          .eq("status", "active"),
        supabase
          .from("saved_views")
          .select("id, name, filters, created_at")
          .eq("organization_id", active.organization_id)
          .eq("feature", "analytics")
          .order("updated_at", { ascending: false }),
        supabase
          .from("trips")
          .select("id, status, start_date, quote_id, currency")
          .eq("organization_id", active.organization_id)
          .limit(5000),
        supabase
          .from("operational_exceptions")
          .select("status, severity, due_at, assigned_to, detected_at")
          .eq("organization_id", active.organization_id)
          .limit(5000),
        supabase
          .from("bookings")
          .select("trip_id, supplier_id, status, cost_amount, currency")
          .eq("organization_id", active.organization_id)
          .limit(10000),
        supabase
          .from("suppliers")
          .select("id, status, archived_at, quality_rating")
          .eq("organization_id", active.organization_id)
          .limit(5000),
        supabase
          .from("payments")
          .select(
            "trip_id, amount, paid_amount, currency, direction, status, created_at",
          )
          .eq("organization_id", active.organization_id)
          .limit(10000),
        supabase
          .from("knowledge_sources")
          .select("status, review_due_on, reviewed_at")
          .eq("organization_id", active.organization_id)
          .limit(5000),
        supabase
          .from("knowledge_conflicts")
          .select("status")
          .eq("organization_id", active.organization_id)
          .limit(5000),
        supabase
          .from("quotes")
          .select("id, currency, status, current_version, accepted_at")
          .eq("organization_id", active.organization_id)
          .limit(5000),
          supabase
            .from("quote_versions")
            .select(
              "id, quote_id, version, total_amount, net_amount, margin_amount, margin_percent",
            )
          .eq("organization_id", active.organization_id)
          .limit(10000),
        supabase
          .from("quote_cost_estimates")
          .select("quote_version_id, estimated_cost_amount")
          .eq("organization_id", active.organization_id)
          .limit(10000),
        supabase
          .from("conversations")
          .select("status, archived_at, assignee_id")
          .eq("organization_id", active.organization_id)
          .limit(10000),
        supabase
          .from("analytics_targets")
          .select(
            "id, label, currency, period_start, period_end, target_amount, is_active",
          )
          .eq("organization_id", active.organization_id)
          .order("period_start", { ascending: true })
          .limit(1000),
        supabase
          .from("trip_status_history")
          .select("to_status, changed_at")
          .eq("organization_id", active.organization_id)
          .order("changed_at", { ascending: false })
          .limit(10000),
      ]);
      const dataError =
        dealError ||
        historyError ||
        tripError ||
        exceptionError ||
        bookingError ||
        supplierError ||
        paymentError ||
        knowledgeSourceError ||
        knowledgeConflictError ||
        quoteError ||
        quoteVersionError ||
        quoteCostError ||
        conversationError ||
        targetError ||
        tripTransitionError;
      if (dataError) throw dataError;
      const memberIds = (memberRows || []).map((member) => member.user_id);
      const { data: profileRows } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [] };
      const names = new Map(
        (profileRows || []).map((profile) => [profile.id, profile.full_name]),
      );
      setMembers(
        memberIds.map((id) => ({ id, name: names.get(id) || "Team member" })),
      );
      setDeals((dealRows || []) as Deal[]);
      setHistory((historyRows || []) as StageHistory[]);
      setSavedViews((savedViewRows || []) as SavedView[]);
      setManagement(
        buildManagementIntelligence({
          trips: (tripRows || []) as ManagementTrip[],
          exceptions: (exceptionRows || []) as ManagementException[],
          bookings: (bookingRows || []) as ManagementBooking[],
          suppliers: (supplierRows || []) as ManagementSupplier[],
          payments: (paymentRows || []) as ManagementPayment[],
          knowledgeSources: (knowledgeSourceRows ||
            []) as ManagementKnowledgeSource[],
          knowledgeConflicts: (knowledgeConflictRows ||
            []) as ManagementKnowledgeConflict[],
        }),
      );
      setPortfolio(
        buildPortfolioIntelligence({
          quotes: (quoteRows || []) as PortfolioQuote[],
          versions: (quoteVersionRows || []) as PortfolioQuoteVersion[],
          costEstimates: (quoteCostRows || []) as PortfolioCostEstimate[],
          deals: (dealRows || []) as Deal[],
          conversations: (conversationRows || []) as QualityConversation[],
          trips: (tripRows || []) as ManagementTrip[],
          bookings: (bookingRows || []) as ManagementBooking[],
          suppliers: (supplierRows || []) as ManagementSupplier[],
        }),
      );
      setTripEconomics(
        buildCompletedTripEconomics({
          trips: (tripRows || []) as EconomicsTrip[],
          quotes: (quoteRows || []) as EconomicsQuote[],
          quoteVersions: (quoteVersionRows || []) as EconomicsQuoteVersion[],
          bookings: (bookingRows || []) as EconomicsBooking[],
          payments: (paymentRows || []) as EconomicsPayment[],
        }),
      );
      setManagementPeriodEvidence({
        tripTransitions: (tripTransitionRows || []) as PeriodTripTransition[],
        exceptions: (exceptionRows || []) as PeriodException[],
        payments: (paymentRows || []) as PeriodPayment[],
        quotes: (quoteRows || []) as PeriodQuote[],
        knowledgeSources: (knowledgeSourceRows ||
          []) as PeriodKnowledgeSource[],
      });
      const loadedAt = new Date();
      setCustomPeriodEnd(loadedAt.toISOString().slice(0, 10));
      setCustomPeriodStart(
        new Date(loadedAt.getTime() - 29 * 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
      setTargets((targetRows || []) as AnalyticsTarget[]);
      setFilterTimestamp(Date.now());
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load pipeline intelligence.");
      setLoading(false);
    });
  }, []);

  const sources = useMemo(
    () =>
      [...new Set(deals.map((deal) => deal.source || "Unattributed"))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [deals],
  );
  const filteredDeals = useMemo(() => {
    const days = ranges.find((item) => item.value === range)?.days;
    const cutoff =
      days && filterTimestamp
        ? filterTimestamp - days * 86_400_000
        : null;
    return deals.filter((deal) => {
      if (cutoff && new Date(deal.created_at).getTime() < cutoff) return false;
      if (source !== "all" && (deal.source || "Unattributed") !== source)
        return false;
      if (ownerId === "unassigned" && deal.owner_id) return false;
      if (
        ownerId !== "all" &&
        ownerId !== "unassigned" &&
        deal.owner_id !== ownerId
      )
        return false;
      return true;
    });
  }, [deals, filterTimestamp, ownerId, range, source]);
  const filteredIds = useMemo(
    () => new Set(filteredDeals.map((deal) => deal.id)),
    [filteredDeals],
  );
  const filteredHistory = useMemo(
    () => history.filter((item) => filteredIds.has(item.deal_id)),
    [filteredIds, history],
  );
  const growth = useMemo(
    () =>
      buildGrowthIntelligence(deals, {
        now: filterTimestamp ? new Date(filterTimestamp) : new Date(),
        horizonDays: forecastHorizon,
      }),
    [deals, filterTimestamp, forecastHorizon],
  );
  const targetCoverage = useMemo(
    () =>
      buildTargetCoverage(
        deals,
        targets,
        filterTimestamp ? new Date(filterTimestamp) : new Date(),
      ),
    [deals, filterTimestamp, targets],
  );
  const retentionCohorts = useMemo(
    () =>
      buildRetentionCohorts(
        deals,
        filterTimestamp ? new Date(filterTimestamp) : new Date(),
      ),
    [deals, filterTimestamp],
  );
  const managementPeriod = useMemo(() => {
    if (!managementPeriodEvidence) return { report: null, error: "" };
    try {
      return {
        report: buildManagementPeriodComparison({
          preset: managementPeriodPreset,
          customStart: customPeriodStart,
          customEnd: customPeriodEnd,
          now: filterTimestamp ? new Date(filterTimestamp) : new Date(),
          deals,
          ...managementPeriodEvidence,
        }),
        error: "",
      };
    } catch (error) {
      return {
        report: null,
        error:
          error instanceof Error
            ? error.message
            : "That reporting period is not valid.",
      };
    }
  }, [
    customPeriodEnd,
    customPeriodStart,
    deals,
    filterTimestamp,
    managementPeriodEvidence,
    managementPeriodPreset,
  ]);
  const anomalyDesk = useMemo(
    () =>
      management && portfolio && managementPeriod.report
        ? buildManagementAnomalyDesk({
            management,
            portfolio,
            managementPeriod: managementPeriod.report,
          })
        : null,
    [management, managementPeriod.report, portfolio],
  );

  const won = filteredDeals.filter((deal) => deal.stage === "won");
  const open = filteredDeals.filter((deal) => activeStages.has(deal.stage));
  const currencies = [...new Set(open.map((deal) => deal.currency))];
  const pipelineValue = open.reduce(
    (sum, deal) => sum + (deal.value_amount || 0),
    0,
  );
  const responded = filteredDeals.filter(
    (deal) => deal.first_responded_at && deal.first_response_due_at,
  );
  const withinSla = responded.filter(
    (deal) =>
      new Date(deal.first_responded_at!).getTime() <=
      new Date(deal.first_response_due_at!).getTime(),
  ).length;
  const closedDurations = won.flatMap((deal) =>
    deal.won_at
      ? [
          new Date(deal.won_at).getTime() -
            new Date(deal.created_at).getTime(),
        ]
      : [],
  );
  const averageCloseMs = closedDurations.length
    ? closedDurations.reduce((sum, value) => sum + value, 0) /
      closedDurations.length
    : null;
  const sourceRows = sources
    .map((sourceName) => {
      const rows = filteredDeals.filter(
        (deal) => (deal.source || "Unattributed") === sourceName,
      );
      const sourceWon = rows.filter((deal) => deal.stage === "won").length;
      const sourceOpen = rows.filter((deal) => activeStages.has(deal.stage));
      const sourceCurrencies = [...new Set(sourceOpen.map((deal) => deal.currency))];
      return {
        source: sourceName,
        leads: rows.length,
        won: sourceWon,
        conversion: rows.length ? (sourceWon / rows.length) * 100 : 0,
        pipeline: sourceOpen.reduce(
          (sum, deal) => sum + (deal.value_amount || 0),
          0,
        ),
        currency:
          sourceCurrencies.length === 1 ? sourceCurrencies[0] : null,
      };
    })
    .filter((row) => row.leads)
    .sort((a, b) => b.leads - a.leads);
  const stageRows = (
    ["new", "qualified", "proposal", "decision"] as Deal["stage"][]
  ).map((stage) => {
    const durations = filteredHistory.flatMap((item) =>
      item.from_stage === stage && item.duration_seconds !== null
        ? [item.duration_seconds]
        : [],
    );
    return {
      stage,
      transitions: durations.length,
      seconds: durations.length
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : null,
    };
  });
  const maxSourceLeads = Math.max(1, ...sourceRows.map((row) => row.leads));
  const canConfigureTargets = role === "owner" || role === "admin";

  function selectSavedView(savedViewId: string) {
    setSelectedSavedViewId(savedViewId);
    if (!savedViewId) return;
    const filters = analyticsFiltersFromSavedView(
      savedViews.find((view) => view.id === savedViewId),
    );
    if (!filters) {
      setNotice("That saved analytics view could not be read.");
      return;
    }
    setRange(filters.range);
    setSource(filters.source);
    setOwnerId(filters.ownerId);
    setManagementPeriodPreset(filters.managementPeriod);
    setCustomPeriodStart(filters.customPeriodStart);
    setCustomPeriodEnd(filters.customPeriodEnd);
  }

  function saveCurrentView(name: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const saved = await createSavedView({
          organizationId,
          feature: "analytics",
          name,
          filters: {
            range,
            source,
            ownerId,
            managementPeriod: managementPeriodPreset,
            customPeriodStart,
            customPeriodEnd,
          },
        });
        setSavedViews((current) => [saved as SavedView, ...current]);
        setSelectedSavedViewId(saved.id);
        setNotice(`Saved “${saved.name}” as a private Analytics view.`);
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "That view was not saved.",
        );
      }
    });
  }

  function removeSavedView() {
    if (!organizationId || !selectedSavedViewId || pending) return;
    startTransition(async () => {
      try {
        await deleteSavedView({
          organizationId,
          savedViewId: selectedSavedViewId,
          feature: "analytics",
        });
        setSavedViews((current) =>
          current.filter((view) => view.id !== selectedSavedViewId),
        );
        setSelectedSavedViewId("");
        setNotice("Private Analytics view removed.");
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "That view was not removed.",
        );
      }
    });
  }

  function submitAnalyticsTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending || !canConfigureTargets) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        const target = await saveAnalyticsTarget({
          organizationId,
          targetId: null,
          label: String(formData.get("label") || ""),
          currency: String(formData.get("currency") || ""),
          periodStart: String(formData.get("periodStart") || ""),
          periodEnd: String(formData.get("periodEnd") || ""),
          targetAmount: Number(formData.get("targetAmount")),
          isActive: true,
        });
        setTargets((current) => [
          target as AnalyticsTarget,
          ...current.filter((item) => item.id !== target.id),
        ]);
        form.reset();
        setNotice(
          `Approved ${target.label} target added. Coverage now uses its exact period and currency.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The analytics target could not be saved.",
        );
      }
    });
  }

  function retireAnalyticsTarget(target: AnalyticsTarget) {
    if (!organizationId || pending || !canConfigureTargets) return;
    setNotice("");
    startTransition(async () => {
      try {
        const retired = await saveAnalyticsTarget({
          organizationId,
          targetId: target.id,
          label: target.label,
          currency: target.currency,
          periodStart: target.period_start,
          periodEnd: target.period_end,
          targetAmount: target.target_amount,
          isActive: false,
        });
        setTargets((current) =>
          current.map((item) =>
            item.id === retired.id ? (retired as AnalyticsTarget) : item,
          ),
        );
        setNotice(`${retired.label} was retired from active coverage.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The analytics target could not be retired.",
        );
      }
    });
  }

  function downloadManagementReport() {
    if (
      !management ||
      !portfolio ||
      !tripEconomics ||
      !managementPeriod.report ||
      !anomalyDesk
    ) {
      setNotice("Management intelligence is still loading.");
      return;
    }
    const generatedAt = new Date();
    const csv = createManagementExportCsv({
      generatedAt,
      management,
      portfolio,
      tripEconomics,
      growth,
      retentionCohorts,
      managementPeriod: managementPeriod.report,
      anomalyDesk,
      targetCoverage,
    });
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = managementExportFilename(generatedAt);
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice(
      "Aggregate management report downloaded. Raw records, personal data, free-text labels, and cross-currency totals were excluded.",
    );
  }

  return (
    <main className="analytics-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/", label: "Pipeline" },
          { href: "/settings/lead-capture", label: "Lead Capture" },
          { href: "/aios", label: "AIOS Control" },
        ]}
      />
      <section className="analytics-hero">
        <div>
          <p>MANAGEMENT INTELLIGENCE</p>
          <h1>See revenue, readiness, and risk in one place.</h1>
          <span>
            A tenant-safe view of sales momentum, live trip operations,
            supplier readiness, financial exposure, and AIOS knowledge health.
          </span>
        </div>
        <div className="analytics-signal">
          <small>ACTIVE TRIPS</small>
          <b>{management?.operations.activeTrips ?? "—"}</b>
          <span>LIVE WORKSPACE</span>
        </div>
      </section>
      {notice && (
        <p className="analytics-notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <LoadingState label="Loading revenue intelligence" rows={5} />
      ) : (
        <>
          {management && (
            <>
              <section
                className="management-section"
                aria-labelledby="management-heading"
              >
                <header className="management-heading">
                  <div>
                    <p>LIVE MANAGEMENT PULSE</p>
                    <h2 id="management-heading">
                      What needs leadership attention now
                    </h2>
                  </div>
                  <div className="management-actions">
                    <span>
                      Tenant-authorized records · Current workspace · No
                      currencies combined
                    </span>
                    <button
                      type="button"
                      onClick={downloadManagementReport}
                      disabled={
                        !management ||
                        !portfolio ||
                        !tripEconomics ||
                        !managementPeriod.report ||
                        !anomalyDesk
                      }
                    >
                      Download aggregate CSV
                    </button>
                    <small>
                      No names, contact details, notes, record IDs, or free-text
                      target labels
                    </small>
                  </div>
                </header>
                <div className="management-grid">
                  <article className="management-card operations-card">
                    <header>
                      <span className="management-index">01</span>
                      <div>
                        <small>OWNER · OPERATIONS</small>
                        <h3>Trip readiness</h3>
                      </div>
                    </header>
                    <div className="management-primary">
                      <b>{management.operations.activeTrips}</b>
                      <span>active trips</span>
                    </div>
                    <dl>
                      <div>
                        <dt>In travel</dt>
                        <dd>{management.operations.inTravelTrips}</dd>
                      </div>
                      <div>
                        <dt>Departing ≤ 30 days</dt>
                        <dd>{management.operations.departingSoon}</dd>
                      </div>
                      <div>
                        <dt>High / critical risks</dt>
                        <dd>{management.operations.urgentExceptions}</dd>
                      </div>
                      <div>
                        <dt>Overdue / unassigned</dt>
                        <dd>
                          {management.operations.overdueExceptions} /{" "}
                          {management.operations.unassignedExceptions}
                        </dd>
                      </div>
                    </dl>
                    <Link href="/trips">Open Trip Operations →</Link>
                  </article>

                  <article className="management-card supplier-card">
                    <header>
                      <span className="management-index">02</span>
                      <div>
                        <small>OWNER · SUPPLIER OPERATIONS</small>
                        <h3>Service confirmation</h3>
                      </div>
                    </header>
                    <div className="management-primary">
                      <b>
                        {management.suppliers.confirmationRate === null
                          ? "—"
                          : `${Math.round(management.suppliers.confirmationRate)}%`}
                      </b>
                      <span>active-trip bookings confirmed</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Confirmed / active</dt>
                        <dd>
                          {management.suppliers.confirmedBookings} /{" "}
                          {management.suppliers.activeBookingInventory}
                        </dd>
                      </div>
                      <div>
                        <dt>Active suppliers</dt>
                        <dd>{management.suppliers.activeSuppliers}</dd>
                      </div>
                      <div>
                        <dt>Used in active trips</dt>
                        <dd>{management.suppliers.suppliersInActiveTrips}</dd>
                      </div>
                      <div>
                        <dt>Average quality</dt>
                        <dd>
                          {management.suppliers.averageQualityRating === null
                            ? "Not rated"
                            : `${management.suppliers.averageQualityRating.toFixed(1)} / 5`}
                        </dd>
                      </div>
                    </dl>
                    <Link href="/finance">Open Suppliers & Finance →</Link>
                  </article>

                  <article className="management-card finance-card">
                    <header>
                      <span className="management-index">03</span>
                      <div>
                        <small>OWNER · FINANCE</small>
                        <h3>Open financial exposure</h3>
                      </div>
                    </header>
                    <div className="management-primary">
                      <b>{management.finance.openObligations}</b>
                      <span>open obligations</span>
                    </div>
                    {management.finance.currencies.length ? (
                      <div
                        className="currency-exposure"
                        aria-label="Financial exposure by currency"
                      >
                        {management.finance.currencies.map((row) => (
                          <div key={row.currency}>
                            <b>{row.currency}</b>
                            <span>
                              Receive {currency(row.receivable, row.currency)}
                            </span>
                            <span>
                              Pay {currency(row.payable, row.currency)}
                            </span>
                            <em>
                              Overdue {currency(row.overdue, row.currency)}
                            </em>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="management-empty">
                        No open receivables or payables.
                      </p>
                    )}
                    <Link href="/finance">Inspect finance ledger →</Link>
                  </article>

                  <article className="management-card knowledge-card">
                    <header>
                      <span className="management-index">04</span>
                      <div>
                        <small>OWNER · KNOWLEDGE CURATION</small>
                        <h3>AIOS evidence health</h3>
                      </div>
                    </header>
                    <div className="management-primary">
                      <b>
                        {management.knowledge.freshnessRate === null
                          ? "—"
                          : `${Math.round(management.knowledge.freshnessRate)}%`}
                      </b>
                      <span>approved evidence current</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Current / stale approved</dt>
                        <dd>
                          {management.knowledge.approvedCurrent} /{" "}
                          {management.knowledge.approvedStale}
                        </dd>
                      </div>
                      <div>
                        <dt>Awaiting review</dt>
                        <dd>{management.knowledge.inReview}</dd>
                      </div>
                      <div>
                        <dt>Open conflict signals</dt>
                        <dd>{management.knowledge.openConflicts}</dd>
                      </div>
                      <div>
                        <dt>Confirmed conflicts</dt>
                        <dd>{management.knowledge.confirmedConflicts}</dd>
                      </div>
                    </dl>
                    <Link href="/knowledge">Review AIOS knowledge →</Link>
                  </article>
                </div>
              </section>

              <details className="metric-glossary">
                <summary>How these management metrics are calculated</summary>
                <div>
                  <p>
                    <b>Active trips</b> are Draft, Confirmed, or In travel;
                    Completed and Cancelled trips are excluded.
                  </p>
                  <p>
                    <b>Service confirmation</b> is Confirmed divided by all
                    non-cancelled bookings on active trips.
                  </p>
                  <p>
                    <b>Financial exposure</b> is obligation amount less recorded
                    allocations for Pending, Partially paid, or Overdue items.
                    Values remain separated by currency.
                  </p>
                  <p>
                    <b>Knowledge freshness</b> is current approved sources divided
                    by all approved sources. Missing or expired review deadlines
                    count as stale.
                  </p>
                </div>
              </details>
              <section
                className="management-period-section"
                aria-labelledby="management-period-heading"
              >
                <header className="management-heading">
                  <div>
                    <p>PERIOD COMPARISON</p>
                    <h2 id="management-period-heading">
                      Compare management activity on equal ground
                    </h2>
                  </div>
                  <div className="period-controls">
                    <label>
                      Management period
                      <select
                        value={managementPeriodPreset}
                        onChange={(event) => {
                          const value = event.target.value;
                          setManagementPeriodPreset(
                            value === "custom"
                              ? "custom"
                              : (Number(value) as 30 | 90 | 365),
                          );
                        }}
                      >
                        <option value={30}>Last 30 days</option>
                        <option value={90}>Last 90 days</option>
                        <option value={365}>Last 365 days</option>
                        <option value="custom">Custom period</option>
                      </select>
                    </label>
                    {managementPeriodPreset === "custom" && (
                      <div className="custom-period-controls">
                        <label>
                          Management period start
                          <input
                            type="date"
                            value={customPeriodStart}
                            onChange={(event) =>
                              setCustomPeriodStart(event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Management period end
                          <input
                            type="date"
                            value={customPeriodEnd}
                            onChange={(event) =>
                              setCustomPeriodEnd(event.target.value)
                            }
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </header>
                {managementPeriod.error && (
                  <p className="period-error" role="alert">
                    {managementPeriod.error}
                  </p>
                )}
                {managementPeriod.report && (
                  <article className="analytics-panel period-panel">
                    <div className="analytics-table-wrap">
                      <table>
                        <caption>
                          {managementPeriod.report.period.start} →{" "}
                          {managementPeriod.report.period.end} compared with{" "}
                          {managementPeriod.report.period.previousStart} →{" "}
                          {managementPeriod.report.period.previousEnd}
                        </caption>
                        <thead>
                          <tr>
                            <th>Evidence event</th>
                            <th>Current period</th>
                            <th>Previous equal period</th>
                            <th>Change</th>
                            <th>Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managementPeriod.report.rows.map((row) => (
                            <tr key={row.key}>
                              <td>
                                <b>{row.label}</b>
                              </td>
                              <td>{row.current}</td>
                              <td>{row.previous}</td>
                              <td>
                                {row.deltaPercent === null
                                  ? "New activity"
                                  : `${row.delta >= 0 ? "+" : ""}${row.delta} · ${row.deltaPercent >= 0 ? "+" : ""}${row.deltaPercent.toFixed(1)}%`}
                              </td>
                              <td>
                                <Link href={managementPeriodHref(row.key)}>
                                  {row.source} →
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <footer className="period-footnote">
                      <span>
                        {managementPeriod.report.period.days} inclusive days
                      </span>
                      <span>
                        Missing / invalid event timestamps{" "}
                        <b>
                          {
                            managementPeriod.report
                              .invalidOrMissingEventTimes
                          }
                        </b>
                      </span>
                      <span>
                        Counts only · no currency amounts combined
                      </span>
                    </footer>
                  </article>
                )}
              </section>
              {anomalyDesk && (
                <section
                  className="anomaly-desk"
                  aria-labelledby="anomaly-desk-heading"
                >
                  <header className="management-heading">
                    <div>
                      <p>AIOS SIGNAL DESK</p>
                      <h2 id="anomaly-desk-heading">
                        AIOS explains only what the evidence can prove
                      </h2>
                    </div>
                    <span>
                      {anomalyDesk.engine} · Rules {anomalyDesk.rulesVersion} ·{" "}
                      {anomalyDesk.evaluatedSignals} governed signals checked
                    </span>
                  </header>
                  <p className="anomaly-boundary">
                    AIOS detects material changes and current control gaps,
                    attaches exact metric citations, and proposes where a human
                    should investigate. It never invents a root cause.
                  </p>
                  {anomalyDesk.anomalies.length ? (
                    <div className="anomaly-grid">
                      {anomalyDesk.anomalies.map((anomaly) => (
                        <article
                          className={`anomaly-card severity-${anomaly.severity}`}
                          data-testid="aios-anomaly"
                          key={anomaly.id}
                        >
                          <header>
                            <span>{anomaly.severity}</span>
                            <small>{anomaly.category}</small>
                          </header>
                          <h3>{anomaly.headline}</h3>
                          <p>{anomaly.explanation}</p>
                          <div
                            className="anomaly-evidence"
                            aria-label={`Evidence for ${anomaly.headline}`}
                          >
                            {anomaly.evidence.map((evidence) => (
                              <Link
                                href={evidence.href}
                                key={`${anomaly.id}-${evidence.metric}-${evidence.scope}`}
                              >
                                <span>{evidence.metric}</span>
                                <b>{evidence.value}</b>
                                <small>
                                  {evidence.scope} · {evidence.source}
                                </small>
                              </Link>
                            ))}
                          </div>
                          <p className="anomaly-next">
                            <b>Human next step</b>
                            {anomaly.nextStep}
                          </p>
                          <footer>{anomaly.limitation}</footer>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="analytics-empty anomaly-empty">
                      No material rule-grounded anomaly is visible in the
                      selected period or current control snapshot. AIOS will
                      continue to evaluate the same cited signals.
                    </div>
                  )}
                </section>
              )}
              {organizationId && (
                <AnalyticsReportSchedule
                  organizationId={organizationId}
                  role={role}
                />
              )}
            </>
          )}

          {portfolio && (
            <section
              className="commercial-intelligence"
              aria-labelledby="commercial-heading"
            >
              <header className="management-heading">
                <div>
                  <p>COMMERCIAL CONTROL</p>
                  <h2 id="commercial-heading">
                    Profitability evidence and data quality
                  </h2>
                </div>
                <span>
                  Current quote versions only · Internal estimates · Never
                  presented as realized accounting profit
                </span>
              </header>
              <div className="commercial-grid">
                <article className="analytics-panel profitability-panel">
                  <header>
                    <div>
                      <p>OWNER · COMMERCIAL & FINANCE</p>
                      <h2>Current quote portfolio</h2>
                    </div>
                    <span>
                      {portfolio.profitability.costedQuotes} of{" "}
                      {portfolio.profitability.currentQuotes} current quotes
                      have matching cost evidence.
                    </span>
                  </header>
                  {portfolio.profitability.currencies.length ? (
                    <div className="analytics-table-wrap">
                      <table>
                        <caption>
                          Estimated quote profitability separated by currency
                        </caption>
                        <thead>
                          <tr>
                            <th>Currency</th>
                            <th>Costed quotes</th>
                            <th>Quoted revenue</th>
                            <th>Estimated cost</th>
                            <th>Gross margin</th>
                            <th>Margin %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {portfolio.profitability.currencies.map((row) => (
                            <tr key={row.currency}>
                              <td>
                                <b>{row.currency}</b>
                              </td>
                              <td>{row.costedQuotes}</td>
                              <td>
                                {currency(row.quotedRevenue, row.currency)}
                              </td>
                              <td>
                                {currency(row.estimatedCost, row.currency)}
                              </td>
                              <td>{currency(row.grossMargin, row.currency)}</td>
                              <td>{row.grossMarginPercent.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="analytics-empty compact">
                      Add an internal cost estimate to a current quote version
                      before AIOS shows portfolio margin.
                    </div>
                  )}
                  <footer className="portfolio-footer">
                    <span>
                      Missing cost:{" "}
                      <b>{portfolio.profitability.missingCostEstimate}</b>
                    </span>
                    <span>
                      Missing current version:{" "}
                      <b>{portfolio.profitability.missingCurrentVersion}</b>
                    </span>
                    <Link href="/quotes">Open quote evidence →</Link>
                  </footer>
                </article>

                <article className="analytics-panel quality-panel">
                  <header>
                    <div>
                      <p>OWNER · WORKFLOW LEADS</p>
                      <h2>Data quality watch</h2>
                    </div>
                    <span>
                      Counts are separate signals; one record may need more
                      than one correction.
                    </span>
                  </header>
                  <div className="quality-list">
                    <div>
                      <span>OPEN DEALS</span>
                      <b>
                        {portfolio.quality.incompleteDeals} /{" "}
                        {portfolio.quality.openDeals}
                      </b>
                      <p>missing one or more management fields</p>
                      <Link href="/?view=leads">Review lead pipeline →</Link>
                    </div>
                    <div>
                      <span>OWNERSHIP</span>
                      <b>{portfolio.quality.unassignedConversations}</b>
                      <p>open Inbox conversations without an owner</p>
                      <Link href="/inbox">Review Inbox →</Link>
                    </div>
                    <div>
                      <span>TRIP COSTS</span>
                      <b>{portfolio.quality.uncategorizedBookingCosts}</b>
                      <p>active-trip bookings without a cost amount</p>
                      <Link href="/trips">Review Trip Operations →</Link>
                    </div>
                    <div>
                      <span>SUPPLIER QUALITY</span>
                      <b>{portfolio.quality.unratedActiveSuppliers}</b>
                      <p>active suppliers without a quality rating</p>
                      <Link href="/finance">Review suppliers →</Link>
                    </div>
                  </div>
                  <details className="deal-quality-breakdown">
                    <summary>Incomplete deal field breakdown</summary>
                    <p>
                      Owner {portfolio.quality.missingDealOwner} · Value{" "}
                      {portfolio.quality.missingDealValue} · Destination{" "}
                      {portfolio.quality.missingDealDestination} · Next step{" "}
                      {portfolio.quality.missingDealNextStep} · Close date{" "}
                      {portfolio.quality.missingDealCloseDate}
                    </p>
                  </details>
                </article>
              </div>
            </section>
          )}

          {tripEconomics && (
            <section
              className="trip-economics"
              aria-labelledby="trip-economics-heading"
            >
              <header className="management-heading">
                <div>
                  <p>COMPLETED-TRIP ECONOMICS</p>
                  <h2 id="trip-economics-heading">
                    Reconcile margin only when the evidence closes
                  </h2>
                </div>
                <span>
                  Accepted current quote · Confirmed booking costs · Completed
                  trips only · Currency exact
                </span>
              </header>
              <div className="economics-summary">
                <article>
                  <span>COMPLETED TRIPS</span>
                  <b>{tripEconomics.summary.completedTrips}</b>
                  <p>eligible for evidence review</p>
                </article>
                <article>
                  <span>EVIDENCE READY</span>
                  <b>{tripEconomics.summary.evidenceReadyTrips}</b>
                  <p>included in currency-separated margin</p>
                </article>
                <article>
                  <span>COMMERCIAL GAPS</span>
                  <b>
                    {tripEconomics.summary.missingAcceptedQuote +
                      tripEconomics.summary.missingCurrentQuoteVersion +
                      tripEconomics.summary.unresolvedBookingEvidence +
                      tripEconomics.summary.missingConfirmedBookingCosts +
                      tripEconomics.summary.commercialCurrencyConflicts}
                  </b>
                  <p>trips excluded rather than estimated</p>
                </article>
                <article>
                  <span>LEDGER CONFLICTS</span>
                  <b>
                    {tripEconomics.summary.reconciliationCurrencyConflicts}
                  </b>
                  <p>payment rows excluded for currency or direction</p>
                </article>
              </div>
              {tripEconomics.currencies.length ? (
                <article className="analytics-panel economics-panel">
                  <header>
                    <div>
                      <p>OWNER · COMMERCIAL & FINANCE</p>
                      <h2>Completed-trip operating evidence</h2>
                    </div>
                    <span>
                      Quote value is contracted commercial evidence—not
                      accounting revenue recognition. Settled values are ledger
                      evidence, not bank reconciliation.
                    </span>
                  </header>
                  <div className="analytics-table-wrap">
                    <table>
                      <caption>
                        Completed-trip margin and obligation reconciliation by
                        currency
                      </caption>
                      <thead>
                        <tr>
                          <th>Currency</th>
                          <th>Trips</th>
                          <th>Accepted quote</th>
                          <th>Confirmed costs</th>
                          <th>Operating margin</th>
                          <th>Receivable / collected</th>
                          <th>Payable / settled</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tripEconomics.currencies.map((row) => (
                          <tr key={row.currency}>
                            <td>
                              <b>{row.currency}</b>
                            </td>
                            <td>{row.trips}</td>
                            <td>
                              {currency(row.contractedRevenue, row.currency)}
                              <span>
                                Net sell {currency(row.netSellRevenue, row.currency)}
                              </span>
                            </td>
                            <td>
                              {currency(
                                row.confirmedBookingCost,
                                row.currency,
                              )}
                            </td>
                            <td>
                              {currency(row.operatingMargin, row.currency)}
                              <span>
                                {row.operatingMarginPercent.toFixed(1)}%
                              </span>
                            </td>
                            <td>
                              {currency(row.customerReceivables, row.currency)}{" "}
                              /{" "}
                              {currency(row.customerCollected, row.currency)}
                              <span>
                                {row.receivableCoveragePercent === null
                                  ? "No accepted value"
                                  : `${row.receivableCoveragePercent.toFixed(1)}% recorded`}
                              </span>
                            </td>
                            <td>
                              {currency(row.supplierPayables, row.currency)} /{" "}
                              {currency(row.supplierSettled, row.currency)}
                              <span>
                                {row.payableCoveragePercent === null
                                  ? "No confirmed cost"
                                  : `${row.payableCoveragePercent.toFixed(1)}% recorded`}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ) : (
                <div className="analytics-empty economics-empty">
                  No completed trip has a fully accepted quote and confirmed,
                  same-currency booking cost evidence yet.
                </div>
              )}
              <details className="economics-gaps">
                <summary>Why completed trips are excluded</summary>
                <div>
                  <span>
                    Missing Accepted quote{" "}
                    <b>{tripEconomics.summary.missingAcceptedQuote}</b>
                  </span>
                  <span>
                    Missing current quote version{" "}
                    <b>{tripEconomics.summary.missingCurrentQuoteVersion}</b>
                  </span>
                  <span>
                    Draft / Requested bookings remain{" "}
                    <b>{tripEconomics.summary.unresolvedBookingEvidence}</b>
                  </span>
                  <span>
                    No complete Confirmed cost evidence{" "}
                    <b>{tripEconomics.summary.missingConfirmedBookingCosts}</b>
                  </span>
                  <span>
                    Commercial currency conflict{" "}
                    <b>{tripEconomics.summary.commercialCurrencyConflicts}</b>
                  </span>
                </div>
              </details>
              <footer className="economics-links">
                <Link href="/trips">Correct trip and booking evidence →</Link>
                <Link href="/finance">Reconcile obligation evidence →</Link>
              </footer>
            </section>
          )}

          <section
            className="growth-intelligence"
            aria-labelledby="growth-heading"
          >
            <header className="management-heading">
              <div>
                <p>FORWARD VIEW</p>
                <h2 id="growth-heading">Forecast and customer return</h2>
              </div>
              <label className="forecast-horizon">
                Forecast horizon
                <select
                  value={forecastHorizon}
                  onChange={(event) =>
                    setForecastHorizon(
                      Number(event.target.value) as ForecastHorizon,
                    )
                  }
                >
                  <option value={30}>Next 30 days</option>
                  <option value={90}>Next 90 days</option>
                  <option value={365}>Next 365 days</option>
                </select>
              </label>
            </header>
            <div className="growth-grid">
              <article className="analytics-panel forecast-panel">
                <header>
                  <div>
                    <p>OWNER · SALES LEADERSHIP</p>
                    <h2>Probability-weighted forecast</h2>
                  </div>
                  <span>
                    Expected close from today through{" "}
                    {new Date(
                      `${growth.forecast.horizonDate}T00:00:00.000Z`,
                    ).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                </header>
                {growth.forecast.currencies.length ? (
                  <div className="analytics-table-wrap">
                    <table>
                      <caption>
                        Open pipeline and weighted forecast by currency
                      </caption>
                      <thead>
                        <tr>
                          <th>Currency</th>
                          <th>Opportunities</th>
                          <th>Open value</th>
                          <th>Weighted forecast</th>
                        </tr>
                      </thead>
                      <tbody>
                        {growth.forecast.currencies.map((row) => (
                          <tr key={row.currency}>
                            <td>
                              <b>{row.currency}</b>
                            </td>
                            <td>{row.opportunities}</td>
                            <td>
                              {currency(row.pipelineValue, row.currency)}
                            </td>
                            <td>
                              {currency(row.weightedForecast, row.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="analytics-empty compact">
                    No complete open opportunities close inside this horizon.
                  </div>
                )}
                <footer className="forecast-footer">
                  <span>
                    Missing value / close date{" "}
                    <b>{growth.forecast.missingForecastInputs}</b>
                  </span>
                  <span>
                    Overdue close dates{" "}
                    <b>{growth.forecast.overdueCloseDates}</b>
                  </span>
                  <Link href="/?view=leads">Inspect forecast records →</Link>
                </footer>
                {targetCoverage.length ? (
                  <div className="coverage-boundary configured">
                    <span>PIPELINE COVERAGE</span>
                    <b>
                      {targetCoverage.length} approved{" "}
                      {targetCoverage.length === 1 ? "target" : "targets"}
                    </b>
                    <p>
                      Coverage below matches opportunities only to each
                      target&apos;s exact currency and close-date period.
                    </p>
                  </div>
                ) : (
                  <div className="coverage-boundary">
                    <span>PIPELINE COVERAGE</span>
                    <b>Target not configured</b>
                    <p>
                      AIOS will not infer a sales target. Coverage starts only
                      after leadership approves a currency and period target.
                    </p>
                  </div>
                )}
              </article>

              <article className="analytics-panel retention-panel">
                <header>
                  <div>
                    <p>OWNER · SALES & CUSTOMER SUCCESS</p>
                    <h2>Repeat-customer evidence</h2>
                  </div>
                </header>
                <div className="retention-primary">
                  <b>
                    {growth.retention.repeatCustomerRate === null
                      ? "—"
                      : `${Math.round(growth.retention.repeatCustomerRate)}%`}
                  </b>
                  <span>won customers who returned</span>
                </div>
                <dl>
                  <div>
                    <dt>Customers with a win</dt>
                    <dd>{growth.retention.wonCustomers}</dd>
                  </div>
                  <div>
                    <dt>Customers with 2+ wins</dt>
                    <dd>{growth.retention.repeatCustomers}</dd>
                  </div>
                  <div>
                    <dt>Wins after the first</dt>
                    <dd>{growth.retention.repeatWins}</dd>
                  </div>
                </dl>
                <p className="retention-definition">
                  A returning customer has at least two Won opportunities linked
                  to the same contact. Open proposals and unlinked wins do not
                  count.
                </p>
                <Link href="/contacts">Open customer records →</Link>
              </article>
            </div>
            <article className="analytics-panel cohort-panel">
              <header>
                <div>
                  <p>OWNER · CUSTOMER SUCCESS</p>
                  <h2>First-win retention cohorts</h2>
                </div>
                <span>
                  Each customer belongs to the quarter of their first Won
                  opportunity. A window counts only after that customer has had
                  the full 90, 180, or 365 days to return.
                </span>
              </header>
              {retentionCohorts.cohorts.length ? (
                <div className="analytics-table-wrap">
                  <table>
                    <caption>
                      Customers returning after their first Won opportunity
                    </caption>
                    <thead>
                      <tr>
                        <th>First-win cohort</th>
                        <th>Customers</th>
                        <th>Returned ≤ 90 days</th>
                        <th>Returned ≤ 180 days</th>
                        <th>Returned ≤ 365 days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retentionCohorts.cohorts.map((cohort) => (
                        <tr key={cohort.cohortStart}>
                          <td>
                            <b>{cohort.cohort}</b>
                            <span>{cohort.cohortStart}</span>
                          </td>
                          <td>{cohort.customers}</td>
                          <td>
                            {cohortWindowLabel(cohort.within90Days)}
                          </td>
                          <td>
                            {cohortWindowLabel(cohort.within180Days)}
                          </td>
                          <td>
                            {cohortWindowLabel(cohort.within365Days)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="analytics-empty compact">
                  Cohorts begin after Won opportunities have a linked contact
                  and a valid win timestamp.
                </div>
              )}
              <footer className="cohort-quality">
                <span>
                  Timed customers{" "}
                  <b>{retentionCohorts.summary.timedCustomers}</b>
                </span>
                <span>
                  Unlinked wins <b>{retentionCohorts.summary.unlinkedWins}</b>
                </span>
                <span>
                  Missing / invalid win time{" "}
                  <b>
                    {retentionCohorts.summary.missingOrInvalidWinTime}
                  </b>
                </span>
                <span>
                  Future win time excluded{" "}
                  <b>{retentionCohorts.summary.futureWinTime}</b>
                </span>
                <Link href="/contacts">Review customer evidence →</Link>
              </footer>
            </article>
            <article className="analytics-panel target-coverage-panel">
              <header>
                <div>
                  <p>OWNER · OWNER / ADMIN</p>
                  <h2>Approved pipeline coverage</h2>
                </div>
                <span>
                  Targets are auditable management inputs. Retiring a target
                  removes it from active coverage without deleting history.
                </span>
              </header>
              {targetCoverage.length ? (
                <div className="analytics-table-wrap">
                  <table>
                    <caption>
                      Active sales targets and matching open pipeline
                    </caption>
                    <thead>
                      <tr>
                        <th>Target</th>
                        <th>Period</th>
                        <th>Target amount</th>
                        <th>Open pipeline</th>
                        <th>Pipeline coverage</th>
                        <th>Weighted coverage</th>
                        {canConfigureTargets && <th>Control</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {targetCoverage.map((target) => (
                        <tr key={target.id}>
                          <td>
                            <b>{target.label}</b>
                            <span>{target.currency}</span>
                          </td>
                          <td>
                            {target.period_start} → {target.period_end}
                          </td>
                          <td>
                            {currency(target.target_amount, target.currency)}
                          </td>
                          <td>
                            {currency(target.pipelineValue, target.currency)}
                            <span>
                              {target.opportunities}{" "}
                              {target.opportunities === 1
                                ? "opportunity"
                                : "opportunities"}
                            </span>
                          </td>
                          <td>
                            {target.pipelineCoveragePercent === null
                              ? "—"
                              : `${target.pipelineCoveragePercent.toFixed(1)}%`}
                          </td>
                          <td>
                            {target.weightedCoveragePercent === null
                              ? "—"
                              : `${target.weightedCoveragePercent.toFixed(1)}%`}
                          </td>
                          {canConfigureTargets && (
                            <td>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => retireAnalyticsTarget(target)}
                              >
                                Retire
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="analytics-empty compact">
                  No active approved targets. Forecasts remain visible, but
                  AIOS will not calculate target coverage.
                </div>
              )}
              {canConfigureTargets ? (
                <form
                  className="target-form"
                  onSubmit={submitAnalyticsTarget}
                >
                  <label>
                    Target name
                    <input
                      name="label"
                      minLength={3}
                      maxLength={80}
                      placeholder="Q4 INR sales"
                      required
                    />
                  </label>
                  <label>
                    Currency
                    <input
                      name="currency"
                      minLength={3}
                      maxLength={3}
                      pattern="[A-Za-z]{3}"
                      placeholder="INR"
                      required
                    />
                  </label>
                  <label>
                    Period start
                    <input name="periodStart" type="date" required />
                  </label>
                  <label>
                    Period end
                    <input name="periodEnd" type="date" required />
                  </label>
                  <label>
                    Approved target
                    <input
                      name="targetAmount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                    />
                  </label>
                  <button type="submit" disabled={pending}>
                    {pending ? "Saving…" : "Add approved target"}
                  </button>
                </form>
              ) : (
                <p className="target-permission">
                  Only workspace owners and admins can approve or retire sales
                  targets.
                </p>
              )}
            </article>
          </section>

          <section className="sales-section-heading">
            <div>
              <p>SALES INTELLIGENCE</p>
              <h2>Acquisition and pipeline performance</h2>
            </div>
            <span>
              The controls below apply only to sales metrics, not the live
              management pulse above.
            </span>
          </section>
          <section className="analytics-controls">
            <label>
              Acquisition window
              <select value={range} onChange={(event) => setRange(event.target.value as AnalyticsRange)}>
                {ranges.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select value={source} onChange={(event) => setSource(event.target.value)}>
                <option value="all">All sources</option>
                {sources.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                <option value="all">All owners</option>
                <option value="unassigned">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <SavedViewControls
              areaLabel="Analytics"
              disabled={pending || !organizationId}
              selectedId={selectedSavedViewId}
              views={savedViews}
              onSelect={selectSavedView}
              onSave={saveCurrentView}
              onRemove={removeSavedView}
            />
          </section>
          <section className="analytics-kpis">
            <article>
              <p>LEAD → WON</p>
              <b>
                {filteredDeals.length
                  ? `${((won.length / filteredDeals.length) * 100).toFixed(1)}%`
                  : "—"}
              </b>
              <span>{won.length} won from {filteredDeals.length} acquired</span>
            </article>
            <article>
              <p>OPEN PIPELINE</p>
              <b>
                {currencies.length === 1
                  ? currency(pipelineValue, currencies[0])
                  : currencies.length
                    ? "Mixed"
                    : "—"}
              </b>
              <span>{open.length} active opportunities</span>
            </article>
            <article>
              <p>FIRST RESPONSE SLA</p>
              <b>
                {responded.length
                  ? `${Math.round((withinSla / responded.length) * 100)}%`
                  : "—"}
              </b>
              <span>{withinSla} of {responded.length} measured on time</span>
            </article>
            <article>
              <p>AVERAGE TIME TO WIN</p>
              <b>
                {averageCloseMs === null
                  ? "—"
                  : `${(averageCloseMs / 86_400_000).toFixed(1)}d`}
              </b>
              <span>From captured lead to won</span>
            </article>
          </section>
          <section className="analytics-grid">
            <article className="analytics-panel source-performance">
              <header>
                <div>
                  <p>ACQUISITION QUALITY</p>
                  <h2>Source performance</h2>
                </div>
                <span>Pipeline is never summed across currencies.</span>
              </header>
              {sourceRows.length ? (
                <div className="analytics-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Leads</th>
                        <th>Won</th>
                        <th>Conversion</th>
                        <th>Open pipeline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceRows.map((row) => (
                        <tr key={row.source}>
                          <td>
                            <b>{row.source}</b>
                            <span className="source-bar">
                              <i style={{ width: `${(row.leads / maxSourceLeads) * 100}%` }} />
                            </span>
                          </td>
                          <td>{row.leads}</td>
                          <td>{row.won}</td>
                          <td>{row.conversion.toFixed(1)}%</td>
                          <td>
                            {row.currency
                              ? currency(row.pipeline, row.currency)
                              : "Mixed currencies"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="analytics-empty">No leads match this view.</div>
              )}
            </article>
            <article className="analytics-panel velocity">
              <header>
                <div>
                  <p>PROCESS VELOCITY</p>
                  <h2>Average time in stage</h2>
                </div>
              </header>
              <div className="velocity-list">
                {stageRows.map((row, index) => (
                  <div key={row.stage}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <p>
                      <b>{row.stage}</b>
                      {row.transitions} measured transitions
                    </p>
                    <strong>
                      {row.seconds === null ? "Collecting" : compactDuration(row.seconds)}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
