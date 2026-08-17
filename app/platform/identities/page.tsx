import Link from "next/link";

import { getPlatformIdentities, getPlatformIdentityAnomalies } from "../../actions/platform";
import { PlatformIdentityDirectory } from "../../../components/platform/platform-identity-directory";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";

export default async function PlatformIdentitiesPage() {
  const [directory, anomalies] = await Promise.all([
    getPlatformIdentities({ page: 1, pageSize: 25, query: "" }),
    getPlatformIdentityAnomalies(),
  ]);
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader section="Platform administration" title="Users & security" meta={`${directory.total} authentication accounts`} />
      <div className="platform-content">
        <section className="platform-boundary" role="note">
          <strong>Identity metadata, not customer data</strong>
          <p>This directory exposes account verification, MFA enrollment, last sign-in, membership counts, and platform authority. It never exposes passwords, sessions, recovery secrets, customer records, or tenant credentials.</p>
        </section>
        <section className="platform-security-signals" aria-labelledby="security-signals-title">
          <header>
            <div><p>DETERMINISTIC SECURITY SIGNALS</p><h2 id="security-signals-title">Access attention</h2></div>
            <small>Evaluated {new Date(anomalies.generatedAt).toLocaleString("en-IN")}</small>
          </header>
          <div>
            <article className={anomalies.missingMfa.total ? "has-attention" : ""}>
              <span>PRIVILEGED WITHOUT MFA</span><b>{anomalies.missingMfa.total}</b>
              <small>Active platform operators without a verified factor.</small>
              {anomalies.missingMfa.items.map((identity) => <Link key={identity.userId} href={`/platform/identities/${identity.userId}`}>{identity.email}</Link>)}
            </article>
            <article className={anomalies.dormantPrivileged.total ? "has-attention" : ""}>
              <span>DORMANT PRIVILEGED</span><b>{anomalies.dormantPrivileged.total}</b>
              <small>No sign-in during the last {anomalies.dormantThresholdDays} days.</small>
              {anomalies.dormantPrivileged.items.map((identity) => <Link key={identity.userId} href={`/platform/identities/${identity.userId}`}>{identity.email}</Link>)}
            </article>
            <article className={anomalies.orphanedAgencies.total ? "has-attention" : ""}>
              <span>AGENCIES WITHOUT ACTIVE OWNER</span><b>{anomalies.orphanedAgencies.total}</b>
              <small>Provisioning or operating agencies with no active owner membership.</small>
              {anomalies.orphanedAgencies.items.map((agency) => <Link key={agency.organizationId} href={`/platform/agencies/${agency.organizationId}`}>{agency.name}</Link>)}
            </article>
          </div>
          <p className="platform-signal-coverage">Repeated failed-sign-in detection belongs in external Auth log monitoring and is not inferred from successful-session metadata.{anomalies.unknownMfaOperatorCount ? ` MFA status is temporarily unavailable for ${anomalies.unknownMfaOperatorCount} active operator(s).` : ""}</p>
        </section>
        <PlatformIdentityDirectory initial={directory} />
      </div>
    </main>
  );
}
