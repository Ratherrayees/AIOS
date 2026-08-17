"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getApplicationOrigin } from "../../lib/auth/application-origin";
import { sendPlatformOperatorInvitationEmail } from "../../lib/email/templates";
import { requirePlatformCapability } from "../../lib/platform/authorization";
import {
  PLATFORM_OPERATOR_INVITATION_COOKIE,
  hashPlatformOperatorInvitationToken,
  parsePlatformOperatorInvitationToken,
  platformOperatorInvitationCookieOptions,
} from "../../lib/platform/operator-invitation-token";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const platformRoleSchema = z.enum(["superadmin", "platform_admin"]);
const createInvitationSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(320),
  role: platformRoleSchema,
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().toLowerCase().email().max(320),
  expiresInDays: z.number().int().min(1).max(14).default(7),
});
const invitationMutationSchema = z.strictObject({
  invitationId: z.uuid(),
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().toLowerCase().email().max(320),
  expectedVersion: z.number().int().positive(),
});
function invitationToken() {
  return randomBytes(32).toString("base64url");
}

function invitationStatus(
  status: string,
  expiresAt: string,
): "pending" | "expired" | "accepted" | "revoked" {
  return status === "pending" && Date.parse(expiresAt) <= Date.now()
    ? "expired"
    : status as "pending" | "accepted" | "revoked";
}

async function recordInvitationDelivery(
  actorId: string,
  invitationId: string,
  status: "sent" | "pending",
) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("platform_audit_events").insert({
    actor_id: actorId,
    event_type: status === "sent"
      ? "platform.operator_invitation.sent"
      : "platform.operator_invitation.delivery_pending",
    entity_type: "platform_operator_invitation",
    entity_id: invitationId,
    metadata: { deliveryStatus: status },
  });
  if (error) throw error;
}

async function deliverPlatformInvitation({
  actorId,
  id,
  email,
  role,
  expiresAt,
  token,
}: {
  actorId: string;
  id: string;
  email: string;
  role: "superadmin" | "platform_admin";
  expiresAt: string;
  token: string;
}) {
  try {
    const origin = await getApplicationOrigin();
    if (!origin) {
      throw new Error("A verified application origin is required for invitation delivery.");
    }
    await sendPlatformOperatorInvitationEmail({
      to: email,
      role,
      invitationUrl: `${origin}/auth/platform-invite/redeem?token=${encodeURIComponent(token)}`,
      invitationId: id,
      expiresAt,
    });
    await recordInvitationDelivery(actorId, id, "sent");
    return "sent" as const;
  } catch {
    await recordInvitationDelivery(actorId, id, "pending");
    return "pending" as const;
  }
}

export async function getPlatformOperatorInvitationDirectory() {
  const access = await requirePlatformCapability("platform.access.manage");
  const admin = createSupabaseAdminClient();
  const { data: invitations, error } = await admin
    .from("platform_operator_invitations")
    .select("id, email, role, status, reason, invited_by, accepted_by, accepted_at, revoked_at, expires_at, version, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) throw error;

  const invitationIds = (invitations || []).map((invitation) => invitation.id);
  const actorIds = [...new Set((invitations || []).flatMap((invitation) => [
    ...(invitation.invited_by ? [invitation.invited_by] : []),
    ...(invitation.accepted_by ? [invitation.accepted_by] : []),
  ]))];
  const [profilesResult, deliveryResult] = await Promise.all([
    actorIds.length
      ? admin.from("profiles").select("id, full_name").in("id", actorIds)
      : Promise.resolve({ data: [], error: null }),
    invitationIds.length
      ? admin
          .from("platform_audit_events")
          .select("entity_id, event_type, created_at")
          .in("entity_id", invitationIds)
          .in("event_type", [
            "platform.operator_invitation.sent",
            "platform.operator_invitation.delivery_pending",
          ])
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (deliveryResult.error) throw deliveryResult.error;
  const names = new Map(
    (profilesResult.data || []).map((profile) => [profile.id, profile.full_name]),
  );
  const delivery = new Map<string, "sent" | "pending">();
  for (const event of deliveryResult.data || []) {
    if (!event.entity_id || delivery.has(event.entity_id)) continue;
    delivery.set(
      event.entity_id,
      event.event_type.endsWith(".sent") ? "sent" : "pending",
    );
  }

  return {
    mfaVerified: access.mfa_verified,
    invitations: (invitations || []).map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitationStatus(invitation.status, invitation.expires_at),
      reason: invitation.reason,
      expiresAt: invitation.expires_at,
      version: invitation.version,
      createdAt: invitation.created_at,
      updatedAt: invitation.updated_at,
      acceptedAt: invitation.accepted_at,
      revokedAt: invitation.revoked_at,
      invitedBy: invitation.invited_by
        ? names.get(invitation.invited_by) || "Platform operator"
        : "Former platform operator",
      acceptedBy: invitation.accepted_by
        ? names.get(invitation.accepted_by) || "Platform operator"
        : null,
      deliveryStatus: delivery.get(invitation.id) || "pending",
    })),
  };
}

