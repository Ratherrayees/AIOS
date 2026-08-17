export type AuthorityDestinationInput = {
  requestedPath: string;
  activeWorkspaceCount: number;
  hasPlatformAccess: boolean;
  preferredAuthority?: "agency" | "platform" | null;
};

export function chooseAuthorityDestination({
  requestedPath,
  activeWorkspaceCount,
  hasPlatformAccess,
  preferredAuthority,
}: AuthorityDestinationInput) {
  if (requestedPath !== "/") return requestedPath;
  if (hasPlatformAccess && activeWorkspaceCount === 0) return "/platform";
  if (hasPlatformAccess && activeWorkspaceCount > 0) {
    if (preferredAuthority === "platform") return "/platform";
    if (preferredAuthority === "agency") return "/";
    return "/choose-workspace";
  }
  return "/";
}
