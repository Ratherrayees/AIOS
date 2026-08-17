import "server-only";

import { createSupabaseAdminClient } from "../supabase/admin";
import { createSupabaseServerClient } from "../supabase/server";
import type { Database } from "../../types/database";
import {
  platformCapabilityRequiresMfa,
  platformRoleHasCapability,
  type PlatformCapability,
  type PlatformCapabilityAssuranceOptions,
} from "./contracts";

export type PlatformRole = Database["public"]["Enums"]["platform_role"];
export type PlatformAuthorizationFailure =
  | "unauthenticated"
  | "forbidden"
  | "mfa_required";

export class PlatformAuthorizationError extends Error {
  readonly code: PlatformAuthorizationFailure;

  constructor(
    message = "Platform administrator access is required.",
    code: PlatformAuthorizationFailure = "forbidden",
  ) {
    super(message);
    this.name = "PlatformAuthorizationError";
    this.code = code;
  }
}

async function loadPlatformAccess(
  allowedRoles: readonly PlatformRole[] = ["superadmin", "platform_admin"],
) {
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (claimsError || !userId) {
    throw new PlatformAuthorizationError("Sign in is required.", "unauthenticated");
  }
  const issuedAt = claims.claims.iat;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    throw new PlatformAuthorizationError("Platform session could not be verified.");
  }
  const admin = createSupabaseAdminClient();
  const { data: securityControl, error: securityControlError } = await admin
    .from("identity_security_controls")
    .select("status, password_reset_required, sessions_valid_after")
    .eq("user_id", userId)
    .maybeSingle();
  const sessionsValidAfter = securityControl?.sessions_valid_after
    ? Date.parse(securityControl.sessions_valid_after)
    : Number.NaN;
  if (
    securityControlError ||
    !securityControl ||
    securityControl.status !== "active" ||
    securityControl.password_reset_required ||
    !Number.isFinite(sessionsValidAfter) ||
    issuedAt * 1_000 <= sessionsValidAfter
  ) {
    throw new PlatformAuthorizationError("Platform session is no longer valid.");
  }
  const { data: factors, error: factorsError } =
    await admin.auth.admin.mfa.listFactors({ userId });
  if (
    factorsError ||
    !factors.factors.some(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    )
  ) {
    throw new PlatformAuthorizationError(
      "A verified authenticator is required for platform access.",
      "mfa_required",
    );
  }
  const { data: access, error } = await supabase
    .from("platform_admins")
    .select("user_id, role, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !access || !allowedRoles.includes(access.role)) {
    throw new PlatformAuthorizationError();
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const emailClaim = claims?.claims.email;
  return {
    ...access,
    full_name: profile?.full_name?.trim() || "Platform operator",
    email: typeof emailClaim === "string" ? emailClaim : null,
    mfa_verified: claims.claims.aal === "aal2",
  };
}

export async function requirePlatformRole(
  allowedRoles: readonly PlatformRole[] = ["superadmin", "platform_admin"],
) {
  return loadPlatformAccess(allowedRoles);
}

export async function requirePlatformMutationRole(
  allowedRoles: readonly PlatformRole[] = ["superadmin", "platform_admin"],
) {
  const access = await loadPlatformAccess(allowedRoles);
  if (!access.mfa_verified) {
    throw new PlatformAuthorizationError(
      "Verify multi-factor authentication before changing platform configuration.",
      "mfa_required",
    );
  }
  return access;
}

export async function requirePlatformCapability(
  capability: PlatformCapability,
  options: PlatformCapabilityAssuranceOptions = {},
) {
  const access = await loadPlatformAccess();
  if (!platformRoleHasCapability(access.role, capability)) {
    throw new PlatformAuthorizationError(
      "This platform capability is not assigned to your role.",
    );
  }
  if (platformCapabilityRequiresMfa(options) && !access.mfa_verified) {
    throw new PlatformAuthorizationError(
      "Verify multi-factor authentication to access platform administration.",
      "mfa_required",
    );
  }
  return access;
}
