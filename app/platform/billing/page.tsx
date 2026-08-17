import { getPlatformCommercialOverview } from "../../actions/platform-billing";
import { PlatformBillingControl } from "../../../components/platform/platform-billing-control";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";

export default async function PlatformBillingPage() {
  const overview = await getPlatformCommercialOverview();
  const activePlans = overview.plans.filter((plan) => plan.status === "active").length;
  const subscribedAgencies = overview.agencies.filter((agency) => agency.subscription).length;
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader
        section="Platform administration"
        title="Plans & billing"
        meta={`${activePlans} active plans · ${subscribedAgencies} subscribed agencies`}
      />
      <div className="platform-content">
        <section className="platform-boundary" role="note">
          <strong>Product authority, separated from payment processing</strong>
          <p>
            Versioned plans and entitlement snapshots are AIOS&apos;s authorization source. Stripe or Razorpay webhooks remain disabled until the provider-backed billing release is approved.
          </p>
        </section>
        <PlatformBillingControl initial={overview} />
      </div>
    </main>
  );
}
