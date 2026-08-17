import "server-only";

import { sendTransactionalEmail } from "./resend";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

export async function sendWorkspaceWelcomeEmail({
  to,
  firstName,
  organizationName,
  organizationId,
}: {
  to: string;
  firstName: string;
  organizationName: string;
  organizationId?: string;
}) {
  const safeFirstName = firstName.trim() || "there";
  const safeOrganizationName = organizationName.trim() || "your AIOS workspace";
  const name = escapeHtml(safeFirstName);
  const organization = escapeHtml(safeOrganizationName);

  return sendTransactionalEmail({
    organizationId,
    to,
    subject: `Your ${safeOrganizationName} workspace is ready`,
    text: `Welcome to AIOS, ${safeFirstName}. ${safeOrganizationName} is ready for your first travel opportunity.`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f5f3fb;color:#242132;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:18px;padding:40px"><p style="margin:0 0 20px;color:#7659e7;font-size:12px;font-weight:700;letter-spacing:.12em">AIOS TRAVEL CRM</p><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:30px">Welcome, ${name}.</h1><p style="line-height:1.65">${organization} is ready for its first travel opportunity. Start by adding a lead, then let AIOS keep the handoffs, approvals, and traveler details coordinated.</p><p style="margin:28px 0 0;color:#706b82;font-size:13px">Sent securely by AIOS Travel CRM.</p></main></body></html>`,
    tags: [{ name: "category", value: "workspace-welcome" }],
  });
}

export async function sendPlatformAgencyOwnerInvitationEmail({
  to,
  organizationName,
  invitationUrl,
  invitationId,
}: {
  to: string;
  organizationName: string;
  invitationUrl: string;
  invitationId: string;
}) {
  const safeOrganizationName = organizationName.trim() || "your agency";
  const organization = escapeHtml(safeOrganizationName);
  const link = escapeHtml(invitationUrl);

  return sendTransactionalEmail({
    to,
    subject: `Accept your ${safeOrganizationName} owner invitation`,
    text: `You were invited to become the owner of ${safeOrganizationName} in AIOS Travel CRM. Accept this one-time invitation: ${invitationUrl}`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f5f3fb;color:#242132;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:18px;padding:40px"><p style="margin:0 0 20px;color:#7659e7;font-size:12px;font-weight:700;letter-spacing:.12em">AIOS PLATFORM INVITATION</p><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:30px">Own ${organization}.</h1><p style="line-height:1.65">A platform superadmin created this agency in provisioning state and invited you as its first owner. Your signed-in email must match this invitation.</p><p style="margin:28px 0"><a href="${link}" style="display:inline-block;border-radius:10px;background:#33274f;color:#fff;padding:13px 18px;text-decoration:none;font-weight:700">Accept secure invitation</a></p><p style="color:#706b82;font-size:13px;line-height:1.6">This is a one-time link. The agency remains unavailable until platform lifecycle review is complete.</p></main></body></html>`,
    tags: [{ name: "category", value: "platform-agency-owner-invite" }],
    idempotencyKey: `platform-agency-invite-${invitationId}`,
  });
}

export async function sendPlatformOperatorInvitationEmail({
  to,
  role,
  invitationUrl,
  invitationId,
  expiresAt,
}: {
  to: string;
  role: "superadmin" | "platform_admin";
  invitationUrl: string;
  invitationId: string;
  expiresAt: string;
}) {
  const roleName = role === "superadmin" ? "Platform superadmin" : "Platform admin";
  const link = escapeHtml(invitationUrl);
  const safeExpiry = escapeHtml(
    new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(expiresAt)),
  );

  return sendTransactionalEmail({
    to,
    subject: `Your AIOS ${roleName.toLowerCase()} invitation`,
    text: `You were invited to become an AIOS ${roleName}. This invitation grants platform administration only and creates no agency access. Accept the one-time invitation before ${safeExpiry}: ${invitationUrl}`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f5f3fb;color:#242132;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:18px;padding:40px"><p style="margin:0 0 20px;color:#7659e7;font-size:12px;font-weight:700;letter-spacing:.12em">AIOS PLATFORM AUTHORITY</p><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:30px">Join as ${escapeHtml(roleName)}.</h1><p style="line-height:1.65">A platform superadmin invited this email address to the independent AIOS control plane. This does not create an agency, tenant membership, or access to customer records.</p><p style="line-height:1.65">You will verify this email, enroll an authenticator, and complete multi-factor verification before access is activated.</p><p style="margin:28px 0"><a href="${link}" style="display:inline-block;border-radius:10px;background:#33274f;color:#fff;padding:13px 18px;text-decoration:none;font-weight:700">Review secure invitation</a></p><p style="color:#706b82;font-size:13px;line-height:1.6">This one-time link expires ${safeExpiry}. If you were not expecting it, do not open it.</p></main></body></html>`,
    tags: [{ name: "category", value: "platform-operator-invite" }],
    idempotencyKey: `platform-operator-invite-${invitationId}`,
  });
}
