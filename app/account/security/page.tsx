import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountSecurityPanel } from "../../../components/account/account-security-panel";
import { safeInternalPath } from "../../../lib/auth/safe-next";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { signOut } from "../../sign-out/actions";
import "../../settings/security/security.css";

export const metadata: Metadata = {
  title: "Account security — AIOS",
  description: "Manage authenticator protection for your AIOS account.",
};

export default async function AccountSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const requestedPath = safeInternalPath(params.next);
  const continueTo = requestedPath.startsWith("/account/security")
    ? "/"
    : requestedPath;

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) {
    const returnPath = `/account/security?next=${encodeURIComponent(continueTo)}`;
    redirect(`/sign-in?next=${encodeURIComponent(returnPath)}`);
  }

  const { data: platformAccess, error: platformAccessError } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (platformAccessError) throw platformAccessError;
  const platformRequired = Boolean(platformAccess) || params.reason === "platform-mfa";

  return (
    <main
      className="security-page account-security-page"
      id="main-content"
      tabIndex={-1}
    >
      <header className="account-security-topbar">
        <Link href="/" className="auth-brand">
          <span>A</span> AIOS
        </Link>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <AccountSecurityPanel
        continueTo={continueTo === "/" ? undefined : continueTo}
        platformRequired={platformRequired}
        surface="account"
      />
    </main>
  );
}
