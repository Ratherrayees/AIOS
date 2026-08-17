import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "../../../components/ui/button";
import { safeInternalPath } from "../../../lib/auth/safe-next";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { signOut } from "../../sign-out/actions";
import { MfaChallenge } from "./mfa-client";
import "./mfa.css";

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const requestedPath = safeInternalPath(params.next);
  const nextPath = requestedPath.startsWith("/auth/mfa")
    ? "/"
    : requestedPath;
  const platformIntent =
    nextPath.startsWith("/platform") || nextPath === "/auth/platform-invite";
  const accountSecurityPath = platformIntent
    ? `/account/security?reason=platform-mfa&next=${encodeURIComponent(nextPath)}`
    : `/account/security?next=${encodeURIComponent(nextPath)}`;

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  }

  if (platformIntent) {
    const { data: factors, error: factorError } =
      await supabase.auth.mfa.listFactors();
    const hasVerifiedTotp = factors?.totp.some(
      (factor) => factor.status === "verified",
    );
    if (factorError || !hasVerifiedTotp) redirect(accountSecurityPath);
  }

  const { data: meetsMfaRequirement } = await supabase.rpc(
    "meets_mfa_requirement",
  );
  if (meetsMfaRequirement) redirect(nextPath);

  return (
    <main className="auth-page mfa-page" id="main-content" tabIndex={-1}>
      <section className="auth-card mfa-card">
        <Link href="/" className="auth-brand">
          <span>A</span>
          AIOS
        </Link>
        <div className="mfa-shield" aria-hidden="true">
          2
        </div>
        <p className="eyebrow">SECOND FACTOR</p>
        <h1>Verify it&apos;s really you.</h1>
        <p>
          {platformIntent
            ? "Enter the current code from your authenticator app to continue to protected platform administration."
            : "Enter the current code from your authenticator app to continue to your protected AIOS workspace."}
        </p>
        <MfaChallenge
          accountSecurityPath={accountSecurityPath}
          nextPath={nextPath}
        />
        <form className="mfa-signout" action={signOut}>
          <Button type="submit" variant="ghost" fullWidth>
            Sign out instead
          </Button>
        </form>
      </section>
    </main>
  );
}
