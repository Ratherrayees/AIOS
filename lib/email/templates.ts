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
}: {
  to: string;
  firstName: string;
  organizationName: string;
}) {
  const safeFirstName = firstName.trim() || "there";
  const safeOrganizationName = organizationName.trim() || "your AIOS workspace";
  const name = escapeHtml(safeFirstName);
  const organization = escapeHtml(safeOrganizationName);

  return sendTransactionalEmail({
    to,
    subject: `Your ${safeOrganizationName} workspace is ready`,
    text: `Welcome to AIOS, ${safeFirstName}. ${safeOrganizationName} is ready for your first travel opportunity.`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f5f3fb;color:#242132;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:18px;padding:40px"><p style="margin:0 0 20px;color:#7659e7;font-size:12px;font-weight:700;letter-spacing:.12em">AIOS TRAVEL CRM</p><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:30px">Welcome, ${name}.</h1><p style="line-height:1.65">${organization} is ready for its first travel opportunity. Start by adding a lead, then let AIOS keep the handoffs, approvals, and traveler details coordinated.</p><p style="margin:28px 0 0;color:#706b82;font-size:13px">Sent securely by AIOS Travel CRM.</p></main></body></html>`,
    tags: [{ name: "category", value: "workspace-welcome" }],
  });
}
