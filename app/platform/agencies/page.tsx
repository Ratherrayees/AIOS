import { getPlatformAgencies } from "../../actions/platform";
import { PlatformAgencyDirectory } from "../../../components/platform/platform-agency-directory";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";

export default async function PlatformAgenciesPage() {
  const directory = await getPlatformAgencies({ page: 1, pageSize: 25, query: "" });
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader
        section="Platform administration"
        title="Agencies"
        meta={`${directory.total} tenant workspaces`}
      />
      <div className="platform-content">
        <section className="platform-boundary" role="note">
          <strong>Registry metadata, not customer records</strong>
          <p>
            This directory shows agency identity, membership counts, and integration readiness. Platform roles cannot open agency leads, contacts, messages, quotes, trips, finance, documents, or credentials without an explicit tenant membership.
          </p>
        </section>
        <PlatformAgencyDirectory initial={directory} />
      </div>
    </main>
  );
}
