"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";

import {
  createPlatformOperatorInvitation,
  getPlatformOperatorInvitationDirectory,
  resendPlatformOperatorInvitation,
  revokePlatformOperatorInvitation,
} from "../../app/actions/platform-invitations";
import { Button } from "../ui/button";
import { FormFeedback, FormField } from "../ui/form-field";
import { ModalBoundary } from "../ui/modal-boundary";

type InvitationDirectory = Awaited<
  ReturnType<typeof getPlatformOperatorInvitationDirectory>
>;
type PlatformInvitation = InvitationDirectory["invitations"][number];

function dateTimeLabel(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function roleLabel(role: PlatformInvitation["role"]) {
  return role === "superadmin" ? "Superadmin" : "Platform admin";
}

function statusLabel(status: PlatformInvitation["status"]) {
  const labels = {
    pending: "Pending acceptance",
    expired: "Expired",
    accepted: "Accepted",
    revoked: "Revoked",
  } as const;
  return labels[status];
}

function InvitationReviewDialog({
  invitation,
  pending,
  onClose,
  onComplete,
}: {
  invitation: PlatformInvitation;
  pending: boolean;
  onClose: () => void;
  onComplete: (
    action: "resend" | "revoke",
    input: {
      invitationId: string;
      reason: string;
      confirmation: string;
      expectedVersion: number;
    },
  ) => void;
}) {
  const [action, setAction] = useState<"resend" | "revoke">(
    invitation.status === "expired" || invitation.deliveryStatus === "pending"
      ? "resend"
      : "revoke",
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onComplete(action, {
      invitationId: invitation.id,
      reason: String(data.get("reason") || ""),
      confirmation: String(data.get("confirmation") || ""),
      expectedVersion: invitation.version,
    });
  }

  return (
    <ModalBoundary className="platform-modal-layer" onClose={onClose}>
      <section
        aria-describedby="platform-invitation-review-description"
        aria-labelledby="platform-invitation-review-title"
        aria-modal="true"
        className="platform-access-review platform-invitation-review"
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p>INVITATION CONTROL</p>
            <h2 id="platform-invitation-review-title">Review {invitation.email}</h2>
            <span id="platform-invitation-review-description">
              Rotate the one-time token by resending, or permanently revoke this invitation.
            </span>
          </div>
          <button aria-label="Close invitation review" onClick={onClose} type="button">×</button>
        </header>
        <form onSubmit={submit}>
          <div className="platform-invitation-choice" role="radiogroup" aria-label="Invitation action">
            <label className={action === "resend" ? "is-selected" : ""}>
              <input
                checked={action === "resend"}
                name="invitationAction"
                onChange={() => setAction("resend")}
                type="radio"
                value="resend"
              />
              <span>
                <b>Resend invitation</b>
                <small>Invalidate the old token and issue a new seven-day invitation.</small>
              </span>
            </label>
            <label className={action === "revoke" ? "is-selected is-danger" : ""}>
              <input
                checked={action === "revoke"}
                name="invitationAction"
                onChange={() => setAction("revoke")}
                type="radio"
                value="revoke"
              />
              <span>
                <b>Revoke invitation</b>
                <small>Permanently prevent the current link from being accepted.</small>
              </span>
            </label>
          </div>
          <FormField label="Operational reason">
            <textarea
              name="reason"
              minLength={12}
              maxLength={500}
              placeholder={
                action === "resend"
                  ? "Why is a replacement invitation needed?"
                  : "Why is this invitation being revoked?"
              }
              required
            />
          </FormField>
          <FormField label={`Type ${invitation.email} to confirm`}>
            <input name="confirmation" type="email" autoComplete="off" required />
          </FormField>
          <p className={`platform-impact-note${action === "revoke" ? " is-danger" : ""}`}>
            {action === "resend"
              ? "Resending rotates the bearer token. The current link stops working immediately, even if email delivery is still pending."
              : "Revocation cannot be undone. You can create a new invitation later after another explicit review."}
          </p>
          <div className="platform-card-actions">
            <Button
              className={action === "revoke" ? "platform-danger-button" : ""}
              disabled={pending}
              type="submit"
            >
              {pending
                ? "Applying…"
                : action === "resend"
                  ? "Rotate and resend"
                  : "Revoke invitation"}
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

export function PlatformOperatorInvitations({
  initial,
}: {
  initial: InvitationDirectory;
}) {
  const [directory, setDirectory] = useState(initial);
  const [reviewing, setReviewing] = useState<PlatformInvitation | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const counts = useMemo(
    () => ({
      pending: directory.invitations.filter(
        (invitation) => invitation.status === "pending",
      ).length,
      expired: directory.invitations.filter(
        (invitation) => invitation.status === "expired",
      ).length,
    }),
    [directory.invitations],
  );

  function refresh() {
    return getPlatformOperatorInvitationDirectory().then(setDirectory);
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await createPlatformOperatorInvitation({
          email: String(data.get("email") || ""),
          role: String(data.get("role") || "platform_admin"),
          expiresInDays: Number(data.get("expiresInDays") || 7),
          reason: String(data.get("reason") || ""),
          confirmation: String(data.get("confirmation") || ""),
        });
        await refresh();
        form.reset();
        setFeedback({
          tone: result.deliveryStatus === "sent" ? "success" : "error",
          message:
            result.deliveryStatus === "sent"
              ? "Platform invitation sent. The recipient must verify email and authenticator MFA before acceptance."
              : "Invitation created securely, but email delivery is pending. Configure the platform sender, then review and resend it.",
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "The platform invitation could not be created.",
        });
      }
    });
  }

  function completeReview(
    action: "resend" | "revoke",
    input: {
      invitationId: string;
      reason: string;
      confirmation: string;
      expectedVersion: number;
    },
  ) {
    setFeedback(null);
    startTransition(async () => {
      try {
        if (action === "resend") {
          const result = await resendPlatformOperatorInvitation(input);
          setFeedback({
            tone: result.deliveryStatus === "sent" ? "success" : "error",
            message:
              result.deliveryStatus === "sent"
                ? "The old token was invalidated and a replacement invitation was sent."
                : "The old token was invalidated, but replacement delivery is pending. Check the platform sender before retrying.",
          });
        } else {
          await revokePlatformOperatorInvitation(input);
          setFeedback({
            tone: "success",
            message: "The invitation was revoked and can no longer be accepted.",
          });
        }
        await refresh();
        setReviewing(null);
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "The invitation action could not be completed.",
        });
      }
    });
  }

  return (
    <section className="platform-operator-invitations" aria-labelledby="platform-invitations-title">
      <header>
        <div>
          <p>PLATFORM-ONLY ONBOARDING</p>
          <h2 id="platform-invitations-title">Operator invitations</h2>
          <span>
            {counts.pending} pending · {counts.expired} expired · no tenant workspace created
          </span>
        </div>
      </header>
      <div className="platform-invitation-content">
        {feedback ? <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback> : null}
        <details className="platform-invitation-create">
          <summary>
            <span>Invite a platform operator</span>
            <small>Email OTP + authenticator MFA are required before activation</small>
          </summary>
          <form onSubmit={create}>
            <FormField label="Invited email">
              <input name="email" type="email" autoComplete="off" maxLength={320} required />
            </FormField>
            <FormField label="Platform role">
              <select name="role" defaultValue="platform_admin">
                <option value="platform_admin">Platform admin — operations</option>
                <option value="superadmin">Superadmin — full authority</option>
              </select>
            </FormField>
            <FormField label="Invitation lifetime">
              <select name="expiresInDays" defaultValue="7">
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
              </select>
            </FormField>
            <FormField label="Operational reason">
              <textarea
                name="reason"
                minLength={12}
                maxLength={500}
                placeholder="Why does this person need platform authority?"
                required
              />
            </FormField>
            <FormField label="Type the invited email to confirm">
              <input name="confirmation" type="email" autoComplete="off" required />
            </FormField>
            <p className="platform-impact-note">
              The invitation is sent by the platform transactional sender. Account-verification OTPs are sent separately by auth@lumierah.in.
            </p>
            <Button disabled={pending || !directory.mfaVerified} type="submit">
              {pending ? "Creating invitation…" : "Create and send invitation"}
            </Button>
          </form>
        </details>

        <div className="platform-invitation-directory">
          {directory.invitations.length ? (
            directory.invitations.map((invitation) => (
              <article key={invitation.id}>
                <div className="platform-invitation-identity">
                  <b>{invitation.email}</b>
                  <span>{roleLabel(invitation.role)} · invited by {invitation.invitedBy}</span>
                  <small>Reason: {invitation.reason}</small>
                </div>
                <div className="platform-invitation-state">
                  <span className={`is-${invitation.status}`}>
                    {statusLabel(invitation.status)}
                  </span>
                  <em className={invitation.deliveryStatus === "sent" ? "is-sent" : "is-pending"}>
                    Email {invitation.deliveryStatus}
                  </em>
                </div>
                <div className="platform-invitation-dates">
                  <small>Expires</small>
                  <b>{dateTimeLabel(invitation.expiresAt)}</b>
                  <span>Created {dateTimeLabel(invitation.createdAt)}</span>
                </div>
                {invitation.status === "pending" || invitation.status === "expired" ? (
                  <Button
                    disabled={pending || !directory.mfaVerified}
                    onClick={() => setReviewing(invitation)}
                    type="button"
                    variant="secondary"
                  >
                    Review invitation
                  </Button>
                ) : (
                  <span className="platform-invitation-complete">
                    {invitation.status === "accepted"
                      ? `Accepted ${dateTimeLabel(invitation.acceptedAt)}`
                      : `Revoked ${dateTimeLabel(invitation.revokedAt)}`}
                  </span>
                )}
              </article>
            ))
          ) : (
            <div className="platform-invitation-empty">
              <b>No platform invitations yet</b>
              <p>Invite unregistered operators here instead of creating a customer agency for them.</p>
            </div>
          )}
        </div>
      </div>
      {reviewing ? (
        <InvitationReviewDialog
          key={`${reviewing.id}:${reviewing.version}`}
          invitation={reviewing}
          pending={pending}
          onClose={() => setReviewing(null)}
          onComplete={completeReview}
        />
      ) : null}
    </section>
  );
}
