"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  publishTravelerPortal,
  requestTravelerPortalApproval,
  revokeTravelerPortal,
} from "../../../actions/crm";
import { resolveApprovalRequest } from "../../../actions/approvals";
import { EmptyState, LoadingState } from "../../../../components/ui/empty-state";
import { FeatureHeader } from "../../../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../../lib/supabase/workspace-context";
import "./portal-management.css";

type Trip = {
  id: string;
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
};

type TripDocument = {
  id: string;
  file_name: string;
  document_kind:
    | "voucher"
    | "ticket"
    | "insurance"
    | "visa"
    | "identity"
    | "other";
  sensitivity: "normal" | "restricted";
  expires_at: string | null;
};

type PortalApproval = {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  payload: {
    document_ids?: unknown;
    include_payment_status?: unknown;
    portal_expires_at?: unknown;
  };
  created_at: string;
  resolved_at: string | null;
};

type PortalLink = {
  id: string;
  approval_request_id: string;
  status: "active" | "revoked";
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  revocation_note: string | null;
};

const requestRoles = new Set([
  "owner",
  "admin",
  "trip_designer",
  "operations",
  "agent",
]);
const publishRoles = new Set([
  "owner",
  "admin",
  "trip_designer",
  "operations",
]);
const approvalRoles = new Set(["owner", "admin", "operations", "finance"]);

function readableDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
  }).format(new Date(value));
}

