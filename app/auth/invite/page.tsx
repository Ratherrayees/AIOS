import Link from "next/link";

import { organizationInvitationAcceptSchema } from "../../../lib/crm/schemas";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { InviteAcceptance } from "./invite-client";
import "./invite.css";

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const parsed = organizationInvitationAcceptSchema.safeParse({ token });
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const signedIn = Boolean(claims?.claims.sub);

  const invitationPath = parsed.success
    ? `/auth/invite?token=${encodeURIComponent(parsed.data.token)}`
    : "/auth/invite";

  return (
    <main className="auth-page invite-page" id="main-content" tabIndex={-1}>
      <section className="auth-card invite-card">
        <Link href="/" className="auth-brand">
          <span>A</span>
          AIOS
        </Link>
        <div className="invite-mark" aria-hidden="true">
          ↗
        </div>
        <p className="eyebrow">WORKSPACE INVITATION</p>
        <h1>Join with a verified identity.</h1>
        {!parsed.success ? (
          <>
            <p>
              This invitation link is incomplete or malformed. Ask the
              workspace owner for a fresh invitation.
            </p>
            <Link className="auth-secondary" href="/sign-in">
              Return to sign in
            </Link>
          </>
        ) : !signedIn ? (
          <>
            <p>
              Sign in using the same verified email address that received this
              invitation. AIOS will reject a different identity.
            </p>
            <div className="invite-actions">
              <Link
                className="invite-primary-link"
                href={`/sign-in?next=${encodeURIComponent(invitationPath)}`}
              >
                Sign in to continue
              </Link>
              <Link
                className="auth-secondary"
                href={`/sign-up?next=${encodeURIComponent(invitationPath)}`}
              >
                Create a secure account
              </Link>
            </div>
          </>
        ) : (
          <>
            <p>
              AIOS will verify your signed-in email, invitation status, expiry,
              and tenant boundary in one atomic transaction.
            </p>
            <InviteAcceptance token={parsed.data.token} />
          </>
        )}
        <ul className="invite-assurances">
          <li>Invitation links expire after seven days.</li>
          <li>Role and membership changes are audit logged.</li>
          <li>AIOS cannot accept or elevate access on your behalf.</li>
        </ul>
      </section>
    </main>
  );
}
