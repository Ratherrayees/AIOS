"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { createSavedView, deleteSavedView } from "../actions/crm";
import { LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { SavedViewControls } from "../../components/ui/saved-view-controls";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import type { Json } from "../../types/database";
import "./analytics.css";

type AnalyticsRange = "30d" | "90d" | "365d" | "all";
type Deal = {
  id: string;
  owner_id: string | null;
  source: string | null;
  source_campaign: string | null;
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
  return {
    range: range as AnalyticsRange,
    source: typeof filters.source === "string" ? filters.source : "all",
    ownerId: typeof filters.ownerId === "string" ? filters.ownerId : "all",
  };
}

export default function AnalyticsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [range, setRange] = useState<AnalyticsRange>("90d");
  const [source, setSource] = useState("all");
  const [ownerId, setOwnerId] = useState("all");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterTimestamp, setFilterTimestamp] = useState(0);
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
      const [
        { data: dealRows, error: dealError },
        { data: historyRows, error: historyError },
        { data: memberRows },
        { data: savedViewRows },
      ] = await Promise.all([
        supabase
          .from("deals")
          .select(
            "id, owner_id, source, source_campaign, stage, value_amount, currency, probability, created_at, qualified_at, first_response_due_at, first_responded_at, won_at, lost_at",
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
      ]);
      if (dealError || historyError) throw dealError || historyError;
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
  }

  function saveCurrentView(name: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const saved = await createSavedView({
          organizationId,
          feature: "analytics",
          name,
          filters: { range, source, ownerId },
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
          <p>REVENUE INTELLIGENCE</p>
          <h1>See where momentum becomes revenue.</h1>
          <span>
            Source quality, response discipline, conversion, and stage velocity
            in one tenant-safe operating view.
          </span>
        </div>
        <div className="analytics-signal">
          <small>LIVE SIGNAL</small>
          <b>{filteredDeals.length}</b>
          <span>LEADS IN VIEW</span>
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