function approvalDocumentIds(approval: PortalApproval) {
  return Array.isArray(approval.payload.document_ids)
    ? approval.payload.document_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

export default function TravelerPortalManagementPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [documents, setDocuments] = useState<TripDocument[]>([]);
  const [approvals, setApprovals] = useState<PortalApproval[]>([]);
  const [portalLinks, setPortalLinks] = useState<PortalLink[]>([]);
  const [publishedPaths, setPublishedPaths] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, startTransition] = useTransition();

  const canRequest = role ? requestRoles.has(role) : false;
  const canPublish = role ? publishRoles.has(role) : false;
  const canApprove = role ? approvalRoles.has(role) : false;

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active } = await loadWorkspaceContext(supabase);
      if (!active) throw new Error("No active workspace is available.");
      setOrganizationId(active.organization_id);
      setRole(active.role);

      const [
        { data: tripRow, error: tripError },
        { data: documentRows },
        { data: approvalRows },
        { data: portalRows },
      ] = await Promise.all([
        supabase
          .from("trips")
          .select("id, name, destination, start_date, end_date")
          .eq("organization_id", active.organization_id)
          .eq("id", tripId)
          .maybeSingle(),
        supabase
          .from("documents")
          .select(
            "id, file_name, document_kind, sensitivity, expires_at",
          )
          .eq("organization_id", active.organization_id)
          .eq("trip_id", tripId)
          .order("created_at", { ascending: false }),
        supabase
          .from("approval_requests")
          .select("id, status, payload, created_at, resolved_at")
          .eq("organization_id", active.organization_id)
          .eq("action", "document.share")
          .eq("entity_type", "trip")
          .eq("entity_id", tripId)
          .order("created_at", { ascending: false }),
        supabase
          .from("trip_portal_links")
          .select(
            "id, approval_request_id, status, expires_at, created_at, revoked_at, revocation_note",
          )
          .eq("organization_id", active.organization_id)
          .eq("trip_id", tripId)
          .order("created_at", { ascending: false }),
      ]);
      if (tripError || !tripRow)
        throw tripError ?? new Error("This trip is not available.");
      setTrip(tripRow);
      setDocuments((documentRows ?? []) as TripDocument[]);
      setApprovals((approvalRows ?? []) as PortalApproval[]);
      setPortalLinks((portalRows ?? []) as PortalLink[]);
      setLoadedAt(Date.now());
      setLoading(false);
    };
    void load().catch((error) => {
      setNotice(
        error instanceof Error
          ? error.message
          : "Traveler sharing could not be loaded.",
      );
      setLoading(false);
    });
  }, [revision, tripId]);

  const linksByApproval = useMemo(
    () =>
      new Map(
        portalLinks.map((portalLink) => [
          portalLink.approval_request_id,
          portalLink,
        ]),
      ),
    [portalLinks],
  );

  function requestApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = new FormData(event.currentTarget);
    const documentIds = form
      .getAll("documentIds")
      .map(String)
      .filter(Boolean);
    setNotice("");
    startTransition(async () => {
      try {
        const result = await requestTravelerPortalApproval({
          organizationId,
          tripId,
          documentIds,
          includePaymentStatus: form.get("includePaymentStatus") === "on",
          durationDays: Number(form.get("durationDays")),
        });
        setNotice(
          `Human review requested. Approval ${result.approvalId?.slice(0, 8)} is waiting in this workspace.`,
        );
        setRevision((value) => value + 1);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Traveler sharing could not be routed for approval.",
        );
      }
    });
  }

  function resolveApproval(
    approvalId: string,
    decision: "approved" | "rejected",
  ) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        await resolveApprovalRequest({
          organizationId,
          approvalId,
          decision,
        });
        setNotice(
          decision === "approved"
            ? "Human approval recorded. The reviewed snapshot can now be published."
            : "Traveler sharing rejected. No public link was created.",
        );
        setRevision((value) => value + 1);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The human decision could not be recorded.",
        );
      }
    });
  }

  function publish(approvalId: string) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const result = await publishTravelerPortal({
          organizationId,
          tripId,
          approvalId,
        });
        setPublishedPaths((current) => ({
          ...current,
          [result.id]: result.path,
        }));
        setNotice(
          "Traveler portal published. Copy the link now; only its hash is stored.",
        );
        setRevision((value) => value + 1);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The approved portal could not be published.",
        );
      }
    });
  }

  function revoke(event: FormEvent<HTMLFormElement>, portalLinkId: string) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        await revokeTravelerPortal({
          organizationId,
          portalLinkId,
          note: String(form.get("note")),
        });
        setPublishedPaths((current) => {
          const next = { ...current };
          delete next[portalLinkId];
          return next;
        });
        setNotice("Traveler link revoked immediately.");
        setRevision((value) => value + 1);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The traveler link could not be revoked.",
        );
      }
    });
  }

  async function copyPath(path: string) {
    const fullUrl = new URL(path, window.location.origin).toString();
    await navigator.clipboard.writeText(fullUrl);
    setNotice("Traveler link copied.");
  }

  if (loading) {
    return (
      <main className="portal-management-page">
        <FeatureHeader links={[{ href: "/trips", label: "Trip Operations" }]} />
        <div className="portal-management-loading">
          <LoadingState label="Loading traveler sharing controls" rows={5} />
        </div>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="portal-management-page">
        <FeatureHeader links={[{ href: "/trips", label: "Trip Operations" }]} />
        <div className="portal-management-loading">
          <EmptyState
            title="This trip is not available."
            description={
              notice || "Return to Trip Operations and choose a live trip."
            }
            action={<Link href="/trips">Open Trip Operations</Link>}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="portal-management-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: `/trips/${trip.id}`, label: "Trip workspace" },
          { href: "/trips", label: "Trip Operations" },
          { href: "/aios/approvals", label: "AIOS approvals" },
        ]}
      />

      <section className="portal-management-hero">
        <div>
          <p>TRAVELER SHARING / HUMAN GATE</p>
          <h1>Share the journey, not the back office.</h1>
          <span>
            {trip.name} · {trip.destination || "Destination pending"} ·{" "}
            {trip.start_date || "Dates pending"}
          </span>
        </div>
        <aside>
          <b>FROZEN SNAPSHOT</b>
          <span>
            Every link is human-approved, token-hashed, expiring and
            immediately revocable.
          </span>
        </aside>
      </section>

      {notice && (
        <p className="portal-management-notice" role="status">
          {notice}
        </p>
      )}

      <section className="portal-boundary-grid" aria-label="Sharing boundary">
        <article>
          <span>VISIBLE</span>
          <b>Journey essentials</b>
          <p>
            Traveler names, itinerary outline, confirmed services and the
            explicitly selected files.
          </p>
        </article>
        <article>
          <span>OPTIONAL</span>
          <b>Customer payment status</b>
          <p>
            Receivables only. Supplier payables, bank references and settlement
            notes never enter the portal.
          </p>
        </article>
        <article>
          <span>NEVER VISIBLE</span>
          <b>Internal commercial context</b>
          <p>
            Operations notes, supplier terms, costs, margins, private identity
            files and audit evidence remain inside AIOS.
          </p>
        </article>
      </section>

      <div className="portal-management-layout">
        <section className="portal-scope-card">
          <header>
            <div>
              <p>STEP 1</p>
              <h2>Define the exact snapshot</h2>
            </div>
            <span>Nothing is live yet</span>
          </header>
          {canRequest ? (
            <form onSubmit={requestApproval}>
              <fieldset>
                <legend>Traveler files</legend>
                {documents.length ? (
                  documents.map((document) => {
                    const shareable =
                      document.sensitivity === "normal" &&
                      document.document_kind !== "identity";
                    return (
                      <label key={document.id} className="portal-file-option">
                        <input
                          type="checkbox"
                          name="documentIds"
                          value={document.id}
                          disabled={!shareable || pending}
                        />
                        <span>
                          <b>{document.file_name}</b>
                          <small>
                            {document.document_kind.replace("_", " ")}
                            {document.expires_at
                              ? ` · expires ${document.expires_at}`
                              : " · no file expiry"}
                            {!shareable ? " · private only" : ""}
                          </small>
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <p className="portal-empty-copy">
                    Upload and classify a voucher in the trip vault before
                    selecting files.
                  </p>
                )}
              </fieldset>

              <label className="portal-payment-option">
                <input
                  type="checkbox"
                  name="includePaymentStatus"
                  defaultChecked
                  disabled={pending}
                />
                <span>
                  <b>Include customer payment status</b>
                  <small>Receivables only; no payment action is possible.</small>
                </span>
              </label>

              <label className="portal-duration">
                Link lifetime
                <select name="durationDays" defaultValue="7" disabled={pending}>
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </select>
              </label>

              <button disabled={pending}>Request human approval</button>
              <small className="portal-form-boundary">
                AIOS prepares this scope but cannot approve or publish it.
              </small>
            </form>
          ) : (
            <p className="portal-read-only">
              Your role can inspect traveler-sharing evidence but cannot request
              an external share.
            </p>
          )}
        </section>

        <section className="portal-review-card">
          <header>
            <div>
              <p>STEPS 2–3</p>
              <h2>Review, publish and revoke</h2>
            </div>
            <span>{approvals.length} review records</span>
          </header>

          <div className="portal-review-list">
            {approvals.map((approval) => {
              const portalLink = linksByApproval.get(approval.id);
              const publishedPath = portalLink
                ? publishedPaths[portalLink.id]
                : null;
              const expired = portalLink
                ? new Date(portalLink.expires_at).getTime() <= (loadedAt ?? 0)
                : false;
              return (
                <article key={approval.id} className="portal-review-item">
                  <div className="portal-review-meta">
                    <span data-status={approval.status}>{approval.status}</span>
                    <small>{readableDate(approval.created_at)}</small>
                  </div>
                  <h3>
                    {approvalDocumentIds(approval).length} file
                    {approvalDocumentIds(approval).length === 1 ? "" : "s"} ·{" "}
                    {approval.payload.include_payment_status === true
                      ? "payment status included"
                      : "payment status hidden"}
                  </h3>
                  <p>
                    Requested portal expiry:{" "}
                    {typeof approval.payload.portal_expires_at === "string"
                      ? readableDate(approval.payload.portal_expires_at)
                      : "Invalid scope"}
                  </p>

                  {approval.status === "pending" && canApprove && (
                    <div className="portal-review-actions">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => resolveApproval(approval.id, "approved")}
                      >
                        Approve reviewed scope
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={pending}
                        onClick={() => resolveApproval(approval.id, "rejected")}
                      >
                        Reject
                      </button>
                    </div>
                  )}

                  {approval.status === "approved" &&
                    !portalLink &&
                    canPublish && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => publish(approval.id)}
                      >
                        Publish approved portal
                      </button>
                    )}

                  {portalLink && (
                    <div className="portal-link-state">
                      <b>
                        {portalLink.status === "revoked"
                          ? "Link revoked"
                          : expired
                            ? "Link expired"
                            : `Active until ${readableDate(portalLink.expires_at)}`}
                      </b>
                      {publishedPath &&
                        portalLink.status === "active" &&
                        !expired && (
                          <div className="portal-link-reveal">
                            <code>{publishedPath}</code>
                            <a
                              href={publishedPath}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open traveler portal
                            </a>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => void copyPath(publishedPath)}
                            >
                              Copy link
                            </button>
                          </div>
                        )}
                      {!publishedPath &&
                        portalLink.status === "active" &&
                        !expired &&
                        canPublish && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={pending}
                            onClick={() => publish(approval.id)}
                          >
                            Create replacement link
                          </button>
                        )}
                      {portalLink.status === "active" &&
                        !expired &&
                        canPublish && (
                          <form onSubmit={(event) => revoke(event, portalLink.id)}>
                            <label>
                              Revocation reason
                              <input
                                name="note"
                                minLength={5}
                                maxLength={500}
                                required
                                placeholder="Traveler access is no longer needed"
                              />
                            </label>
                            <button
                              type="submit"
                              className="danger"
                              disabled={pending}
                            >
                              Revoke immediately
                            </button>
                          </form>
                        )}
                      {portalLink.revocation_note && (
                        <small>Reason: {portalLink.revocation_note}</small>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {approvals.length === 0 && (
              <EmptyState
                title="Traveler access has not been requested."
                description="Choose the exact snapshot on the left. A public link exists only after a human approves and an authorized operator publishes it."
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
