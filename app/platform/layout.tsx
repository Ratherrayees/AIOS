import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PlatformShell } from "../../components/platform/platform-shell";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import {
  PlatformAuthorizationError,
  requirePlatformRole,
} from "../../lib/platform/authorization";
import "./platform.css";

export const metadata: Metadata = {
  title: "Platform administration — AIOS",
  description: "Protected AIOS platform operations and service configuration.",
};

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let access;
  try {
    access = await requirePlatformRole();
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      if (error.code === "unauthenticated") redirect("/sign-in?next=%2Fplatform");
      redirect("/access-denied/platform");
    }
    throw error;
  }
  const supabase = await createSupabaseServerClient();
  if (!access.mfa_verified) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const hasVerifiedTotp = Boolean(
      factors?.totp.some((factor) => factor.status === "verified"),
    );
    redirect(
      hasVerifiedTotp
        ? "/auth/mfa?next=%2Fplatform"
        : "/account/security?reason=platform-mfa&next=%2Fplatform",
    );
  }
  const { count: agencyWorkspaceCount } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  return (
    <PlatformShell
      hasAgencyWorkspace={Boolean(agencyWorkspaceCount)}
      mfaVerified={access.mfa_verified}
      role={access.role}
      userName={access.full_name}
    >
      {children}
    </PlatformShell>
  );
}
