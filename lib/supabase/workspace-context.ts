"use client";

import { createSupabaseBrowserClient } from "./browser";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  chooseActiveWorkspace,
  type WorkspaceChoice,
} from "../workspace/active-workspace";

type BrowserSupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;

export async function loadWorkspaceContext(
  supabase: BrowserSupabaseClient,
): Promise<{
  active: WorkspaceChoice | null;
  workspaces: WorkspaceChoice[];
}> {
  const { data: membershipRows, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (membershipError) throw membershipError;
  if (!membershipRows?.length) return { active: null, workspaces: [] };

  const organizationIds = membershipRows.map(
    (membership) => membership.organization_id,
  );
  const { data: organizationRows, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", organizationIds);

  if (organizationError) throw organizationError;

  const organizationNames = new Map(
    (organizationRows || []).map((organization) => [
      organization.id,
      organization.name,
    ]),
  );
  const workspaces: WorkspaceChoice[] = membershipRows.map((membership) => ({
    organization_id: membership.organization_id,
    name:
      organizationNames.get(membership.organization_id) || "Travel workspace",
    role: membership.role,
  }));

  // The preference selects only from RLS-filtered memberships; it is never an
  // authorization source and cannot grant access to an arbitrary tenant.
  const preferredOrganizationId = window.localStorage.getItem(
    ACTIVE_WORKSPACE_STORAGE_KEY,
  );
  const active = chooseActiveWorkspace(workspaces, preferredOrganizationId);

  if (active && active.organization_id !== preferredOrganizationId) {
    window.localStorage.setItem(
      ACTIVE_WORKSPACE_STORAGE_KEY,
      active.organization_id,
    );
  }

  return { active, workspaces };
}

export function saveActiveWorkspace(
  organizationId: string,
  availableWorkspaces: WorkspaceChoice[],
) {
  if (
    !availableWorkspaces.some(
      (workspace) => workspace.organization_id === organizationId,
    )
  ) {
    throw new Error("That workspace is not available to this account.");
  }

  window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, organizationId);
}
