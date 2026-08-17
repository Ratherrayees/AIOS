"use client";

import { type FormEvent, useState, useTransition } from "react";

import {
  getPlatformIdentityDetail,
  runPlatformIdentitySecurityAction,
  updatePlatformIdentityStatus,
} from "../../app/actions/platform";
import { Button } from "../ui/button";
import { FormFeedback, FormField } from "../ui/form-field";

type IdentityDetail = Awaited<ReturnType<typeof getPlatformIdentityDetail>>;
type SecurityAction =
  | "suspend"
  | "restore"
  | "revoke_sessions"
  | "require_password_reset";

const actionContent: Record<SecurityAction, { title: string; description: string; submit: string }> = {
  suspend: {
    title: "Suspend authentication account",
    description: "Blocks AIOS immediately, revokes refresh sessions, and prevents new sign-ins.",
    submit: "Suspend account",
  },
  restore: {
    title: "Restore authentication account",
    description: "Allows new sign-ins again. Existing revoked sessions remain invalid.",
    submit: "Restore account",
  },
  revoke_sessions: {
    title: "Revoke all sessions",
    description: "Signs the account out everywhere and rejects already-issued AIOS access tokens.",
    submit: "Revoke sessions",
  },
  require_password_reset: {
    title: "Require a password reset",
    description: "Revokes current sessions and requires a new password after the next sign-in.",
    submit: "Require password reset",
  },
};

export function PlatformIdentitySecurity({ initial }: { initial: IdentityDetail }) {
  const [detail, setDetail] = useState(initial);
  const [selectedAction, setSelectedAction] = useState<SecurityAction | null>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const isSelf = detail.identity.userId === detail.currentUserId;
  const protectedOperator = detail.platformAuthority?.status === "active";
  const confirmationValue = detail.identity.email || detail.identity.userId;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAction || pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (String(data.get("confirmation") || "") !== confirmationValue) {
      setFeedback({ tone: "error", message: "Enter the exact account email to confirm." });
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      try {
        const common = {
          userId: detail.identity.userId,
          reason: String(data.get("reason") || ""),
          confirmation: String(data.get("confirmation") || ""),
          expectedVersion: detail.security.version,
        };
        if (selectedAction === "suspend" || selectedAction === "restore") {
          await updatePlatformIdentityStatus({
            ...common,
            status: selectedAction === "suspend" ? "suspended" : "active",
          });
        } else {
          await runPlatformIdentitySecurityAction({
            ...common,
            action: selectedAction,
          });
        }
        const refreshed = await getPlatformIdentityDetail({ userId: detail.identity.userId });
        setDetail(refreshed);
        setSelectedAction(null);
        setFeedback({ tone: "success", message: `${actionContent[selectedAction].title} completed.` });
      } catch (actionError) {
        setFeedback({
          tone: "error",
          message: actionError instanceof Error ? actionError.message : "The identity security action could not be completed.",
        });
      }
    });
  }

  return (
    <section className="platform-identity-workspace">
      {feedback ? <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback> : null}
      {!detail.security.providerStatusAligned ? (
        <div className="platform-warning" role="alert">Provider and AIOS account status are not aligned. Retry the status action before closing this case.</div>
      ) : null}
      {!detail.mfaVerified && detail.canManageIdentities ? (
        <div className="platform-warning" role="alert">Verify multi-factor authentication before changing account security.</div>
      ) : null}
      <div className="platform-overview-grid platform-security-grid">
        <article className="platform-panel platform-panel-stack">
          <header><div><p>ACCOUNT ACCESS</p><h2>{detail.security.status === "active" ? "Active" : "Suspended"}</h2></div></header>
          <p>Authentication status is enforced by AIOS and synchronized with Supabase Auth.</p>
          {detail.canManageIdentities ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !detail.mfaVerified || isSelf || (detail.security.status === "active" && protectedOperator)}
              onClick={() => setSelectedAction(detail.security.status === "active" ? "suspend" : "restore")}
            >
              {detail.security.status === "active" ? "Suspend account" : "Restore account"}
            </Button>
          ) : <small>Read-only for platform administrators.</small>}
        </article>
        <article className="platform-panel platform-panel-stack">
          <header><div><p>ACTIVE SESSIONS</p><h2>Global revocation</h2></div></header>
          <p>Valid after {new Date(detail.security.sessionsValidAfter).toLocaleString("en-IN")}</p>
          {detail.canManageIdentities ? (
            <Button type="button" variant="secondary" disabled={pending || !detail.mfaVerified || isSelf} onClick={() => setSelectedAction("revoke_sessions")}>Revoke all sessions</Button>
          ) : <small>Read-only for platform administrators.</small>}
        </article>
        <article className="platform-panel platform-panel-stack">
          <header><div><p>PASSWORD</p><h2>{detail.security.passwordResetRequired ? "Reset required" : "No reset required"}</h2></div></header>
          <p>The user chooses their own replacement password; operators never see or set it.</p>
          {detail.canManageIdentities ? (
            <Button type="button" variant="secondary" disabled={pending || !detail.mfaVerified || isSelf || detail.security.passwordResetRequired || detail.security.status !== "active"} onClick={() => setSelectedAction("require_password_reset")}>Require password reset</Button>
          ) : <small>Read-only for platform administrators.</small>}
        </article>
      </div>
      {selectedAction ? (
        <section className="platform-access-drawer platform-identity-action" aria-label="Identity security confirmation">
          <header><div><b>{actionContent[selectedAction].title}</b><p>{actionContent[selectedAction].description}</p></div><button type="button" onClick={() => setSelectedAction(null)} aria-label="Close security action">×</button></header>
          <form onSubmit={submit}>
            <FormField label="Security reason"><textarea name="reason" required minLength={12} maxLength={500} placeholder="Record the security or support reason. Do not include customer content." /></FormField>
            <FormField label={`Type “${confirmationValue}” to confirm`}><input name="confirmation" required autoComplete="off" /></FormField>
            <div className="platform-card-actions"><Button type="submit" disabled={pending}>{pending ? "Applying…" : actionContent[selectedAction].submit}</Button><Button type="button" variant="secondary" disabled={pending} onClick={() => setSelectedAction(null)}>Cancel</Button></div>
          </form>
        </section>
      ) : null}
    </section>
  );
}
