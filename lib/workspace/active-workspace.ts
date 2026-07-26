import type { Database } from "../../types/database";

export const ACTIVE_WORKSPACE_STORAGE_KEY = "aios.active-organization";

export type WorkspaceRole =
  Database["public"]["Tables"]["memberships"]["Row"]["role"];

export type WorkspaceChoice = {
  organization_id: string;
  name: string;
  role: WorkspaceRole;
};

export function chooseActiveWorkspace(
  workspaces: WorkspaceChoice[],
  preferredOrganizationId: string | null,
) {
  if (workspaces.length === 0) return null;
  if (!preferredOrganizationId) return workspaces[0];

  return (
    workspaces.find(
      (workspace) =>
        workspace.organization_id === preferredOrganizationId,
    ) ?? workspaces[0]
  );
}
