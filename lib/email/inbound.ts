import "server-only";

import { z } from "zod";

import { createSupabaseAdminClient } from "../supabase/admin";
import type { Json } from "../../types/database";
import { inboundThreadKey } from "./inbound-normalization";

export {
  inboundThreadKey,
  parseMailboxAddress,
  plainTextFromEmail,
} from "./inbound-normalization";

const inboundEmailSchema = z.strictObject({
  organizationId: z.uuid(),
  provider: z.enum(["resend", "custom_imap"]),
  providerEventId: z.string().trim().min(1).max(512),
  externalMessageId: z.string().trim().min(1).max(998),
  senderEmail: z.email().max(320),
  senderName: z.string().trim().max(320).default(""),
  recipientEmail: z.email().max(320),
  subject: z.string().trim().max(500).default(""),
  body: z.string().max(500_000),
  receivedAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type InboundEmailInput = z.input<typeof inboundEmailSchema>;

export async function ingestInboundEmail(input: InboundEmailInput) {
  const email = inboundEmailSchema.parse(input);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .rpc("ingest_inbound_email", {
      target_organization_id: email.organizationId,
      target_provider: email.provider,
      target_provider_event_id: email.providerEventId,
      target_external_message_id: email.externalMessageId,
      target_thread_key: inboundThreadKey(email.senderEmail, email.subject),
      target_sender_email: email.senderEmail,
      target_sender_name: email.senderName,
      target_recipient_email: email.recipientEmail,
      target_subject: email.subject,
      target_body: email.body,
      target_received_at: email.receivedAt,
      target_payload: email.payload as Json,
      target_metadata: email.metadata as Json,
    })
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Inbound email could not be ingested.");
  }
  return data;
}
