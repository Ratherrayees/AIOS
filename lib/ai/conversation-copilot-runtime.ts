import "server-only";

import { recordAuditEvent } from "../audit";
import { createSupabaseAdminClient } from "../supabase/admin";
import type { ConversationCopilotSource } from "./input-safety";

export async function loadConversationEvidence(
  organizationId: string,
  conversationId: string,
) {
  const admin = createSupabaseAdminClient();
  const [{ data: conversation, error: conversationError }, messagesResult] =
    await Promise.all([
      admin
        .from("conversations")
        .select("id, subject, channel, status, priority")
        .eq("organization_id", organizationId)
        .eq("id", conversationId)
        .maybeSingle(),
      admin
        .from("messages")
        .select("id, direction, body, sent_at")
        .eq("organization_id", organizationId)
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: false })
        .limit(13),
    ]);
  if (conversationError || !conversation)
    throw conversationError ?? new Error("This conversation is unavailable.");
  if (messagesResult.error) throw messagesResult.error;
  return {
    id: conversation.id,
    subject: conversation.subject,
    channel: conversation.channel,
    status: conversation.status,
    priority: conversation.priority,
    messages: [...(messagesResult.data || [])].reverse().map((message) => ({
      id: message.id,
      direction: message.direction,
      body: message.body,
      sentAt: message.sent_at,
    })),
  };
}

export function conversationMessageCitations(
  source: ConversationCopilotSource,
) {
  return source.messages.map((message, index) => ({
    sourceType: "conversation_message",
    sourceId: message.id,
    label: `Conversation message ${index + 1}`,
  }));
}

export async function persistCopilotDraft(input: {
  organizationId: string;
  conversationId: string;
  runId: string;
  initiatedBy: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data: draft, error } = await admin
    .from("message_drafts")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      ai_run_id: input.runId,
      created_by: input.initiatedBy,
      channel: input.channel,
      recipient: null,
      subject: input.subject,
      body: input.body,
      status: "ready_for_review",
      scheduled_for: null,
    })
    .select()
    .single();
  if (!error) {
    await recordAuditEvent({
      organizationId: input.organizationId,
      eventType: "record.created",
      entityType: "message_draft",
      entityId: draft.id,
      metadata: {
        event: "aios.conversation_reply_draft_created",
        conversation_id: input.conversationId,
        ai_run_id: input.runId,
        channel: input.channel,
        external_message_sent: false,
      },
    });
    return draft;
  }
  if (error.code !== "23505") throw error;
  const { data: existing, error: existingError } = await admin
    .from("message_drafts")
    .select()
    .eq("organization_id", input.organizationId)
    .eq("ai_run_id", input.runId)
    .maybeSingle();
  if (existingError || !existing)
    throw existingError ?? new Error("The AIOS reply draft is unavailable.");
  return existing;
}
