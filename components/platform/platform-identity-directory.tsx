"use client";

import { type FormEvent, useState, useTransition } from "react";
import Link from "next/link";

import {
  getPlatformIdentities,
  updatePlatformIdentityStatus,
} from "../../app/actions/platform";
import { Button } from "../ui/button";
import { EmptyState, ErrorState, LoadingState } from "../ui/empty-state";
import { FormFeedback, FormField } from "../ui/form-field";

type IdentityDirectory = Awaited<ReturnType<typeof getPlatformIdentities>>;
type Identity = IdentityDirectory["identities"][number];

function dateLabel(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function PlatformIdentityDirectory({
  initial,
}: {
  initial: IdentityDirectory;
}) {
  const [directory, setDirectory] = useState(initial);
  const [query, setQuery] = useState(initial.query);
  const [selected, setSelected] = useState<Identity | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function load(nextPage: number, nextQuery = query) {
    setError("");
    startTransition(async () => {
      try {
        setDirectory(
          await getPlatformIdentities({
            query: nextQuery,
            page: nextPage,
            pageSize: directory.pageSize,
          }),
        );
      } catch {
        setError("The identity directory could not be refreshed.");
      }
    });
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    load(1, query.trim());
  }

  function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;
    const data = new FormData(event.currentTarget);
    if (String(data.get("confirmation") || "") !== (selected.email || selected.userId)) {
      setFeedback({ tone: "error", message: "Enter the exact account email to confirm." });
      return;
    }
    const nextStatus = selected.status === "active" ? "suspended" : "active";
    setFeedback(null);
    startTransition(async () => {
      try {
        await updatePlatformIdentityStatus({
          userId: selected.userId,
          status: nextStatus,
          reason: String(data.get("reason") || ""),
          confirmation: String(data.get("confirmation") || ""),
          expectedVersion: selected.securityVersion,
        });
        setDirectory(
          await getPlatformIdentities({
            query: directory.query,
            page: directory.page,
            pageSize: directory.pageSize,
          }),
        );
        setSelected(null);
        setFeedback({
          tone: "success",
          message: `Authentication account ${nextStatus === "active" ? "restored" : "suspended"}.`,
        });
      } catch (statusError) {
        setFeedback({
          tone: "error",
          message:
            statusError instanceof Error
              ? statusError.message
              : "Account status could not be changed.",
        });
      }
    });
  }

  const pageCount = Math.max(1, Math.ceil(directory.total / directory.pageSize));

  return (
    <div className="platform-identity-workspace">
      {feedback ? <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback> : null}
      {!directory.mfaVerified && directory.canManageIdentities ? (
        <section className="platform-warning" role="alert">
          Verify multi-factor authentication before suspending or restoring accounts.
        </section>
      ) : null}
      <section className="platform-directory" aria-label="Global identity directory">
        <form className="platform-directory-toolbar" role="search" onSubmit={search}>
          <label>
            Search people
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" maxLength={120} />
          </label>
          <Button type="submit" disabled={pending}>{pending ? "Searching…" : "Search"}</Button>
          {directory.query ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => { setQuery(""); load(1, ""); }}>Clear</Button>
          ) : null}
          <span>{directory.total} accounts</span>
        </form>
        {error ? (
          <ErrorState title="Identity directory unavailable" description={error} onRetry={() => load(directory.page)} />
        ) : pending ? (
          <LoadingState label="Refreshing identities" rows={5} />
        ) : directory.identities.length === 0 ? (
          <EmptyState title="No matching accounts" description="Change the search term to review more identities." />
        ) : (
          <div className="platform-table-wrap">
            <table className="platform-table platform-identity-table">
              <thead><tr><th>Identity</th><th>Security</th><th>Agency access</th><th>Platform authority</th><th>Last sign-in</th><th>Action</th></tr></thead>
              <tbody>
                {directory.identities.map((identity) => {
                  const protectedOperator = identity.platformStatus === "active";
                  const isSelf = identity.userId === directory.currentUserId;
                  return (
                    <tr key={identity.userId}>
                      <td><b><Link className="platform-record-link" href={`/platform/identities/${identity.userId}`}>{identity.fullName}</Link></b><small>{identity.email || "Email unavailable"}</small></td>
                      <td><div className="platform-readiness-pills"><span className={identity.emailVerified ? "platform-ready-pill" : "platform-muted-pill"}>Email {identity.emailVerified ? "verified" : "unverified"}</span><span className={identity.mfaEnrolled ? "platform-ready-pill" : "platform-muted-pill"}>MFA {identity.mfaEnrolled === null ? "unknown" : identity.mfaEnrolled ? "enrolled" : "missing"}</span><span className={identity.status === "active" ? "platform-ready-pill" : "platform-muted-pill"}>{identity.status}</span>{identity.passwordResetRequired ? <span className="platform-muted-pill">Reset required</span> : null}</div></td>
                      <td>{identity.activeMembershipCount}<small>{identity.membershipRoles.join(", ") || "No active role"}</small></td>
                      <td>{identity.platformRole ? <><b>{identity.platformRole.replace("_", " ")}</b><small>{identity.platformStatus}</small></> : "None"}</td>
                      <td>{dateLabel(identity.lastSignInAt)}</td>
                      <td>
                        {directory.canManageIdentities ? (
                          <Button type="button" variant="secondary" disabled={pending || !directory.mfaVerified || isSelf || protectedOperator} onClick={() => setSelected(identity)}>
                            {identity.status === "active" ? "Suspend" : "Restore"}
                          </Button>
                        ) : <small>Read only</small>}
                      </td>
                    </tr>
                  );
                })}
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
      {selected ? (
        <section className="platform-access-drawer platform-identity-action" aria-label="Account status confirmation">
          <header><div><b>{selected.status === "active" ? "Suspend" : "Restore"} {selected.fullName}</b><p>This changes authentication access, not agency membership or platform authority.</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close account action">×</button></header>
          <form onSubmit={changeStatus}>
            <FormField label="Security reason"><textarea name="reason" required minLength={12} maxLength={500} placeholder="Record the security or support reason. Do not include customer content." /></FormField>
            <FormField label={`Type “${selected.email || selected.userId}” to confirm`}><input name="confirmation" required autoComplete="off" /></FormField>
            <div className="platform-card-actions"><Button type="submit" disabled={pending}>{pending ? "Applying…" : selected.status === "active" ? "Suspend account" : "Restore account"}</Button><Button type="button" variant="secondary" disabled={pending} onClick={() => setSelected(null)}>Cancel</Button></div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
