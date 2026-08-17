import Link from "next/link";

import { getPlatformOverview } from "../actions/platform";
import { OperationalPageHeader } from "../../components/ui/operational-page-header";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default async function PlatformOverviewPage() {
  const overview = await getPlatformOverview();
  const activePlatformEmail = overview.integrations.find(
    (integration) => integration.isEnabled,
  );
  const openAttention =
    overview.failedAiJobCount +
    overview.tenantIntegrationAttentionCount +
    overview.failedInboundEmailCount +
    overview.failedOutboundEmailCount;

  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader
        section="Platform administration"
        title="Overview"
        meta={`${overview.agencyCount} agencies · ${overview.activeOperatorCount} platform operators`}
      />
      <div className="platform-content">
        {!overview.mfaVerified ? (
          <section className="platform-warning platform-action-warning" role="alert">
            <div>
              <strong>Multi-factor verification is required for platform changes</strong>
              <p>You may review health and tenant metadata now. Verify an authenticator before changing access or service configuration.</p>
            </div>
            <Link href="/account/security?next=%2Fplatform">Verify account security</Link>
          </section>
        ) : null}

        <section className="platform-metrics platform-metrics-four" aria-label="Platform status">
          <article>
            <span>AGENCIES</span>
            <b>{overview.agencyCount}</b>
            <small>{overview.agenciesCreatedLast30Days} created in the last 30 days</small>
          </article>
          <article>
            <span>ACTIVE PEOPLE</span>
            <b>{overview.activeMembershipCount}</b>
            <small>Active tenant memberships, not unique identities</small>
          </article>
          <article className={openAttention > 0 ? "metric-attention" : ""}>
            <span>PLATFORM ATTENTION</span>
            <b>{openAttention}</b>
            <small>Failed jobs, email events, or provider checks</small>
          </article>
          <article>
            <span>PENDING HUMAN GATES</span>
            <b>{overview.pendingApprovalCount}</b>
            <small>Aggregate only; decisions stay inside each agency</small>
          </article>
        </section>

        <section className="platform-overview-grid">
          <article className="platform-panel platform-panel-stack">
            <header>
              <div>
                <p>PLATFORM SERVICES</p>
                <h2>Release readiness</h2>
              </div>
              <Link href="/platform/system">Open system health</Link>
            </header>
            <div className="platform-readiness-list">
              {overview.systemReadiness.map((item) => (
                <div key={item.key}>
                  <span className={item.ready ? "is-ready" : "needs-setup"} aria-hidden="true" />
                  <span>
                    <b>{item.label}</b>
                    <small>{item.guidance}</small>
                  </span>
                  <em>{item.ready ? "Ready" : "Setup required"}</em>
                </div>
              ))}
            </div>
          </article>

          <article className="platform-panel platform-panel-stack">
            <header>
              <div>
                <p>PLATFORM-OWNED EMAIL</p>
                <h2>{activePlatformEmail ? "Sender active" : "Sender not active"}</h2>
              </div>
              <Link href="/platform/email">Manage email</Link>
            </header>
            <dl className="platform-fact-list">
              <div><dt>Sender</dt><dd>{overview.platformEmail}</dd></div>
              <div><dt>Provider</dt><dd>{activePlatformEmail?.provider.replace("_", " ") || "None"}</dd></div>
              <div><dt>Credential vault</dt><dd>{overview.vaultConfigured ? "Ready" : "Setup required"}</dd></div>
              <div><dt>Delivery failures</dt><dd>{overview.failedOutboundEmailCount}</dd></div>
            </dl>
          </article>
        </section>

        <section className="platform-overview-grid">
          <article className="platform-panel platform-panel-stack">
            <header>
              <div>
                <p>TENANT SERVICE HEALTH</p>
                <h2>Agency infrastructure</h2>
              </div>
              <Link href="/platform/agencies">Review agencies</Link>
            </header>
            <dl className="platform-fact-list">
              <div><dt>Configured integrations</dt><dd>{overview.tenantIntegrationCount}</dd></div>
              <div><dt>Enabled integrations</dt><dd>{overview.enabledTenantIntegrationCount}</dd></div>
              <div><dt>Provider failures</dt><dd>{overview.tenantIntegrationAttentionCount}</dd></div>
              <div><dt>AI jobs needing attention</dt><dd>{overview.queuedAiJobCount}</dd></div>
            </dl>
          </article>

          <article className="platform-panel platform-panel-stack">
            <header>
              <div>
                <p>RECENT AGENCIES</p>
                <h2>New platform tenants</h2>
              </div>
              <Link href="/platform/agencies">Open registry</Link>
            </header>
            <div className="platform-recent-list">
              {overview.recentAgencies.length ? overview.recentAgencies.map((agency) => (
                <div key={agency.id}>
                  <span>
                    <b>{agency.name}</b>
                    <small>{agency.slug}</small>
                  </span>
                  <time dateTime={agency.created_at}>{dateLabel(agency.created_at)}</time>
                </div>
              )) : <p>No agency was created in the last 30 days.</p>}
            </div>
          </article>
        </section>

        <section className="platform-boundary" role="note">
          <strong>Platform and agency authority are deliberately separate</strong>
          <p>
            This workspace exposes tenant registry metadata and aggregate service health only. It does not expose leads, contacts, conversations, quotes, trips, documents, payments, model prompts, or provider credentials. A platform operator needs a separate agency membership to enter an agency workspace.
          </p>
        </section>
      </div>
    </main>
  );
}
