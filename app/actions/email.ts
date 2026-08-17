"use server";

import { createHash } from "node:crypto";
import { z } from "zod";

import { gateAiosAction } from "./aios";
import { requireOrganizationRole } from "../../lib/authorization";
import { sendTransactionalEmail } from "../../lib/email/resend";
import { loadEnabledTenantIntegration } from "../../lib/integrations/tenant-config";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const deliveryReferenceSchema = z.strictObject({
  organizationId: z.uuid(),
  draftId: z.uuid(),
});

const executeReferenceSchema = z.strictObject({
  organizationId: z.uuid(),
  approvalId: z.uuid(),
});

const INBOX_DELIVERY_ROLES = [
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
  "agent",
] as const;

function draftDigest(input: {
  recipient: string;
  subject: string;
  body: string;
  updatedAt: string;
}) {
  return createHash("sha256")
    .update(`${input.recipient}\n${input.subject}\n${input.body}\n${input.updatedAt}`)
    .digest("hex");
}

function htmlFromPlainText(value: string) {
  const escaped = value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character] || character;
  });
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`)
    .join("");
}

async function assertLatestAiDraftReview(
  organizationId: string,
  draft: { id: string; ai_run_id: string | null; updated_at: string },
) {
  if (!draft.ai_run_id) return;
  const admin = createSupabaseAdminClient();
  const { data: review, error } = await admin
    .from("message_draft_reviews")
    .select("id, decision")
    .eq("organization_id", organizationId)
    .eq("message_draft_id", draft.id)
    .eq("draft_updated_at", draft.updated_at)
    .eq("decision", "approved")
    .maybeSingle();
  if (error || !review) {
    throw new Error(
      "Approve the current AI draft revision before requesting delivery.",
    );
  }
}

async function loadEmailDraft(organizationId: string, draftId: string) {
  const admin = createSupabaseAdminClient();
  const { data: draft, error } = await admin
    .from("message_drafts")
    .select(
      "id, organization_id, conversation_id, ai_run_id, channel, recipient, subject, body, status, updated_at, archived_at",
    )
    .eq("organization_id", organizationId)
    .eq("id", draftId)
    .maybeSingle();
  if (error || !draft || draft.archived_at) {
    throw new Error("That message draft is not available.");
  }
  if (draft.channel !== "email") {
    throw new Error("Only email drafts can use an email provider.");
  }
  const recipient = z.email().max(320).parse(draft.recipient);
  const subject = z.string().trim().min(1).max(180).parse(draft.subject);
  const body = z.string().trim().min(1).max(10_000).parse(draft.body);
  return { ...draft, recipient, subject, body };
}

/** Creates the mandatory human gate for one exact email draft revision. */
export async function requestEmailDraftDelivery(input: unknown) {
  const parsed = deliveryReferenceSchema.parse(input);
  await requireOrganizationRole(parsed.organizationId, INBOX_DELIVERY_ROLES);
  const draft = await loadEmailDraft(parsed.organizationId, parsed.draftId);
  await assertLatestAiDraftReview(parsed.organizationId, draft);

  const [resend, smtp] = await Promise.all([
    loadEnabledTenantIntegration(parsed.organizationId, "resend"),
    loadEnabledTenantIntegration(parsed.organizationId, "custom_smtp"),
  ]);
  if (!resend && !smtp) {
    throw new Error(
      "Enable a verified email provider in Settings → Integrations before requesting delivery.",
    );
  }

  const digest = draftDigest({
    recipient: draft.recipient,
    subject: draft.subject,
    body: draft.body,
    updatedAt: draft.updated_at,
  });
  const admin = createSupabaseAdminClient();
  const { data: existingDelivery, error: existingDeliveryError } = await admin
    .from("email_message_deliveries")
    .select("id")
    .eq("organization_id", parsed.organizationId)
    .eq("message_draft_id", draft.id)
    .eq("draft_revision_at", draft.updated_at)
    .maybeSingle();
  if (existingDeliveryError) throw existingDeliveryError;
  if (existingDelivery) {
    throw new Error("This exact draft revision already has a delivery request.");
  }

  const gate = await gateAiosAction({
    organizationId: parsed.organizationId,
    action: "external_message.send",
    entityType: "message_draft",
    entityId: draft.id,
    payload: {
      conversation_id: draft.conversation_id,
      draft_updated_at: draft.updated_at,
      body_sha256: digest,
      recipient: draft.recipient,
      subject: draft.subject,
    },
    rationale: "Send this exact reviewed email draft to the customer.",
  });
  if (gate.decision !== "approval_required") {
    throw new Error(gate.reason);
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const requesterId = claims?.claims.sub;
  if (claimsError || !requesterId) throw new Error("Sign in is required.");
  const { data: delivery, error } = await admin
    .from("email_message_deliveries")
    .insert({
      organization_id: parsed.organizationId,
      conversation_id: draft.conversation_id,
      message_draft_id: draft.id,
      approval_request_id: gate.approvalId,
      recipient: draft.recipient,
      subject: draft.subject,
      body_sha256: digest,
      draft_revision_at: draft.updated_at,
      requested_by: requesterId,
    })
    .select()
    .single();
  if (error?.code === "23505") {
    throw new Error("This exact draft revision already has a delivery request.");
  }
  if (error) throw error;
  return { delivery, approvalId: gate.approvalId };
}

/** Dispatches one approved delivery and atomically appends its Inbox message. */
export async function executeApprovedEmailDelivery(input: unknown) {
  const parsed = executeReferenceSchema.parse(input);
  await requireOrganizationRole(parsed.organizationId, [
    "owner",
    "admin",
    "operations",
    "finance",
  ]);
  const admin = createSupabaseAdminClient();
  const [{ data: approval, error: approvalError }, { data: delivery, error: deliveryError }] =
    await Promise.all([
      admin
        .from("approval_requests")
        .select("id, action, entity_type, entity_id, status, approver_id")
        .eq("organization_id", parsed.organizationId)
        .eq("id", parsed.approvalId)
        .maybeSingle(),
      admin
        .from("email_message_deliveries")
        .select("*")
        .eq("organization_id", parsed.organizationId)
        .eq("approval_request_id", parsed.approvalId)
        .maybeSingle(),
    ]);
  if (approvalError || deliveryError || !approval || !delivery) {
    throw new Error("The approved email delivery is not available.");
  }
  if (
    approval.status !== "approved" ||
    approval.action !== "external_message.send" ||
    approval.entity_type !== "message_draft" ||
    approval.entity_id !== delivery.message_draft_id
  ) {
    throw new Error("This approval does not authorize the email delivery.");
  }
  if (delivery.status === "sent") return delivery;
  if (delivery.status !== "pending_approval") {
    throw new Error("This email delivery is not ready to dispatch.");
  }

  const draft = await loadEmailDraft(
    parsed.organizationId,
    delivery.message_draft_id,
  );
  await assertLatestAiDraftReview(parsed.organizationId, draft);
  const digest = draftDigest({
    recipient: draft.recipient,
    subject: draft.subject,
    body: draft.body,
    updatedAt: draft.updated_at,
  });
  if (
    digest !== delivery.body_sha256 ||
    draft.updated_at !== delivery.draft_revision_at ||
    draft.recipient !== delivery.recipient ||
    draft.subject !== delivery.subject
  ) {
    await admin
      .from("email_message_deliveries")
      .update({ status: "failed", last_error_code: "draft_revision_changed" })
      .eq("id", delivery.id)
      .eq("status", "pending_approval");
    throw new Error("The draft changed after approval was requested. Create a new request.");
  }

  const tenantResend = await loadEnabledTenantIntegration(
    parsed.organizationId,
    "resend",
  );
  const tenantSmtp = tenantResend
    ? null
    : await loadEnabledTenantIntegration(parsed.organizationId, "custom_smtp");
  const activeProvider = tenantResend || tenantSmtp;
  if (!activeProvider) {
    throw new Error("The agency email provider is no longer active.");
  }
  const { data: claimed, error: claimError } = await admin
    .from("email_message_deliveries")
    .update({
      status: "sending",
      sent_by: approval.approver_id,
      last_error_code: null,
    })
    .eq("id", delivery.id)
    .eq("status", "pending_approval")
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) {
    throw new Error("Another worker is already handling this email delivery.");
  }

  try {
    const result = await sendTransactionalEmail({
      organizationId: parsed.organizationId,
      to: draft.recipient,
      subject: draft.subject,
      text: draft.body,
      html: htmlFromPlainText(draft.body),
      idempotencyKey: `email-delivery-${delivery.id}`,
      tags: [{ name: "category", value: "crm-follow-up" }],
    });
    const { data: settled, error: settleError } = await admin
      .rpc("settle_email_message_delivery", {
        target_organization_id: parsed.organizationId,
        target_delivery_id: delivery.id,
        target_provider: result.provider,
        target_provider_message_id: result.id,
        target_sender_address: String(activeProvider.publicConfig.fromEmail),
        target_body: draft.body,
      })
      .single();
    if (settleError || !settled) {
      throw new Error("The provider accepted the email, but CRM settlement failed.");
    }
    return settled;
  } catch (error) {
    await admin
      .from("email_message_deliveries")
      .update({ status: "failed", last_error_code: "provider_delivery_failed" })
      .eq("id", delivery.id)
      .eq("status", "sending");
    throw error;
  }
}

export async function cancelRejectedEmailDelivery(input: unknown) {
  const parsed = executeReferenceSchema.parse(input);
  await requireOrganizationRole(parsed.organizationId, [
    "owner",
    "admin",
    "operations",
    "finance",
  ]);
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("email_message_deliveries")
    .update({ status: "cancelled", last_error_code: null })
    .eq("organization_id", parsed.organizationId)
    .eq("approval_request_id", parsed.approvalId)
    .eq("status", "pending_approval");
  if (error) throw error;
}