export async function createPlatformOperatorInvitation(input: unknown) {
  const parsed = createInvitationSchema.parse(input);
  const access = await requirePlatformCapability("platform.access.manage", {
    mfa: true,
  });
  if (parsed.confirmation !== parsed.email) {
    throw new Error("Enter the exact invited email to confirm this invitation.");
  }

  const token = invitationToken();
  const expiresAt = new Date(
    Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const admin = createSupabaseAdminClient();
  const { data: invitation, error } = await admin.rpc(
    "create_platform_operator_invitation_service",
    {
      invitation_email: parsed.email,
      target_role: parsed.role,
      invitation_token_hash: hashPlatformOperatorInvitationToken(token),
      actor_id: access.user_id,
      invitation_reason: parsed.reason,
      invitation_expires_at: expiresAt,
    },
  );
  if (error) throw error;
  if (!invitation) throw new Error("The platform invitation was not created.");

  const deliveryStatus = await deliverPlatformInvitation({
    actorId: access.user_id,
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expires_at,
    token,
  });
  return {
    success: true,
    invitationId: invitation.id,
    expiresAt: invitation.expires_at,
    deliveryStatus,
  };
}

export async function resendPlatformOperatorInvitation(input: unknown) {
  const parsed = invitationMutationSchema.parse(input);
  const access = await requirePlatformCapability("platform.access.manage", {
    mfa: true,
  });
  const admin = createSupabaseAdminClient();
  const { data: current, error: currentError } = await admin
    .from("platform_operator_invitations")
    .select("id, email, status, version")
    .eq("id", parsed.invitationId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.status !== "pending") {
    throw new Error("That platform invitation is no longer pending.");
  }
  if (current.version !== parsed.expectedVersion) {
    throw new Error("Platform invitation changed. Refresh and try again.");
  }
  if (parsed.confirmation !== current.email) {
    throw new Error("Enter the exact invited email to confirm this resend.");
  }

  const token = invitationToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  const { data: invitation, error } = await admin.rpc(
    "resend_platform_operator_invitation_service",
    {
      target_invitation_id: parsed.invitationId,
      replacement_token_hash: hashPlatformOperatorInvitationToken(token),
      actor_id: access.user_id,
      resend_reason: parsed.reason,
      replacement_expires_at: expiresAt,
      expected_version: parsed.expectedVersion,
    },
  );
  if (error) throw error;
  if (!invitation) throw new Error("The replacement invitation was not created.");

  const deliveryStatus = await deliverPlatformInvitation({
    actorId: access.user_id,
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expires_at,
    token,
  });
  return {
    success: true,
    invitationId: invitation.id,
    expiresAt: invitation.expires_at,
    deliveryStatus,
  };
}

export async function revokePlatformOperatorInvitation(input: unknown) {
  const parsed = invitationMutationSchema.parse(input);
  const access = await requirePlatformCapability("platform.access.manage", {
    mfa: true,
  });
  const admin = createSupabaseAdminClient();
  const { data: current, error: currentError } = await admin
    .from("platform_operator_invitations")
    .select("id, email, status, version")
    .eq("id", parsed.invitationId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.status !== "pending") {
    throw new Error("That platform invitation is no longer pending.");
  }
  if (current.version !== parsed.expectedVersion) {
    throw new Error("Platform invitation changed. Refresh and try again.");
  }
  if (parsed.confirmation !== current.email) {
    throw new Error("Enter the exact invited email to confirm this revocation.");
  }
  const { data: invitation, error } = await admin.rpc(
    "revoke_platform_operator_invitation_service",
    {
      target_invitation_id: parsed.invitationId,
      actor_id: access.user_id,
      revoke_reason: parsed.reason,
      expected_version: parsed.expectedVersion,
    },
  );
  if (error) throw error;
  if (!invitation) throw new Error("The platform invitation was not revoked.");
  return { success: true, version: invitation.version };
}

export async function getPlatformOperatorInvitationPreview() {
  const token = parsePlatformOperatorInvitationToken(
    (await cookies()).get(PLATFORM_OPERATOR_INVITATION_COOKIE)?.value,
  );
  if (!token) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "get_platform_operator_invitation_snapshot",
    { invitation_token_hash: token },
  );
  if (error) return null;
  const snapshot = data?.[0];
  if (!snapshot) return null;
  return {
    emailHint: snapshot.email_hint,
    role: snapshot.invitation_role,
    status: snapshot.invitation_status as "pending" | "expired" | "accepted" | "revoked",
    expiresAt: snapshot.expires_at,
  };
}

