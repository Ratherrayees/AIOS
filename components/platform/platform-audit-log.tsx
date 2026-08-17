"use client";

import { type FormEvent, useState, useTransition } from "react";

import { getPlatformAuditEvents } from "../../app/actions/platform";
import { Button } from "../ui/button";
import { EmptyState, ErrorState, LoadingState } from "../ui/empty-state";

type AuditDirectory = Awaited<ReturnType<typeof getPlatformAuditEvents>>;

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PlatformAuditLog({ initial }: { initial: AuditDirectory }) {
  const [directory, setDirectory] = useState(initial);
  const [query, setQuery] = useState(initial.query);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function load(page: number, nextQuery = query) {
    setError("");
    startTransition(async () => {
      try {
        setDirectory(
          await getPlatformAuditEvents({
            page,
            pageSize: directory.pageSize,
            query: nextQuery,
          }),
        );
      } catch {
        setError("The platform audit log could not be refreshed.");
      }
    });
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    load(1, query.trim());
  }

  const pageCount = Math.max(1, Math.ceil(directory.total / directory.pageSize));

  return (
    <section className="platform-directory" aria-label="Platform audit log">
      <form className="platform-directory-toolbar" role="search" onSubmit={search}>
        <label>
          Search audit events
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Access, email, integration…"
            maxLength={120}
          />
        </label>
        <Button type="submit" disabled={pending}>{pending ? "Searching…" : "Search"}</Button>
        {directory.query ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => { setQuery(""); load(1, ""); }}>
            Clear
          </Button>
        ) : null}
        <span>{directory.total} events</span>
      </form>
      {error ? (
        <ErrorState title="Audit log unavailable" description={error} onRetry={() => load(directory.page)} />
      ) : pending ? (
        <LoadingState label="Refreshing platform audit log" rows={5} />
      ) : directory.events.length === 0 ? (
        <EmptyState title="No matching platform events" description="Platform configuration and access changes appear here." />
      ) : (
        <div className="platform-table-wrap">
          <table className="platform-table platform-audit-table">
            <thead>
              <tr><th>Time</th><th>Actor</th><th>Event</th><th>Record</th><th>Safe metadata</th></tr>
            </thead>
            <tbody>
              {directory.events.map((event) => (
                <tr key={event.id}>
                  <td><time dateTime={event.createdAt}>{dateTimeLabel(event.createdAt)}</time></td>
                  <td>{event.actorName}</td>
                  <td><b>{event.eventType.replaceAll(".", " ")}</b></td>
                  <td>{event.entityType.replaceAll("_", " ")}</td>
                  <td>
                    {Object.entries(event.metadata).length
                      ? Object.entries(event.metadata).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")
                      : "No customer or credential data"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="platform-pagination">
        <Button type="button" variant="secondary" disabled={pending || directory.page <= 1} onClick={() => load(directory.page - 1)}>Previous</Button>
        <span>Page {directory.page} of {pageCount}</span>
        <Button type="button" variant="secondary" disabled={pending || directory.page >= pageCount} onClick={() => load(directory.page + 1)}>Next</Button>
      </footer>
    </section>
  );
}
