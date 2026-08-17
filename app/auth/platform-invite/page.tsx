import type { Metadata } from "next";
import Link from "next/link";

import {
  getPlatformOperatorInvitationPreview,
  switchPlatformInvitationAccount,
} from "../../actions/platform-invitations";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { PlatformInviteAcceptance } from "./platform-invite-client";
import "../invite/invite.css";

export const metadata: Metadata = {
  title: "Platform invitation — AIOS",
  description: "Review a protected AIOS platform operator invitation.",
};

export const dynamic = "force-dynamic";

function roleLabel(role: "superadmin" | "platform_admin") {
  return role === "superadmin" ? "Platform superadmin" : "Platform admin";
}

function expiryLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function PlatformInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const preview = await getPlatformOperatorInvitationPreview();
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const signedIn = Boolean(claims?.claims.sub);
  const { data: factors } = signedIn
    ? await supabase.auth.mfa.listFactors()
    : { data: null };
  const hasVerifiedTotp = Boolean(
    factors?.totp.some((factor) => factor.status === "verified"),
  );
  const aal2 = claims?.claims.aal === "aal2";
  const invitationPath = "/auth/platform-invite";
  const statusMessage = error === "invalid"
    ? "This invitation link is invalid, expired, or no longer available."
    : !preview
    ? "This invitation link is incomplete, invalid, or no longer available."
    : preview.status === "expired"
      ? "This invitation has expired. Ask a platform superadmin to resend it."
      : preview.status === "accepted"
        ? "This invitation has already been accepted."
        : preview.status === "revoked"
          ? "This invitation was revoked by a platform superadmin."
          : null;

  return (
    <main className="auth-page invite-page" id="main-content" tabIndex={-1}>
      <section className="auth-card invite-card">
        <Link href="/" className="auth-brand">
          <span>A</span> AIOS
        </Link>
        <div className="invite-mark" aria-hidden="true">2</div>
        <p className="eyebrow">PLATFORM AUTHORITY INVITATION</p>
        <h1>Join the protected control plane.</h1>
        {statusMessage ? (
          <>
            <p>{statusMessage}</p>
            <Link className="auth-secondary" href="/sign-in">
              Return to sign in
            </Link>
          </>
        ) : preview ? (
          <>
            <p>
              <strong>{roleLabel(preview.role)}</strong> access was invited for{" "}
              <strong>{preview.emailHint}</strong>. The one-time invitation expires{" "}
              {expiryLabel(preview.expiresAt)}.
            </p>
            {!signedIn ? (
              <div className="invite-actions">
                <Link
                  className="invite-primary-link"
                  href={`/sign-in?next=${encodeURIComponent(invitationPath)}`}
                >
                  Sign in with the invited email
                </Link>
                <Link
                  className="auth-secondary"
                  href={`/sign-up?next=${encodeURIComponent(invitationPath)}`}
                >
                  Create and verify an account
                </Link>
              </div>
            ) : !hasVerifiedTotp ? (
              <div className="invite-actions">
                <p>
                  Enroll and verify an authenticator before platform authority can
                  be activated.
                </p>
                <Link
                  className="invite-primary-link"
                  href={`/account/security?reason=platform-mfa&next=${encodeURIComponent(invitationPath)}`}
                >
                  Set up authenticator
                </Link>
                <form action={switchPlatformInvitationAccount}>
                  <button className="auth-secondary" type="submit">
                    Use a different account
                  </button>
                </form>
              </div>
            ) : !aal2 ? (
              <div className="invite-actions">
                <p>Verify the current authenticator code to continue.</p>
                <Link
                  className="invite-primary-link"
                  href={`/auth/mfa?next=${encodeURIComponent(invitationPath)}`}
                >
                  Verify authenticator
                </Link>
              </div>
            ) : (
              <>
                <p>
                  Your verified email and authenticator are ready. Acceptance
                  activates only platform authority; it creates no agency or tenant
                  membership.
                </p>
                <PlatformInviteAcceptance />
              </>
            )}
          </>
        ) : null}
        <ul className="invite-assurances">
          <li>The invitation token is single-use and stored only as a hash.</li>
          <li>Verified email, TOTP, and an AAL2 session are mandatory.</li>
          <li>No tenant workspace or customer-data access is created.</li>
        </ul>
      </section>
    </main>
  );
}
