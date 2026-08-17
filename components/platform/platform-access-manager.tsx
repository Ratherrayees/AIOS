"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";

import {
  getPlatformAccessDirectory,
  grantPlatformAccess,
  updatePlatformAccess,
} from "../../app/actions/platform";
import { Button } from "../ui/button";
import { FormFeedback, FormField } from "../ui/form-field";
import { ModalBoundary } from "../ui/modal-boundary";

type AccessDirectory = Awaited<ReturnType<typeof getPlatformAccessDirectory>>;
type PlatformOperator = AccessDirectory["operators"][number];

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function roleLabel(role: "superadmin" | "platform_admin") {
  return role === "superadmin" ? "Superadmin" : "Platform admin";
}

function statusLabel(status: "active" | "suspended") {
  return status === "active" ? "Active" : "Suspended";
}

function AccessReviewDialog({
  operator,
  pending,
  onClose,
  onSubmit,
}: {
  operator: PlatformOperator;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    userId: string;
    role: "superadmin" | "platform_admin";
    status: "active" | "suspended";
    reason: string;
    confirmation: string;
    expectedVersion: number;
  }) => void;
}) {
  const [role, setRole] = useState(operator.role);
  const [status, setStatus] = useState(operator.status);
  const changesRole = role !== operator.role;
  const changesStatus = status !== operator.status;
  const isDestructive =
    status === "suspended" ||
    (operator.role === "superadmin" && role !== "superadmin");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({
      userId: operator.userId,
      role,
      status,
      reason: String(data.get("reason") || ""),
      confirmation: String(data.get("confirmation") || ""),
      expectedVersion: operator.version,
    });
  }

  return (
    <ModalBoundary className="platform-modal-layer" onClose={onClose}>
      <section
        aria-describedby="platform-access-review-description"
        aria-labelledby="platform-access-review-title"
        aria-modal="true"
        className="platform-access-review"
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p>PRIVILEGED ACCESS REVIEW</p>
            <h2 id="platform-access-review-title">
              Review access for {operator.fullName}
            </h2>
            <span id="platform-access-review-description">
              Nothing changes until you complete the confirmation below.
            </span>
          </div>
          <button aria-label="Close access review" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="platform-access-comparison" aria-label="Access change preview">
            <article>
              <small>CURRENT</small>
              <b>{roleLabel(operator.role)}</b>
              <span>{statusLabel(operator.status)}</span>
            </article>
            <span aria-hidden="true">→</span>
            <article className={isDestructive ? "has-attention" : ""}>
              <small>PROPOSED</small>
              <b>{roleLabel(role)}</b>
              <span>{statusLabel(status)}</span>
            </article>
          </div>
          <div className="platform-access-review-fields">
            <FormField label="Platform role">
              <select
                name="role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as "superadmin" | "platform_admin")
                }
              >
                <option value="platform_admin">Platform admin — operations</option>
                <option value="superadmin">Superadmin — full platform authority</option>
              </select>
            </FormField>
            <FormField label="Account status">
              <select
                name="status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as "active" | "suspended")
                }
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </FormField>
          </div>
          <FormField label="Operational reason">
            <textarea
              name="reason"
              minLength={12}
              maxLength={500}
              placeholder="Explain the business or security reason for this change."
              required
            />
          </FormField>
          <FormField label={`Type ${operator.email || "the account email"} to confirm`}>
            <input
              name="confirmation"
              type="email"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </FormField>
          <p className={`platform-impact-note${isDestructive ? " is-danger" : ""}`}>
            {status === "suspended"
              ? "Suspending this operator blocks platform access. Existing sessions remain subject to the global session-revocation policy."
              : role === "superadmin"
                ? "Superadmins can manage identities, billing, agencies, and other platform operators. Agency data remains tenant-isolated."
                : "Platform admins can operate the control plane but cannot grant platform authority or manage superadmin-only controls."}
          </p>
          <div className="platform-card-actions">
            <Button
              className={isDestructive ? "platform-danger-button" : ""}
              disabled={pending || (!changesRole && !changesStatus)}
              type="submit"
            >
              {pending ? "Applying…" : "Apply access change"}
            </Button>
            <Button disabled={pending} onClick={onClose} type="button" variant="secondary">
              Cancel
            </Button>
          </div>
        </form>
      </section>
    </ModalBoundary>
  );
}

