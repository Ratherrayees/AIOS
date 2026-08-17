import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthorityWorkspaceChooser } from "../../components/platform/authority-workspace-chooser";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import type { WorkspaceChoice } from "../../lib/workspace/active-workspace";

export default async function ChooseWorkspacePage() {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) redirect("/sign-in");
  const [{ data: memberships, error: membershipError }, platform] =
    await Promise.all([
      supabase
        .from("memberships")
        .select("organization_id, role, organizations(name)")
        .eq("status", "active")
        .order("created_at"),
      supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", claims.claims.sub)
        .eq("status", "active")
        .maybeSingle(),
    ]);
  if (membershipError) throw membershipError;
  if (platform.error) throw platform.error;
  const workspaces: WorkspaceChoice[] = (memberships || []).map((membership) => ({
    organization_id: membership.organization_id,
    name: membership.organizations?.name || "Travel workspace",
    role: membership.role,
  }));
  if (!platform.data && workspaces.length <= 1) redirect("/");
  if (platform.data && workspaces.length === 0) redirect("/platform");

  return (
    <main className="authority-choice-page" id="main-content" tabIndex={-1}>
      <section className="authority-choice-shell">
        <Link href="/" className="auth-brand"><span>A</span> AIOS</Link>
        <p className="eyebrow">CHOOSE OPERATING CONTEXT</p>
        <h1>Where are you working?</h1>
        <p>Your authorities remain separate. Entering the platform never grants access to an agency’s customer records.</p>
        <AuthorityWorkspaceChooser
          hasPlatformAccess={Boolean(platform.data)}
          workspaces={workspaces}
        />
      </section>
    </main>
  );
}
