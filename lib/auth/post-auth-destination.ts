import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../types/app-database";
import { readPreferredAuthorityContext } from "./authority-context";
import { chooseAuthorityDestination } from "./authority-destination";

export async function resolvePostAuthDestination(
  supabase: SupabaseClient<Database>,
  requestedPath: string,
) {
  if (requestedPath !== "/") return requestedPath;
  const [{ count: activeWorkspaceCount, error: membershipError }, platform] =
    await Promise.all([
      supabase
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("platform_admins")
        .select("user_id")
        .eq("status", "active")
        .maybeSingle(),
    ]);
  if (membershipError) throw membershipError;
  if (platform.error) throw platform.error;
  const preferredAuthority = await readPreferredAuthorityContext();
  return chooseAuthorityDestination({
    requestedPath,
    activeWorkspaceCount: activeWorkspaceCount ?? 0,
    hasPlatformAccess: Boolean(platform.data),
    preferredAuthority,
  });
}