export function PlatformAccessManager({ initial }: { initial: AccessDirectory }) {
  const [directory, setDirectory] = useState(initial);
  const [reviewing, setReviewing] = useState<PlatformOperator | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const metrics = useMemo(
    () => {
      const activeOperators = directory.operators.filter(
        (operator) => operator.status === "active",
      );
      return {
        active: activeOperators.length,
        superadmins: activeOperators.filter(
          (operator) => operator.role === "superadmin",
        ).length,
        suspended: directory.operators.filter(
          (operator) => operator.status === "suspended",
        ).length,
        mfaCoverage: activeOperators.length
          ? Math.round(
              (activeOperators.filter((operator) => operator.mfaEnrolled).length /
                activeOperators.length) * 100,
            )
          : 0,
      };
    },
    [directory.operators],
  );

  function refresh() {
    startTransition(async () => {
      try {
        setDirectory(await getPlatformAccessDirectory());
      } catch {
        setFeedback({ tone: "error", message: "Platform access could not be refreshed." });
      }
    });
  }

  function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setFeedback(null);
    startTransition(async () => {
      try {
        await grantPlatformAccess({
          email: String(data.get("email") || ""),
          role: String(data.get("role") || "platform_admin"),
          reason: String(data.get("reason") || ""),
          confirmation: String(data.get("confirmation") || ""),
        });
        setDirectory(await getPlatformAccessDirectory());
        form.reset();
        setFeedback({
          tone: "success",
          message: "Platform access was granted and recorded in the audit ledger.",
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "Platform access was not granted.",
        });
      }
    });
  }

  function applyAccess(input: {
    userId: string;
    role: "superadmin" | "platform_admin";
    status: "active" | "suspended";
    reason: string;
    confirmation: string;
    expectedVersion: number;
  }) {
    setFeedback(null);
    startTransition(async () => {
      try {
        await updatePlatformAccess(input);
        setDirectory(await getPlatformAccessDirectory());
        setReviewing(null);
        setFeedback({
          tone: "success",
          message: "Platform access was updated and recorded in the audit ledger.",
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "Platform access was not updated.",
        });
      }
    });
  }

  return (
    <div className="platform-access-workspace">
      {feedback ? <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback> : null}
      {!directory.mfaVerified ? (
        <section className="platform-warning" role="alert">
          Verify multi-factor authentication before granting, changing, or suspending platform access.
        </section>
      ) : null}

      <section className="platform-access-summary" aria-label="Platform access summary">
        <article><span>Active operators</span><b>{metrics.active}</b></article>
        <article><span>Active superadmins</span><b>{metrics.superadmins}</b></article>
        <article><span>Suspended</span><b>{metrics.suspended}</b></article>
        <article className={metrics.mfaCoverage < 100 ? "has-attention" : ""}>
          <span>Active MFA coverage</span><b>{metrics.mfaCoverage}%</b>
        </article>
      </section>

      <details className="platform-access-drawer">
        <summary>
          <span>Grant platform access</span>
          <small>Registered, verified accounts with authenticator MFA only</small>
        </summary>
        <form onSubmit={grant}>
          <FormField label="Registered account email">
            <input name="email" type="email" autoComplete="off" required maxLength={320} />
          </FormField>
          <FormField label="Platform role">
            <select name="role" defaultValue="platform_admin">
              <option value="platform_admin">Platform admin — operations</option>
              <option value="superadmin">Superadmin — full authority</option>
            </select>
          </FormField>
          <FormField label="Operational reason">
            <textarea
              name="reason"
              minLength={12}
              maxLength={500}
              placeholder="Why does this account need platform authority?"
              required
            />
          </FormField>
          <FormField label="Type the registered email to confirm">
            <input name="confirmation" type="email" autoComplete="off" required maxLength={320} />
          </FormField>
          <p className="platform-impact-note">
            Platform authority never creates an agency membership. The account must already have a verified email and authenticator MFA.
          </p>
          <Button type="submit" disabled={pending || !directory.mfaVerified}>
            {pending ? "Working…" : "Review and grant access"}
          </Button>
        </form>
      </details>

      <section className="platform-role-guide" aria-labelledby="platform-role-guide-title">
        <header>
          <div>
            <p>AUTHORITY MODEL</p>
            <h2 id="platform-role-guide-title">
              Two roles, deliberately separate from tenant access
            </h2>
          </div>
        </header>
        <div>
          <article>
            <b>Platform admin</b>
            <p>Agency registry, service health, usage, audit, and platform configuration.</p>
          </article>
          <article>
            <b>Superadmin</b>
            <p>All platform-admin capabilities plus identities, commercial controls, and platform access governance.</p>
          </article>
          <article>
            <b>Neither role</b>
            <p>Can open an agency CRM unless that person also has an explicit membership in that agency.</p>
          </article>
        </div>
      </section>

      <section className="platform-access-list" aria-label="Platform operators">
        <header>
          <div>
            <p>OPERATOR DIRECTORY</p>
            <h2>{directory.operators.length} platform accounts</h2>
          </div>
          <button
            className="platform-text-button"
            type="button"
            disabled={pending}
            onClick={refresh}
          >
            Refresh directory
          </button>
        </header>
        {directory.operators.map((operator) => {
          const isSelf = operator.userId === directory.currentUserId;
          return (
            <article
              key={operator.userId}
              className={operator.status === "suspended" ? "is-suspended" : ""}
            >
              <div className="platform-access-identity">
                <b>{operator.fullName}</b>
                <span>{operator.email || "Email unavailable"}</span>
                <small>Granted by {operator.grantedBy} · {dateLabel(operator.grantedAt)}</small>
              </div>
              <div className="platform-access-badges" aria-label="Authority and security state">
                <span>{roleLabel(operator.role)}</span>
                <span className={operator.status === "active" ? "is-positive" : "is-danger"}>
                  {statusLabel(operator.status)}
                </span>
                <span className={operator.emailVerified ? "is-positive" : "is-danger"}>
                  {operator.emailVerified ? "Email verified" : "Email unverified"}
                </span>
                <span className={operator.mfaEnrolled ? "is-positive" : "is-danger"}>
                  {operator.mfaEnrolled ? "MFA enrolled" : "MFA missing"}
                </span>
              </div>
              <div className="platform-access-activity">
                <small>Last sign-in</small>
                <b>{dateLabel(operator.lastSignInAt)}</b>
                <span>Record version {operator.version}</span>
              </div>
              {isSelf ? (
                <span className="platform-current-account">Current account</span>
              ) : (
                <Button
                  disabled={pending || !directory.mfaVerified}
                  onClick={() => setReviewing(operator)}
                  type="button"
                  variant="secondary"
                >
                  Review access
                </Button>
              )}
            </article>
          );
        })}
      </section>

      {reviewing ? (
        <AccessReviewDialog
          key={`${reviewing.userId}:${reviewing.version}`}
          operator={reviewing}
          pending={pending}
          onClose={() => setReviewing(null)}
          onSubmit={applyAccess}
        />
      ) : null}
    </div>
  );
}
