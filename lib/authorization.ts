import { createSupabaseServerClient } from "./supabase/server";
import type { Database } from "../types/database";

export type AppRole = Database["public"]["Enums"]["app_role"];

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Use in server actions and route handlers before changing a tenant record. */
export async function requireActiveMembership(organizationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims.sub) throw new AuthorizationError("Sign in is required.");

  const { data: membership, error } = await supabase
    .from("memberships")
    .select("organization_id, role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", claims.claims.sub)
    .eq("status", "active")
    .maybeSingle();

  if (error || !membership) throw new AuthorizationError();
  return membership;
}

export async function requireOrganizationRole(organizationId: string, allowedRoles: readonly AppRole[]) {
  const membership = await requireActiveMembership(organizationId);
  if (!allowedRoles.includes(membership.role)) throw new AuthorizationError();
  return membership;
}
