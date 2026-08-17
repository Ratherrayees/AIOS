import { getPlatformUsageOverview } from "../../actions/platform-usage";
import { PlatformUsageDesk } from "../../../components/platform/platform-usage-desk";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";

export default async function PlatformUsagePage() {
  const overview = await getPlatformUsageOverview({ days: 30 });
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader section="Platform administration" title="Usage & limits" meta={`${overview.totals.agencies} agencies`} />
      <div className="platform-content">
        <section className="platform-boundary" role="note">
          <strong>Operational aggregates only</strong>
          <p>This desk counts users, model execution, storage, email, jobs, and reports. It never returns customer records, file names, messages, prompts, model output, credentials, or mixed-currency totals.</p>
        </section>
        <PlatformUsageDesk initial={overview} />
      </div>
    </main>
  );
}
