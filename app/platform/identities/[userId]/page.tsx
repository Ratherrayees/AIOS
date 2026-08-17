import Link from "next/link";

import { getPlatformIdentityDetail } from "../../../actions/platform";
import { PlatformIdentitySecurity } from "../../../../components/platform/platform-identity-security";
import { OperationalPageHeader } from "../../../../components/ui/operational-page-header";

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("en-IN") : "Never";
}

export default async function PlatformIdentityDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const detail = await getPlatformIdentityDetail({ userId });
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader
        section="Platform / Users & security"
        title={detail.identity.fullName}
        meta={detail.identity.email || "Email unavailable"}
        actions={<Link className="platform-primary-link" href="/platform/identities">Back to users</Link>}
      />
      <div className="platform-content">
        <section className="platform-boundary" role="note">
          <strong>Authentication metadata only</strong>
          <p>This view contains account security, authority, membership references, and audit evidence. It exposes no password, token, session payload, recovery secret, or agency customer record.</p>
        </section>
        <section className="platform-metrics platform-metrics-four">
          <article><span>EMAIL</span><b>{detail.identity.emailVerified ? "Verified" : "Unverified"}</b><small>Authentication identity</small></article>
          <article><span>MFA</span><b>{detail.identity.mfaEnrolled === null ? "Unknown" : detail.identity.mfaEnrolled ? "Enrolled" : "Missing"}</b><small>Verified factor state</small></article>
          <article><span>LAST SIGN-IN</span><b className="platform-compact-value">{dateTime(detail.identity.lastSignInAt)}</b><small>Provider timestamp</small></article>
          <article><span>AGENCIES</span><b>{detail.memberships.filter((membership) => membership.status === "active").length}</b><small>{detail.memberships.length} total membership records</small></article>
        </section>
        <PlatformIdentitySecurity initial={detail} />
        <section className="platform-overview-grid">
          <article className="platform-panel platform-panel-stack">
            <header><div><p>AGENCY REFERENCES</p><h2>Memberships</h2></div></header>
            <div className="platform-recent-list">
              {detail.memberships.length ? detail.memberships.map((membership) => (
                <div key={membership.organizationId}><span><b>{membership.organizationName}</b><small>{membership.organizationSlug}</small></span><span className={membership.status === "active" ? "platform-ready-pill" : "platform-muted-pill"}>{membership.role.replace("_", " ")} · {membership.status}</span></div>
              )) : <p>No agency membership is recorded.</p>}
            </div>
          </article>
          <article className="platform-panel platform-panel-stack">
            <header><div><p>PLATFORM AUTHORITY</p><h2>{detail.platformAuthority ? detail.platformAuthority.role.replace("_", " ") : "None"}</h2></div></header>
            <dl className="platform-fact-list">
              <div><dt>Status</dt><dd>{detail.platformAuthority?.status || "Not assigned"}</dd></div>
              <div><dt>Granted</dt><dd>{dateTime(detail.platformAuthority?.grantedAt || null)}</dd></div>
              <div><dt>Account created</dt><dd>{dateTime(detail.identity.createdAt)}</dd></div>
            </dl>
          </article>
        </section>
        <section className="platform-panel platform-panel-stack">
          <header><div><p>IMMUTABLE SECURITY HISTORY</p><h2>Account evidence</h2></div></header>
          <div className="platform-timeline">
            {detail.events.length ? detail.events.map((event) => (
              <article key={event.id}><div><b>{event.eventType.replaceAll(".", " ")}</b><p>{event.reason}</p></div><small>{event.actorName} · {dateTime(event.createdAt)} · v{event.version}</small></article>
            )) : <p>No platform security action has been recorded.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
