"use client";

import { type FormEvent, useState, useTransition } from "react";
import Link from "next/link";

import { getPlatformAgencies } from "../../app/actions/platform";
import { PlatformAgencyProvisioner } from "./platform-agency-provisioner";
import { Button } from "../ui/button";
import { EmptyState, ErrorState, LoadingState } from "../ui/empty-state";

type AgencyDirectory = Awaited<ReturnType<typeof getPlatformAgencies>>;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function Readiness({ label, ready }: { label: string; ready: boolean }) {
  return (
    <span className={ready ? "platform-ready-pill" : "platform-muted-pill"}>
      {label} {ready ? "ready" : "not ready"}
    </span>
  );
}

export function PlatformAgencyDirectory({ initial }: { initial: AgencyDirectory }) {
  const [directory, setDirectory] = useState(initial);
  const [query, setQuery] = useState(initial.query);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function load(nextPage: number, nextQuery = query) {
    setError("");
    startTransition(async () => {
      try {
        setDirectory(
          await getPlatformAgencies({
            query: nextQuery,
            page: nextPage,
            pageSize: directory.pageSize,
          }),
        );
      } catch {
        setError("The agency registry could not be refreshed.");
      }
    });
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    load(1, query.trim());
  }

  const pageCount = Math.max(1, Math.ceil(directory.total / directory.pageSize));

  return (
    <section className="platform-directory" aria-label="Agency registry">
      <PlatformAgencyProvisioner
        canProvision={directory.canProvisionAgencies}
        mfaVerified={directory.mfaVerified}
        onProvisioned={() => load(1, "")}
      />
      <form className="platform-directory-toolbar" role="search" onSubmit={search}>
        <label>
          Search agencies
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Agency name or slug"
            maxLength={120}
          />
        </label>
        <Button type="submit" disabled={pending}>{pending ? "Searching…" : "Search"}</Button>
        {directory.query ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setQuery("");
              load(1, "");
            }}
          >
            Clear
          </Button>
        ) : null}
        <span>{directory.total} agencies</span>
      </form>
      {error ? (
        <ErrorState title="Agency registry unavailable" description={error} onRetry={() => load(directory.page)} />
      ) : pending ? (
        <LoadingState label="Refreshing agency registry" rows={4} />
      ) : directory.agencies.length === 0 ? (
        <EmptyState title="No matching agencies" description="Change the search term to review more tenant workspaces." />
      ) : (
        <div className="platform-table-wrap">
          <table className="platform-table">
            <thead>
              <tr>
                <th>Agency</th>
                <th>Lifecycle</th>
                <th>Active people</th>
                <th>Integrations</th>
                <th>Service readiness</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {directory.agencies.map((agency) => (
                <tr key={agency.id}>
                  <td>
                    <b><Link className="platform-record-link" href={`/platform/agencies/${agency.id}`}>{agency.name}</Link></b>
                    <small>{agency.slug}</small>
                  </td>
                  <td><span className={`platform-status-badge is-${agency.lifecycleStatus}`}>{agency.lifecycleStatus}</span></td>
                  <td>{agency.activeMemberCount}</td>
                  <td>{agency.activeIntegrationCount} active / {agency.configuredIntegrationCount} configured</td>
                  <td>
                    <div className="platform-readiness-pills">
                      <Readiness label="Email" ready={agency.emailReady} />
                      <Readiness label="Payments" ready={agency.paymentReady} />
                      <Readiness label="WhatsApp" ready={agency.whatsappReady} />
                      <Readiness label="AI" ready={agency.aiReady} />
                    </div>
                  </td>
                  <td><time dateTime={agency.createdAt}>{dateLabel(agency.createdAt)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="platform-pagination">
        <Button type="button" variant="secondary" disabled={pending || directory.page <= 1} onClick={() => load(directory.page - 1)}>
          Previous
        </Button>
        <span>Page {directory.page} of {pageCount}</span>
        <Button type="button" variant="secondary" disabled={pending || directory.page >= pageCount} onClick={() => load(directory.page + 1)}>
          Next
        </Button>
      </footer>
    </section>
  );
}
