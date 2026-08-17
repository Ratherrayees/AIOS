import Link from "next/link";

import { getPlatformOverview } from "../../actions/platform";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";

export default async function PlatformSystemPage() {
  const overview = await getPlatformOverview();
  const queues = [
    { label: "AI jobs active or retrying", value: overview.queuedAiJobCount, tone: overview.failedAiJobCount ? "attention" : "normal" },
    { label: "AI jobs failed or dead-lettered", value: overview.failedAiJobCount, tone: overview.failedAiJobCount ? "attention" : "normal" },
    { label: "Inbound email failures", value: overview.failedInboundEmailCount, tone: overview.failedInboundEmailCount ? "attention" : "normal" },
    { label: "Outbound email failures", value: overview.failedOutboundEmailCount, tone: overview.failedOutboundEmailCount ? "attention" : "normal" },
    { label: "Tenant provider failures", value: overview.tenantIntegrationAttentionCount, tone: overview.tenantIntegrationAttentionCount ? "attention" : "normal" },
    { label: "Pending tenant approvals", value: overview.pendingApprovalCount, tone: "normal" },
  ];
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader section="Platform administration" title="System health" meta="Aggregate operational signals" />
      <div className="platform-content">
        <section className="platform-readiness-board">
          <header><p>DEPLOYMENT READINESS</p><h2>Platform service configuration</h2></header>
          {overview.systemReadiness.map((item) => (
            <article key={item.key}>
              <span className={item.ready ? "is-ready" : "needs-setup"} aria-hidden="true" />
              <div><b>{item.label}</b><p>{item.guidance}</p></div>
              <em>{item.ready ? "Ready" : "Action required"}</em>
            </article>
          ))}
        </section>
        <section className="platform-queue-grid" aria-label="Platform queue health">
          {queues.map((item) => (
            <article className={item.tone === "attention" ? "has-attention" : ""} key={item.label}>
              <span>{item.label}</span><b>{item.value}</b>
            </article>
          ))}
        </section>
        <section className="platform-boundary" role="note">
          <strong>Aggregate health is not tenant support access</strong>
          <p>These counts identify platform reliability work. They do not reveal tenant payloads or grant permission to resolve agency approvals. Use the agency registry for configuration readiness and require explicit agency membership for customer-data investigation.</p>
        </section>
        <section className="platform-panel">
          <div><h2>Platform email health</h2><p>Review the service-owned sender and its last safe connection result.</p></div>
          <Link className="platform-primary-link" href="/platform/email">Open platform email</Link>
        </section>
      </div>
    </main>
  );
}
