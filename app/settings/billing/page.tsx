"use client";

import { useEffect, useState } from "react";

import { getCurrentAgencyBillingSummary } from "../../actions/billing";
import { EmptyState, ErrorState, LoadingState } from "../../../components/ui/empty-state";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";
import { SettingsNavigation } from "../../../components/ui/settings-navigation";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../lib/supabase/workspace-context";
import "./billing.css";

type BillingSummary = Awaited<ReturnType<typeof getCurrentAgencyBillingSummary>>;
type Price = { amountMinor: number; currency: string; interval: "month" | "year" };

const entitlementLabels: Record<string, string> = {
  "users.max": "Team members",
  "ai.runs.monthly": "AI runs per month",
  "storage.gb": "Storage",
  "ai.assisted": "Assisted AI",
  "ai.autopilot": "AIOS Autopilot",
  "automation.email": "Email automation",
  "automation.whatsapp": "WhatsApp automation",
  "analytics.exports": "Analytics exports",
};

function formatDate(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

function prices(value: unknown): Price[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Price => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.amountMinor === "number" && typeof row.currency === "string" && (row.interval === "month" || row.interval === "year");
  });
}

function entitlements(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, boolean | number>);
}

export default function BillingSettingsPage() {
  const [workspaceName, setWorkspaceName] = useState("Travel workspace");
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const { active } = await loadWorkspaceContext(supabase);
      if (!active) throw new Error("Choose an agency workspace to review its plan.");
      setWorkspaceName(active.name);
      setSummary(await getCurrentAgencyBillingSummary({ organizationId: active.organization_id }));
    })()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Billing details could not be loaded."))
      .finally(() => setLoading(false));
  }, [reload]);

  const planPrices = prices(summary?.prices);
  const planEntitlements = entitlements(summary?.entitlements);

  return (
    <main className="crm-workspace billing-settings-page" id="main-content" tabIndex={-1}>
      <SettingsNavigation />
      <OperationalPageHeader
        section="Administration"
        title="Plan & billing"
        meta={workspaceName}
      />
      <div className="billing-settings-content">
        {loading ? (
          <LoadingState label="Loading plan and entitlements" rows={4} />
        ) : error ? (
          <ErrorState title="Plan details unavailable" description={error} onRetry={() => { setError(""); setLoading(true); setReload((value) => value + 1); }} />
        ) : !summary ? (
          <EmptyState title="No plan assigned" description="Your agency does not have an active platform plan yet. Ask your AIOS platform operator to assign one." />
        ) : (
          <>
            <section className="billing-plan-summary">
              <header>
                <div><p>CURRENT PLAN</p><h2>{summary.plan_name}</h2><small>{summary.plan_code} · version {summary.plan_version}</small></div>
                <span className={`billing-status is-${summary.subscription_status}`}>{summary.subscription_status.replace("_", " ")}</span>
              </header>
              <div className="billing-plan-metrics">
                <article><span>Plan price</span>{planPrices.length ? planPrices.map((price) => <b key={`${price.currency}-${price.interval}`}>{new Intl.NumberFormat("en-IN", { style: "currency", currency: price.currency }).format(price.amountMinor / 100)}<small>/{price.interval}</small></b>) : <b>Custom</b>}</article>
                <article><span>Current period ends</span><b>{formatDate(summary.current_period_end)}</b></article>
                <article><span>Trial ends</span><b>{formatDate(summary.trial_ends_at)}</b></article>
                <article><span>Cancellation</span><b>{summary.cancel_at_period_end ? "At period end" : "Not scheduled"}</b></article>
              </div>
              {summary.subscription_status === "grace" ? <p className="billing-plan-alert">Access is in a grace period until {formatDate(summary.grace_ends_at)}. Contact your platform operator before the grace period ends.</p> : null}
              {summary.subscription_status === "past_due" ? <p className="billing-plan-alert">This subscription is past due. AIOS keeps the status visible while the platform operator resolves billing.</p> : null}
            </section>
            <section className="billing-entitlements">
              <header><div><p>PLAN ACCESS</p><h2>Included capabilities</h2></div><small>Snapshot v{summary.subscription_version}</small></header>
              <div>{planEntitlements.map(([key, value]) => <article key={key}><span>{entitlementLabels[key] ?? key}</span><b>{typeof value === "boolean" ? (value ? "Included" : "Not included") : key === "storage.gb" ? `${value} GB` : new Intl.NumberFormat("en-IN").format(value)}</b></article>)}</div>
            </section>
            <section className="billing-provider-note" role="note">
              <strong>Provider-backed billing is not enabled yet</strong>
              <p>AIOS currently records platform-managed subscription state. Self-service checkout, invoices, card changes, and Stripe/Razorpay webhook reconciliation remain release-gated.</p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
