"use client";

import { type FormEvent, useState, useTransition } from "react";

import {
  getPlatformAgencyDetail,
  resendPlatformAgencyOwnerInvitation,
} from "../../app/actions/platform";
import { Button } from "../ui/button";

type AgencyDetail = Awaited<ReturnType<typeof getPlatformAgencyDetail>>;
type Invitation = AgencyDetail["ownerInvitations"][number];

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function PlatformAgencyInvitations({ initial }: { initial: AgencyDetail }) {
  const [detail, setDetail] = useState(initial);
  const [selected, setSelected] = useState<Invitation | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setError("");
    setFeedback("");
    startTransition(async () => {
      try {
        const result = await resendPlatformAgencyOwnerInvitation({
          organizationId: detail.organization.id,
          invitationId: selected.id,
          reason: form.get("reason"),
          confirmation: form.get("confirmation"),
        });
        setDetail(await getPlatformAgencyDetail({ organizationId: detail.organization.id }));
        setSelected(null);
        setFeedback(
          result.invitationDelivery === "sent"
            ? "A new one-time owner invitation was sent."
            : "The invitation was rotated, but delivery is pending platform email availability.",
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The invitation could not be rotated.");
      }
    });
  }

  return (
    <section className="platform-panel platform-panel-stack" aria-labelledby="agency-owner-invitations-title">
      <header>
        <div><p>OWNER ONBOARDING</p><h2 id="agency-owner-invitations-title">Agency invitations</h2></div>
      </header>
      {feedback ? <p className="platform-invitation-feedback" role="status">{feedback}</p> : null}
      <div className="platform-recent-list">
        {detail.ownerInvitations.length ? detail.ownerInvitations.map((invitation) => (
          <div key={invitation.id}>
            <span><b>{invitation.email}</b><small>{invitation.status} · expires {dateLabel(invitation.expiresAt)}</small></span>
            {detail.canResendOwnerInvitations ? (
              <Button type="button" variant="secondary" disabled={pending || !detail.mfaVerified} onClick={() => setSelected(invitation)}>Rotate & resend</Button>
            ) : <small>Read only</small>}
          </div>
        )) : <p>No pending owner invitation is recorded.</p>}
      </div>
      {detail.canResendOwnerInvitations && !detail.mfaVerified ? <small>Complete MFA to rotate an owner invitation.</small> : null}
      {selected ? (
        <form className="platform-invitation-form" onSubmit={submit}>
          <label>Reason<textarea name="reason" required minLength={12} maxLength={500} placeholder="Approved owner onboarding retry…" /></label>
          <label>Type <b>{detail.organization.slug}</b> to confirm<input name="confirmation" required autoComplete="off" /></label>
          <p className="platform-impact-note">The previous token is revoked atomically. Only the new one-time link can be accepted.</p>
          {error ? <p className="platform-form-error" role="alert">{error}</p> : null}
          <div className="platform-card-actions"><Button type="submit" disabled={pending}>{pending ? "Rotating…" : "Rotate and send"}</Button><Button type="button" variant="secondary" disabled={pending} onClick={() => setSelected(null)}>Cancel</Button></div>
        </form>
      ) : null}
    </section>
  );
}
