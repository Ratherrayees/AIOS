"use server";

import { createHash, randomBytes } from "node:crypto";

import { requireOrganizationRole } from "../../lib/authorization";
import {
  organizationInvitationAcceptSchema,
  organizationInvitationInputSchema,
  organizationInvitationRevokeSchema,
  organizationMembershipRoleUpdateSchema,
  organizationMembershipStatusUpdateSchema,
  type OrganizationInvitationAcceptInput,
  type OrganizationInvitationInput,
  type OrganizationInvitationRevokeInput,
  type OrganizationMembershipRoleUpdateInput,
  type OrganizationMembershipStatusUpdateInput,
} from "../../lib/crm/schemas";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export async function createOrganizationInvitation(
  input: OrganizationInvitationInput,
) {
  const data = organizationInvitationInputSchema.parse(input);
  await requireOrganizationRole(
    data.organizationId,
    data.role === "owner" ? ["owner"] : ["owner", "admin"],
  );

  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const invitedBy = claims?.claims.sub;
  if (claimsError || !invitedBy) throw new Error("Sign in is required.");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: invitation, error } = await supabase
    .from("organization_invitations")
    .insert({
      organization_id: data.organizationId,
      email: data.email,
      role: data.role,
      token_hash: tokenHash,
      invited_by: invitedBy,
    })
    .select(
      "id, organization_id, email, role, status, expires_at, created_at",
    )
    .single();

  if (error?.code === "23505")
    throw new Error("A pending invitation already exists for this email.");
  if (error) throw error;

  // The plaintext token is intentionally not returned while delivery is
  // disabled. Resend will receive it only inside the future server-side send.
  return invitation;
}

export async function revokeOrganizationInvitation(
  input: OrganizationInvitationRevokeInput,
) {
  const data = organizationInvitationRevokeSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: existingError } = await supabase
    .from("organization_invitations")
    .select("id, role, status")
    .eq("id", data.invitationId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();

  if (existingError || !existing)
    throw new Error("This invitation is not available in the active workspace.");
  if (existing.status !== "pending")
    throw new Error("Only a pending invitation can be revoked.");

  await requireOrganizationRole(
    data.organizationId,
    existing.role === "owner" ? ["owner"] : ["owner", "admin"],
  );

  const { data: invitation, error } = await supabase
    .from("organization_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", data.invitationId)
    .eq("organization_id", data.organizationId)
    .eq("status", "pending")
    .select("id, status, revoked_at")
    .maybeSingle();

  if (error || !invitation)
    throw error ?? new Error("This invitation could not be revoked.");
  return invitation;
}

export async function acceptOrganizationInvitation(
  input: OrganizationInvitationAcceptInput,
) {
  const data = organizationInvitationAcceptSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims.sub)
    throw new Error("Sign in is required to accept this invitation.");

  const tokenHash = createHash("sha256").update(data.token).digest("hex");
  const { data: acceptedRows, error } = await supabase.rpc(
    "accept_organization_invitation",
    { invitation_token_hash: tokenHash },
  );

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("expired"))
      throw new Error("This invitation has expired. Ask an owner for a new one.");
    if (message.includes("different email"))
      throw new Error(
        "Sign in with the same verified email address that was invited.",
      );
    if (message.includes("already an active"))
      throw new Error("This account already belongs to that workspace.");
    if (message.includes("suspended"))
      throw new Error(
        "This membership is suspended. A workspace owner must restore it.",
      );
    if (message.includes("verified email"))
      throw new Error("Verify your email address before accepting this invitation.");
    throw new Error("This invitation is invalid or no longer available.");
  }

  const accepted = acceptedRows?.[0];
  if (!accepted)
    throw new Error("This invitation could not be accepted.");
  return accepted;
}

export async function updateOrganizationMembershipRole(
  input: OrganizationMembershipRoleUpdateInput,
) {
  const data = organizationMembershipRoleUpdateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: existingError } = await supabase
    .from("memberships")
    .select("id, role, status")
    .eq("id", data.membershipId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();

  if (existingError || !existing)
    throw new Error("This membership is not available in the active workspace.");

  await requireOrganizationRole(
    data.organizationId,
    existing.role === "owner" || data.role === "owner"
      ? ["owner"]
      : ["owner", "admin"],
  );

  const { data: membership, error } = await supabase
    .from("memberships")
    .update({ role: data.role })
    .eq("id", data.membershipId)
    .eq("organization_id", data.organizationId)
    .eq("role", existing.role)
    .eq("status", existing.status)
    .select("id, role, status")
    .maybeSingle();

  if (error || !membership)
    throw error ?? new Error("This membership changed before it could be updated.");
  return membership;
}

export async function updateOrganizationMembershipStatus(
  input: OrganizationMembershipStatusUpdateInput,
) {
  const data = organizationMembershipStatusUpdateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: existingError } = await supabase
    .from("memberships")
    .select("id, role, status")
    .eq("id", data.membershipId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();

  if (existingError || !existing)
    throw new Error("This membership is not available in the active workspace.");
  if (existing.status === data.status) return existing;

  await requireOrganizationRole(
    data.organizationId,
    existing.role === "owner" ? ["owner"] : ["owner", "admin"],
  );

  const { data: membership, error } = await supabase
    .from("memberships")
    .update({ status: data.status })
    .eq("id", data.membershipId)
    .eq("organization_id", data.organizationId)
    .eq("role", existing.role)
    .eq("status", existing.status)
    .select("id, role, status")
    .maybeSingle();

  if (error || !membership)
    throw error ?? new Error("This membership changed before it could be updated.");
  return membership;
}
