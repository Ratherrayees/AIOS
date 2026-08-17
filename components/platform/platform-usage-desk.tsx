"use client";

import { useState, useTransition } from "react";

import { getPlatformUsageOverview } from "../../app/actions/platform-usage";
import { Button } from "../ui/button";
import { EmptyState, ErrorState, LoadingState } from "../ui/empty-state";

type UsageOverview = Awaited<ReturnType<typeof getPlatformUsageOverview>>;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function compact(value: number) {
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function limitLabel(value: number, limit: number | null, suffix = "") {
  return limit === null ? `${compact(value)}${suffix}` : `${compact(value)} / ${compact(limit)}${suffix}`;
}

function costLabel(costs: Record<string, number>) {
  const entries = Object.entries(costs);
  if (!entries.length) return "—";
  return entries.map(([currency, amount]) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 4 }).format(amount)).join(" · ");
}

export function PlatformUsageDesk({ initial }: { initial: UsageOverview }) {
  const [overview, setOverview] = useState(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function load(days: 30 | 90 | 365) {
    setError("");
    startTransition(async () => {
      try {
        setOverview(await getPlatformUsageOverview({ days }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Usage could not be refreshed.");
      }
    });
  }

  return (
    <div className="platform-usage-stack">
      <section className="platform-usage-summary" aria-label="Portfolio usage summary">
        <article><span>ACTIVE USERS</span><b>{compact(overview.totals.activeUsers)}</b><small>Current memberships</small></article>
        <article><span>AI RUNS</span><b>{compact(overview.totals.aiRuns)}</b><small>Last {overview.days} days</small></article>
        <article><span>PRIVATE STORAGE</span><b>{formatBytes(overview.totals.storageBytes)}</b><small>Current document metadata</small></article>
        <article className={overview.totals.attentionAgencies ? "has-attention" : ""}><span>NEEDS REVIEW</span><b>{overview.totals.attentionAgencies}</b><small>{overview.totals.failedAiJobs} failed/dead-letter jobs</small></article>
      </section>
      <section className="platform-commercial-panel">
        <header>
          <div><p>AGENCY USAGE</p><h2>Resource snapshot</h2></div>
          <div className="platform-usage-window" aria-label="Usage window">{([30, 90, 365] as const).map((days) => <Button key={days} type="button" size="small" variant={overview.days === days ? "primary" : "secondary"} disabled={pending} onClick={() => load(days)}>{days === 365 ? "1 year" : `${days} days`}</Button>)}</div>
        </header>
        {error ? <ErrorState title="Usage unavailable" description={error} onRetry={() => load(overview.days)} /> : pending ? <LoadingState label="Refreshing aggregate usage" rows={5} /> : overview.agencies.length === 0 ? <EmptyState title="No agencies" description="Usage will appear after the first agency is provisioned." /> : (
          <div className="platform-table-wrap"><table className="platform-table platform-usage-table"><thead><tr><th>Agency</th><th>Plan</th><th>Users</th><th>AI runs / tokens</th><th>AI cost</th><th>Storage</th><th>Email in / out</th><th>Jobs</th></tr></thead><tbody>{overview.agencies.map((agency) => <tr key={agency.id} className={Object.values(agency.attention).some(Boolean) ? "has-attention" : ""}><td><b>{agency.name}</b><small>{agency.slug} · {agency.lifecycleStatus}</small></td><td>{agency.plan ?? "Unassigned"}<small>{agency.subscriptionStatus ?? "No subscription"}</small></td><td className={agency.attention.users ? "usage-over" : ""}>{limitLabel(agency.activeUsers, agency.limits.users)}</td><td className={agency.attention.aiRuns ? "usage-over" : ""}>{limitLabel(agency.aiRuns, overview.days === 30 ? agency.limits.monthlyAiRuns : null)}<small>{compact(agency.inputTokens)} in · {compact(agency.outputTokens)} out</small></td><td>{costLabel(agency.aiCosts)}</td><td className={agency.attention.storage ? "usage-over" : ""}>{formatBytes(agency.storageBytes)}<small>{agency.limits.storageGb === null ? "No assigned limit" : `${agency.limits.storageGb} GB plan limit`}</small></td><td>{agency.inboundEmails} / {agency.outboundEmails}</td><td className={agency.attention.failedJobs ? "usage-over" : ""}>{agency.queuedAiJobs} queued<small>{agency.failedAiJobs} failed · {agency.managementReports} reports</small></td></tr>)}</tbody></table></div>
        )}
        <footer className="platform-usage-footnote"><span>Generated {new Date(overview.generatedAt).toLocaleString("en-IN")}</span><span>Operational snapshot—not an invoice or automatic enforcement event.</span></footer>
      </section>
    </div>
  );
}