export async function acceptPlatformOperatorInvitation() {
  const cookieStore = await cookies();
  const token = parsePlatformOperatorInvitationToken(
    cookieStore.get(PLATFORM_OPERATOR_INVITATION_COOKIE)?.value,
  );
  if (!token) {
    throw new Error("This platform invitation is invalid or no longer available.");
  }
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims.sub) {
    throw new Error("Sign in with the invited verified email before accepting.");
  }
  const { data, error } = await supabase.rpc(
    "accept_platform_operator_invitation",
    { invitation_token_hash: token },
  );
  if (error) {
    const detail = error.details || "";
    const message = error.message.toLowerCase();
    const terminal = new Set([
      "platform_invite_invalid",
      "platform_invite_terminal",
      "platform_invite_expired",
      "platform_invite_existing_access",
    ]).has(detail);
    if (terminal) {
      cookieStore.set(PLATFORM_OPERATOR_INVITATION_COOKIE, "", {
        ...platformOperatorInvitationCookieOptions,
        maxAge: 0,
      });
    }
    if (detail === "platform_invite_expired" || message.includes("expired")) {
      throw new Error("This platform invitation has expired. Ask a superadmin to resend it.");
    }
    if (detail === "platform_invite_wrong_email" || message.includes("different verified email")) {
      throw new Error("Sign in with the same verified email address that was invited.");
    }
    if (
      detail === "platform_invite_aal2_required" ||
      detail === "platform_invite_totp_required" ||
      message.includes("multi-factor") ||
      message.includes("authenticator")
    ) {
      throw new Error("Verify your authenticator before accepting platform access.");
    }
    if (detail === "platform_invite_inviter_inactive") {
      throw new Error("The inviting superadmin is no longer authorized. Ask another superadmin to resend this invitation.");
    }
    if (
      detail === "platform_invite_session_invalid" ||
      detail === "platform_invite_identity_ineligible" ||
      detail === "platform_invite_email_unverified"
    ) {
      throw new Error("Resolve this account's verification or security requirement, then try again.");
    }
    if (detail === "platform_invite_existing_access" || message.includes("already has")) {
      throw new Error("This account already has a platform access record.");
    }
    throw new Error("This platform invitation is invalid or no longer available.");
  }
  const accepted = data?.[0];
  if (!accepted) throw new Error("This platform invitation could not be accepted.");
  cookieStore.set(PLATFORM_OPERATOR_INVITATION_COOKIE, "", {
    ...platformOperatorInvitationCookieOptions,
    maxAge: 0,
  });
  return {
    success: true,
    userId: accepted.user_id,
    role: accepted.platform_role,
    destination: "/platform" as const,
  };
}

export async function switchPlatformInvitationAccount() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(`/sign-in?next=${encodeURIComponent("/auth/platform-invite")}`);
}
