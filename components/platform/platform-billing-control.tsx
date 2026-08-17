"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  changePlatformPlanStatus,
  createPlatformPlan,
  getPlatformCommercialOverview,
  setPlatformAgencySubscription,
} from "../../app/actions/platform-billing";
import { Button } from "../ui/button";
import { EmptyState, PermissionNotice } from "../ui/empty-state";

type CommercialOverview = Awaited<ReturnType<typeof getPlatformCommercialOverview>>;
type PlatformPlan = CommercialOverview["plans"][number];

function currencyLabel(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amountMinor / 100);
}

function dateInputValue(offsetDays: number) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1_000);
  return date.toISOString().slice(0, 10);
}

function PlanStatusControl({ plan, enabled }: { plan: PlatformPlan; enabled: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  if (plan.status === "retired") return null;
  const nextStatus = plan.status === "draft" ? "active" : "retired";
  const expectedConfirmation = `${plan.plan_code}@${plan.version}`;
  return (
    <form
      className="platform-plan-status-form"
      onSubmit={(event) => {
        event.preventDefault();
        setFeedback("");
        startTransition(async () => {
          try {
            await changePlatformPlanStatus({
              planId: plan.id,
              status: nextStatus,
              confirmation,
              expectedConfirmation,
              reason,
            });
            router.refresh();
          } catch (error) {
            setFeedback(error instanceof Error ? error.message : "Plan status could not be changed.");
          }
        });
      }}
    >
      <input aria-label={`Reason to ${nextStatus} ${plan.name}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={`Reason to ${nextStatus} this version`} minLength={12} maxLength={500} required />
      <input aria-label={`Confirmation for ${plan.name}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={`Type ${expectedConfirmation}`} required />
      <Button size="small" type="submit" variant={nextStatus === "retired" ? "secondary" : "primary"} disabled={!enabled || pending}>
        {pending ? "Saving…" : nextStatus === "active" ? "Activate version" : "Retire version"}
      </Button>
      {feedback ? <p className="platform-form-error" role="alert">{feedback}</p> : null}
    </form>
  );
}

export function PlatformBillingControl({ initial }: { initial: CommercialOverview }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const activePlans = initial.plans.filter((plan) => plan.status === "active");
  const mutationEnabled = initial.canManageBilling && initial.mfaVerified;

  function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await createPlatformPlan({
          planCode: String(form.get("planCode")),
          name: String(form.get("name")),
          description: String(form.get("description")),
          currency: String(form.get("currency")),
          interval: String(form.get("interval")) as "month" | "year",
          amountMinor: Math.round(Number(form.get("amount")) * 100),
          userLimit: Number(form.get("userLimit")),
          monthlyAiRuns: Number(form.get("monthlyAiRuns")),
          storageGb: Number(form.get("storageGb")),
          assistedAi: form.get("assistedAi") === "on",
          autopilotAi: form.get("autopilotAi") === "on",
          emailAutomation: form.get("emailAutomation") === "on",
          whatsappAutomation: form.get("whatsappAutomation") === "on",
          analyticsExports: form.get("analyticsExports") === "on",
          reason: String(form.get("reason")),
        });
        setFeedback({ tone: "success", message: `Plan version ${result.version} was created as a draft.` });
        router.refresh();
      } catch (error) {
        setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Plan could not be created." });
      }
    });
  }

  function submitSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const organizationId = String(form.get("organizationId"));
    const agency = initial.agencies.find((item) => item.id === organizationId);
    if (!agency) return;
    const valueOrNull = (name: string) => String(form.get(name) || "").trim() || null;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await setPlatformAgencySubscription({
          organizationId,
          planId: String(form.get("planId")),
          status: String(form.get("status")) as "trialing" | "active" | "past_due" | "grace" | "canceled",
          trialEndsAt: valueOrNull("trialEndsAt"),
          periodStart: valueOrNull("periodStart"),
          periodEnd: valueOrNull("periodEnd"),
          graceEndsAt: valueOrNull("graceEndsAt"),
          cancelAtPeriodEnd: form.get("cancelAtPeriodEnd") === "on",
          expectedVersion: agency.subscription?.version ?? null,
          confirmation: String(form.get("confirmation")),
          reason: String(form.get("reason")),
        });
        setFeedback({ tone: "success", message: `Agency subscription is now ${result.status} at version ${result.version}.` });
        router.refresh();
      } catch (error) {
        setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Subscription could not be changed." });
      }
    });
  }

  return (
    <div className="platform-billing-stack">
      {!initial.canManageBilling ? (
        <PermissionNotice contained title="Commercial controls are read-only" description="Platform admins can review plans and agency subscription state. Only an MFA-verified superadmin can create plans or change entitlements and subscriptions." />
      ) : !initial.mfaVerified ? (
        <PermissionNotice contained title="MFA required for commercial changes" description="Verify MFA in the platform sign-in session before creating a plan or changing an agency subscription." />
      ) : null}
      {feedback ? <p className={`platform-billing-feedback is-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</p> : null}

      <section className="platform-commercial-panel">
        <header><div><p>PRODUCT CATALOG</p><h2>Versioned plans</h2></div><span>{initial.plans.length} versions</span></header>
        {initial.plans.length === 0 ? (
          <EmptyState compact title="No plans yet" description="Create the first immutable plan version before assigning agency access." />
        ) : (
          <div className="platform-plan-grid">
            {initial.plans.map((plan) => (
              <article key={plan.id}>
                <header><div><b>{plan.name}</b><small>{plan.plan_code}@{plan.version}</small></div><span className={`platform-status-badge is-${plan.status}`}>{plan.status}</span></header>
                <p>{plan.description}</p>
                <div className="platform-plan-price">
                  {plan.prices.map((price) => <b key={`${price.currency}-${price.interval}`}>{currencyLabel(price.amount_minor, price.currency)}<small>/{price.interval}</small></b>)}
                </div>
                <dl>
                  {plan.entitlements.map((entitlement) => <div key={entitlement.entitlement_key}><dt>{entitlement.entitlement_key}</dt><dd>{entitlement.integer_value ?? (entitlement.boolean_value ? "Included" : "Not included")}</dd></div>)}
                </dl>
                <PlanStatusControl plan={plan} enabled={mutationEnabled} />
              </article>
            ))}
          </div>
        )}
        {initial.canManageBilling ? (
          <details className="platform-commercial-form" open={initial.plans.length === 0}>
            <summary>Create a plan version</summary>
            <form onSubmit={submitPlan}>
              <label>Plan code<input name="planCode" placeholder="growth" pattern="[a-z0-9]+(?:_[a-z0-9]+)*" required /></label>
              <label>Display name<input name="name" placeholder="Growth" required /></label>
              <label className="is-wide">Description<textarea name="description" placeholder="For growing agencies that need governed automation." minLength={12} required /></label>
              <label>Currency<input name="currency" defaultValue="INR" minLength={3} maxLength={3} required /></label>
              <label>Billing interval<select name="interval" defaultValue="month"><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
              <label>Price<input name="amount" type="number" min="0" step="0.01" defaultValue="0" required /></label>
              <label>User limit<input name="userLimit" type="number" min="1" defaultValue="10" required /></label>
              <label>AI runs / month<input name="monthlyAiRuns" type="number" min="0" defaultValue="1000" required /></label>
              <label>Storage (GB)<input name="storageGb" type="number" min="0" defaultValue="10" required /></label>
              <fieldset className="is-wide"><legend>Included capabilities</legend><label><input type="checkbox" name="assistedAi" defaultChecked /> Assisted AI</label><label><input type="checkbox" name="autopilotAi" /> Autopilot</label><label><input type="checkbox" name="emailAutomation" defaultChecked /> Email automation</label><label><input type="checkbox" name="whatsappAutomation" /> WhatsApp automation</label><label><input type="checkbox" name="analyticsExports" defaultChecked /> Analytics exports</label></fieldset>
              <label className="is-wide">Creation reason<textarea name="reason" minLength={12} placeholder="Why this product version is being introduced" required /></label>
              <Button type="submit" disabled={!mutationEnabled || pending}>{pending ? "Creating…" : "Create draft version"}</Button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="platform-commercial-panel">
        <header><div><p>AGENCY ACCESS</p><h2>Subscriptions</h2></div><span>{initial.agencies.filter((agency) => agency.subscription).length} assigned</span></header>
        <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Agency</th><th>Lifecycle</th><th>Plan</th><th>Subscription</th><th>Version</th><th>Period end</th></tr></thead><tbody>{initial.agencies.map((agency) => { const plan = initial.plans.find((item) => item.id === agency.subscription?.plan_id); return <tr key={agency.id}><td><b>{agency.name}</b><small>{agency.slug}</small></td><td><span className={`platform-status-badge is-${agency.lifecycleStatus}`}>{agency.lifecycleStatus}</span></td><td>{plan ? `${plan.name} v${plan.version}` : "Unassigned"}</td><td>{agency.subscription ? <span className={`platform-status-badge is-${agency.subscription.status}`}>{agency.subscription.status}</span> : "—"}</td><td>{agency.subscription?.version ?? "—"}</td><td>{agency.subscription?.current_period_end ? new Date(agency.subscription.current_period_end).toLocaleDateString("en-IN") : "—"}</td></tr>; })}</tbody></table></div>
        {initial.canManageBilling ? (
          <details className="platform-commercial-form">
            <summary>Assign or change a subscription</summary>
            {activePlans.length === 0 ? <p className="platform-impact-note">Activate a plan version before assigning it.</p> : (
              <form onSubmit={submitSubscription}>
                <label>Agency<select name="organizationId" required>{initial.agencies.map((agency) => <option value={agency.id} key={agency.id}>{agency.name} ({agency.slug})</option>)}</select></label>
                <label>Active plan<select name="planId" required>{activePlans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · v{plan.version}</option>)}</select></label>
                <label>Status<select name="status" defaultValue="active"><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="grace">Grace</option><option value="canceled">Canceled</option></select></label>
                <label>Trial end<input name="trialEndsAt" type="date" defaultValue={dateInputValue(14)} /></label>
                <label>Period start<input name="periodStart" type="date" defaultValue={dateInputValue(0)} /></label>
                <label>Period end<input name="periodEnd" type="date" defaultValue={dateInputValue(30)} /></label>
                <label>Grace end<input name="graceEndsAt" type="date" defaultValue={dateInputValue(7)} /></label>
                <label className="platform-check-label"><input type="checkbox" name="cancelAtPeriodEnd" /> Cancel at period end</label>
                <label className="is-wide">Reason<textarea name="reason" minLength={12} placeholder="Commercial reason for this subscription change" required /></label>
                <label className="is-wide">Agency slug confirmation<input name="confirmation" placeholder="Type the selected agency slug" required /></label>
                <Button type="submit" disabled={!mutationEnabled || pending}>{pending ? "Saving…" : "Save subscription"}</Button>
              </form>
            )}
          </details>
        ) : null}
      </section>
    </div>
  );
}
