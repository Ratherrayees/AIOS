import { getPlatformAuditEvents } from "../../actions/platform";
import { PlatformAuditLog } from "../../../components/platform/platform-audit-log";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";

export default async function PlatformAuditPage() {
  const events = await getPlatformAuditEvents({ page: 1, pageSize: 25, query: "" });
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader section="Platform administration" title="Audit log" meta={`${events.total} immutable events`} />
      <div className="platform-content">
        <section className="platform-boundary" role="note">
          <strong>Privacy-minimized platform evidence</strong>
          <p>This ledger records platform access and service configuration changes. Customer text, provider secrets, tenant records, model prompts, and email bodies are intentionally excluded.</p>
        </section>
        <PlatformAuditLog initial={events} />
      </div>
    </main>
  );
}
