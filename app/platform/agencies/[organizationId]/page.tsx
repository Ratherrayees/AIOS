import Link from "next/link";

import { getPlatformAgencyDetail } from "../../../actions/platform";
import { PlatformAgencyLifecycle } from "../../../../components/platform/platform-agency-lifecycle";
import { PlatformAgencyInvitations } from "../../../../components/platform/platform-agency-invitations";
import { OperationalPageHeader } from "../../../../components/ui/operational-page-header";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default async function PlatformAgencyDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const detail = await getPlatformAgencyDetail({ organizationId });
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader
        section="Platform / Agencies"
        title={detail.organization.name}
        meta={`${detail.organization.slug} · Created ${dateLabel(detail.organization.createdAt)}`}
        actions={<Link className="platform-primary-link" href="/platform/agencies">Back to agencies</Link>}
      />
      <div className="platform-content">
        <section className="platform-boundary" role="note">
          <strong>Operational metadata only</strong>
          <p>This page exposes lifecycle, owner identity, counts, and service readiness. It does not open this agency’s leads, conversations, quotes, trips, documents, payments, prompts, or credentials.</p>
        </section>
        <section className="platform-metrics platform-metrics-four">
          <article><span>ACTIVE PEOPLE</span><b>{detail.membershipSummary.active}</b><small>{detail.membershipSummary.total} total membership records</small></article>
          {detail.recordCounts.slice(0, 3).map((record) => (
            <article key={record.label}><span>{record.label.toUpperCase()}</span><b>{record.count}</b><small>Aggregate record count</small></article>
          ))}
        </section>
        <section className="platform-overview-grid">
          <article className="platform-panel platform-panel-stack">
            <header><div><p>AGENCY OWNERS</p><h2>Account contacts</h2></div></header>
            <div className="platform-recent-list">
              {detail.owners.length ? detail.owners.map((owner) => (
                <div key={owner.userId}><span><b>{owner.fullName}</b><small>{owner.email || "Email unavailable"}</small></span></div>
              )) : <p>No owner membership is currently recorded.</p>}
            </div>
          </article>
          <article className="platform-panel platform-panel-stack">
            <header><div><p>SERVICE READINESS</p><h2>Configured integrations</h2></div></header>
            <div className="platform-recent-list">
              {detail.integrations.length ? detail.integrations.map((integration) => (
                <div key={`${integration.category}:${integration.provider}`}>
                  <span><b>{integration.provider.replaceAll("_", " ")}</b><small>{integration.category}</small></span>
                  <span className={integration.is_enabled && integration.connection_status === "connected" ? "platform-ready-pill" : "platform-muted-pill"}>{integration.connection_status}</span>
                </div>
              )) : <p>No agency integrations are configured.</p>}
            </div>
          </article>
        </section>
        <PlatformAgencyLifecycle initial={detail} />
        <PlatformAgencyInvitations initial={detail} />
        <section className="platform-panel platform-panel-stack">
          <header><div><p>IMMUTABLE HISTORY</p><h2>Lifecycle evidence</h2></div></header>
          <div className="platform-timeline">
            {detail.lifecycleEvents.length ? detail.lifecycleEvents.map((event) => (
              <article key={event.id}>
                <div><b>{event.previousStatus} → {event.nextStatus}</b><p>{event.reason}</p></div>
                <small>{event.actorName} · {new Date(event.createdAt).toLocaleString("en-IN")}</small>
              </article>
            )) : <p>No lifecycle changes have been recorded.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
