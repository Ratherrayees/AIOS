"use server";

import { recordAuditEvent } from "../../lib/audit";
import {
  requireActiveMembership,
  requireOrganizationRole,
} from "../../lib/authorization";
import {
  activityNoteInputSchema,
  companyInputSchema,
  contactInputSchema,
  contactMergeInputSchema,
  contactOwnerUpdateSchema,
  contactPreferencesInputSchema,
  contactImportSchema,
  conversationInputSchema,
  conversationNoteInputSchema,
  conversationAssigneeUpdateSchema,
  conversationSlaUpdateSchema,
  conversationStatusUpdateSchema,
  dealInputSchema,
  dealCommercialPlanUpdateSchema,
  dealOwnerUpdateSchema,
  dealResponseInputSchema,
  dealStageUpdateSchema,
  leadCaptureFormInputSchema,
  leadCaptureFormStatusUpdateSchema,
  travelDocumentUploadSchema,
  taskInputSchema,
  taskAssigneeUpdateSchema,
  taskStatusUpdateSchema,
  quoteDraftInputSchema,
  quoteRevisionInputSchema,
  quoteShareApprovalInputSchema,
  savedViewDeleteSchema,
  savedViewInputSchema,
  tripDraftInputSchema,
  itineraryItemInputSchema,
  itineraryTemplateApplyInputSchema,
  itineraryTemplateFromTripInputSchema,
  itineraryCommentInputSchema,
  messageDraftInputSchema,
  messageDraftUpdateSchema,
  messageTemplateInputSchema,
  messageTemplateStatusUpdateSchema,
  type ActivityNoteInput,
  type CompanyInput,
  type ContactInput,
  type ContactMergeInput,
  type ContactOwnerUpdateInput,
  type ContactPreferencesInput,
  type ContactImportInput,
  type ConversationInput,
  type ConversationNoteInput,
  type ConversationAssigneeUpdateInput,
  type ConversationSlaUpdateInput,
  type ConversationStatusUpdateInput,
  type DealInput,
  type DealCommercialPlanUpdateInput,
  type DealOwnerUpdateInput,
  type DealResponseInput,
  type DealStageUpdateInput,
  type LeadCaptureFormInput,
  type LeadCaptureFormStatusUpdateInput,
  type TravelDocumentUploadInput,
  type TaskInput,
  type TaskAssigneeUpdateInput,
  type TaskStatusUpdateInput,
  type QuoteDraftInput,
  type QuoteRevisionInput,
  type QuoteShareApprovalInput,
  type SavedViewDeleteInput,
  type SavedViewInput,
  type TripDraftInput,
  type ItineraryItemInput,
  type ItineraryTemplateApplyInput,
  type ItineraryTemplateFromTripInput,
  type ItineraryCommentInput,
  type MessageDraftInput,
  type MessageDraftUpdateInput,
  type MessageTemplateInput,
  type MessageTemplateStatusUpdateInput,
} from "../../lib/crm/schemas";
import { gateAiosAction } from "./aios";
import {
  matchesTravelDocumentSignature,
  MAX_TRAVEL_DOCUMENT_BYTES,
  TRAVEL_DOCUMENT_MIME_TYPES,
  travelDocumentDisplayName,
  travelDocumentStorageName,
} from "../../lib/crm/travel-documents";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const CRM_WRITE_ROLES = [
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
  "agent",
] as const;
const INBOX_WRITE_ROLES = CRM_WRITE_ROLES;
const DEAL_WRITE_ROLES = ["owner", "admin", "sales", "agent"] as const;
const TASK_WRITE_ROLES = [
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
  "finance",
  "agent",
] as const;
const DOCUMENT_WRITE_ROLES = [
  "owner",
  "admin",
  "trip_designer",
  "operations",
  "agent",
] as const;

async function assertActiveOrganizationMember(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  assigneeId: string | null | undefined,
) {
  if (!assigneeId) return;
  const { data: membership, error } = await supabase
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", assigneeId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !membership)
    throw new Error(
      "Work can only be assigned to an active member of this workspace.",
    );
}

/** Shared secure write path for forms, imports, and approved agent actions. */
export async function createContact(input: ContactInput) {
  const data = contactInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, CRM_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      organization_id: data.organizationId,
      first_name: data.firstName,
      last_name: data.lastName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      company_id: data.companyId ?? null,
      owner_id: data.ownerId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("activity_events").insert({
    organization_id: data.organizationId,
    contact_id: contact.id,
    company_id: contact.company_id,
    activity_type: "contact_created",
    body: "Contact created in AIOS.",
  });
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "contact",
    entityId: contact.id,
    metadata: { event: "contact.created" },
  });
  return contact;
}

/** Records stated communication preferences without making a legal-compliance claim. */
export async function updateContactPreferences(input: ContactPreferencesInput) {
  const data = contactPreferencesInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, CRM_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .update({
      communication_consent: data.consentStatus,
      consent_recorded_at:
        data.consentStatus === "unknown" ? null : new Date().toISOString(),
      consent_source:
        data.consentStatus === "unknown" ? null : data.consentSource,
      preferred_channel: data.preferredChannel,
      preferred_locale: data.preferredLocale ?? null,
      time_zone: data.timeZone ?? null,
    })
    .eq("id", data.contactId)
    .eq("organization_id", data.organizationId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!contact)
    throw new Error("This contact is not available in the active workspace.");

  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      contact_id: contact.id,
      activity_type: "contact_preferences_updated",
      body: "Communication preferences were updated.",
      metadata: {
        consent_status: contact.communication_consent,
        preferred_channel: contact.preferred_channel,
      },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "contact",
    entityId: contact.id,
    metadata: {
      event: "contact.preferences_updated",
      consent_status: contact.communication_consent,
      preferred_channel: contact.preferred_channel,
    },
  });
  return contact;
}

/** Assigns a contact only to an active member of the current organization. */
export async function updateContactOwner(input: ContactOwnerUpdateInput) {
  const data = contactOwnerUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, CRM_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  await assertActiveOrganizationMember(
    supabase,
    data.organizationId,
    data.ownerId,
  );
  const { data: contact, error } = await supabase
    .from("contacts")
    .update({ owner_id: data.ownerId })
    .eq("id", data.contactId)
    .eq("organization_id", data.organizationId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!contact)
    throw new Error("This contact is not available in the active workspace.");

  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      contact_id: contact.id,
      activity_type: "contact_owner_changed",
      body: contact.owner_id
        ? "Contact ownership was assigned to a workspace member."
        : "Contact ownership was returned to the shared queue.",
      metadata: { owner_id: contact.owner_id },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "contact",
    entityId: contact.id,
    metadata: { event: "contact.owner_updated", owner_id: contact.owner_id },
  });
  return contact;
}

/** Executes only a human-selected, tenant-scoped duplicate merge. */
export async function mergeDuplicateContacts(input: ContactMergeInput) {
  const data = contactMergeInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "operations",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: merge, error: mergeError } = await supabase
    .rpc("merge_duplicate_contacts", {
      target_organization_id: data.organizationId,
      primary_contact_id: data.primaryContactId,
      duplicate_contact_id: data.duplicateContactId,
    })
    .single();
  if (mergeError || !merge)
    throw new Error("Those contacts could not be merged safely.");

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select()
    .eq("id", merge.surviving_contact_id)
    .eq("organization_id", data.organizationId)
    .single();
  if (contactError || !contact)
    throw new Error("The merged contact could not be reloaded.");
  return { contact, archivedContactId: merge.archived_contact_id };
}

export async function createSavedView(input: SavedViewInput) {
  const data = savedViewInputSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (claimsError || !userId) throw new Error("Sign in is required.");
  const { data: savedView, error } = await supabase
    .from("saved_views")
    .insert({
      organization_id: data.organizationId,
      user_id: userId,
      feature: data.feature,
      name: data.name,
      filters: data.filters,
    })
    .select("id, name, filters, created_at")
    .single();
  if (error?.code === "23505")
    throw new Error("A saved view in this area already uses that name.");
  if (error) throw error;
  return savedView;
}

export async function deleteSavedView(input: SavedViewDeleteInput) {
  const data = savedViewDeleteSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (claimsError || !userId) throw new Error("Sign in is required.");
  const { data: deleted, error } = await supabase
    .from("saved_views")
    .delete()
    .eq("id", data.savedViewId)
    .eq("organization_id", data.organizationId)
    .eq("user_id", userId)
    .eq("feature", data.feature)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!deleted)
    throw new Error("That saved view is not available in this workspace.");
  return deleted;
}

/** Creates a validated tenant-scoped contact batch through one database write. */
export async function importContacts(input: ContactImportInput) {
  const data = contactImportSchema.parse(input);
  await requireOrganizationRole(data.organizationId, CRM_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: contacts, error } = await supabase
    .from("contacts")
    .insert(
      data.rows.map((row) => ({
        organization_id: data.organizationId,
        first_name: row.firstName,
        last_name: row.lastName,
        email: row.email,
        phone: row.phone,
      })),
    )
    .select();
  if (error) throw error;
  const { error: activityError } = await supabase
    .from("activity_events")
    .insert(
      contacts.map((contact) => ({
        organization_id: data.organizationId,
        contact_id: contact.id,
        activity_type: "contact_created",
        body: "Contact imported into AIOS.",
      })),
    );
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "contact_import",
    metadata: { event: "contacts.imported", count: contacts.length },
  });
  return contacts;
}

export async function createCompany(input: CompanyInput) {
  const data = companyInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, CRM_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: company, error } = await supabase
    .from("companies")
    .insert({
      organization_id: data.organizationId,
      name: data.name,
      website: data.website ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      owner_id: data.ownerId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("activity_events").insert({
    organization_id: data.organizationId,
    company_id: company.id,
    activity_type: "company_created",
    body: "Company created in AIOS.",
  });
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "company",
    entityId: company.id,
    metadata: { event: "company.created" },
  });
  return company;
}

export async function addActivityNote(input: ActivityNoteInput) {
  const data = activityNoteInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, CRM_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: note, error } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      contact_id: data.contactId ?? null,
      company_id: data.companyId ?? null,
      deal_id: data.dealId ?? null,
      activity_type: "note",
      body: data.body,
    })
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "activity_event",
    entityId: note.id,
    metadata: { event: "activity.note_created" },
  });
  return note;
}

/** Opens an internal conversation record; it never sends an external message. */
export async function createConversation(input: ConversationInput) {
  const data = conversationInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  if (data.contactId) {
    const { data: contact, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", data.contactId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error || !contact)
      throw new Error(
        "The selected contact is not available in this workspace.",
      );
  }
  if (data.dealId) {
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id")
      .eq("id", data.dealId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error || !deal)
      throw new Error("The selected deal is not available in this workspace.");
  }
  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      organization_id: data.organizationId,
      contact_id: data.contactId ?? null,
      deal_id: data.dealId ?? null,
      channel: "manual",
      subject: data.subject,
      status: "open",
      last_message_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "conversation",
    entityId: conversation.id,
    metadata: { event: "conversation.created", channel: "manual" },
  });
  return conversation;
}

/** Adds an internal CRM note. External delivery is deliberately not implemented here. */
export async function addConversationNote(input: ConversationNoteInput) {
  const data = conversationNoteInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", data.conversationId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (conversationError || !conversation)
    throw new Error(
      "The selected conversation is not available in this workspace.",
    );
  const now = new Date().toISOString();
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      organization_id: data.organizationId,
      conversation_id: conversation.id,
      direction: "internal",
      body: data.body,
      sent_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  const { error: updateError } = await supabase
    .from("conversations")
    .update({ last_message_at: now, status: "open" })
    .eq("id", conversation.id)
    .eq("organization_id", data.organizationId);
  if (updateError) throw updateError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "message",
    entityId: message.id,
    metadata: {
      event: "conversation.internal_note_created",
      conversation_id: conversation.id,
    },
  });
  return message;
}

export async function updateConversationStatus(
  input: ConversationStatusUpdateInput,
) {
  const data = conversationStatusUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .update({
      status: data.status,
      ...(data.status === "closed"
        ? { sla_escalation_level: 0, sla_escalated_at: null }
        : {}),
    })
    .eq("id", data.conversationId)
    .eq("organization_id", data.organizationId)
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "conversation",
    entityId: conversation.id,
    metadata: {
      event: "conversation.status_updated",
      status: conversation.status,
    },
  });
  return conversation;
}

/** Assigns an internal conversation only to an active workspace member. */
export async function updateConversationAssignee(
  input: ConversationAssigneeUpdateInput,
) {
  const data = conversationAssigneeUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  await assertActiveOrganizationMember(
    supabase,
    data.organizationId,
    data.assigneeId,
  );
  const { data: conversation, error } = await supabase
    .from("conversations")
    .update({ assignee_id: data.assigneeId })
    .eq("id", data.conversationId)
    .eq("organization_id", data.organizationId)
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "conversation",
    entityId: conversation.id,
    metadata: {
      event: "conversation.assignee_updated",
      assignee_id: conversation.assignee_id,
    },
  });
  return conversation;
}

/** Records an internal response priority and deadline without sending externally. */
export async function updateConversationSla(
  input: ConversationSlaUpdateInput,
) {
  const data = conversationSlaUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .update({
      priority: data.priority,
      response_due_at: data.responseDueAt,
      sla_escalation_level: 0,
      sla_escalated_at: null,
    })
    .eq("id", data.conversationId)
    .eq("organization_id", data.organizationId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!conversation)
    throw new Error(
      "The selected conversation is not available in this workspace.",
    );

  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      contact_id: conversation.contact_id,
      deal_id: conversation.deal_id,
      activity_type: "conversation_sla_updated",
      body: conversation.response_due_at
        ? `Response priority set to ${conversation.priority} with a deadline.`
        : `Response priority set to ${conversation.priority}; deadline cleared.`,
      metadata: {
        conversation_id: conversation.id,
        priority: conversation.priority,
        response_due_at: conversation.response_due_at,
      },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "conversation",
    entityId: conversation.id,
    metadata: {
      event: "conversation.sla_updated",
      priority: conversation.priority,
      response_due_at: conversation.response_due_at,
    },
  });
  return conversation;
}

/** Creates reusable internal copy only; this action has no delivery capability. */
export async function createMessageTemplate(input: MessageTemplateInput) {
  const data = messageTemplateInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const actorId = claims?.claims.sub;
  if (claimsError || !actorId) throw new Error("Sign in is required.");
  const { data: template, error } = await supabase
    .from("message_templates")
    .insert({
      organization_id: data.organizationId,
      name: data.name,
      kind: data.kind,
      channel: data.channel,
      subject: data.subject,
      body: data.body,
      created_by: actorId,
    })
    .select()
    .single();
  if (error?.code === "23505")
    throw new Error("A message template already uses that name.");
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "message_template",
    entityId: template.id,
    metadata: {
      event: "message_template.created",
      kind: template.kind,
      channel: template.channel,
    },
  });
  return template;
}

/** Retires or restores reusable copy without deleting its audit history. */
export async function updateMessageTemplateStatus(
  input: MessageTemplateStatusUpdateInput,
) {
  const data = messageTemplateStatusUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: template, error } = await supabase
    .from("message_templates")
    .update({ is_active: data.isActive })
    .eq("id", data.templateId)
    .eq("organization_id", data.organizationId)
    .select()
    .maybeSingle();
  if (error || !template)
    throw new Error("That message template is not available.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "message_template",
    entityId: template.id,
    metadata: {
      event: data.isActive
        ? "message_template.restored"
        : "message_template.retired",
      kind: template.kind,
      channel: template.channel,
    },
  });
  return template;
}

/** Saves an internal draft. It never sends or schedules external delivery. */
export async function createMessageDraft(input: MessageDraftInput) {
  const data = messageDraftInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const actorId = claims?.claims.sub;
  if (claimsError || !actorId) throw new Error("Sign in is required.");

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, contact_id, deal_id")
    .eq("id", data.conversationId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (conversationError || !conversation)
    throw new Error(
      "The selected conversation is not available in this workspace.",
    );
  if (data.templateId) {
    const { data: template, error: templateError } = await supabase
      .from("message_templates")
      .select("id")
      .eq("id", data.templateId)
      .eq("organization_id", data.organizationId)
      .eq("is_active", true)
      .maybeSingle();
    if (templateError || !template)
      throw new Error(
        "The selected template is not active in this workspace.",
      );
  }

  const { data: draft, error } = await supabase
    .from("message_drafts")
    .insert({
      organization_id: data.organizationId,
      conversation_id: conversation.id,
      template_id: data.templateId,
      created_by: actorId,
      channel: data.channel,
      recipient: data.recipient,
      subject: data.subject,
      body: data.body,
      status: data.status,
      scheduled_for: data.scheduledFor,
    })
    .select()
    .single();
  if (error) throw error;
  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      contact_id: conversation.contact_id,
      deal_id: conversation.deal_id,
      activity_type: "message_draft_created",
      body: "An internal reply draft was saved. Nothing was sent.",
      metadata: {
        conversation_id: conversation.id,
        draft_id: draft.id,
        channel: draft.channel,
        status: draft.status,
      },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "message_draft",
    entityId: draft.id,
    metadata: {
      event: "message_draft.created",
      conversation_id: conversation.id,
      channel: draft.channel,
      status: draft.status,
      scheduled_for: draft.scheduled_for,
    },
  });
  return draft;
}

/** Revises an existing internal draft; delivery remains a separate hard gate. */
export async function updateMessageDraft(input: MessageDraftUpdateInput) {
  const data = messageDraftUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, INBOX_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  if (data.templateId) {
    const { data: template, error: templateError } = await supabase
      .from("message_templates")
      .select("id")
      .eq("id", data.templateId)
      .eq("organization_id", data.organizationId)
      .eq("is_active", true)
      .maybeSingle();
    if (templateError || !template)
      throw new Error(
        "The selected template is not active in this workspace.",
      );
  }
  const { data: draft, error } = await supabase
    .from("message_drafts")
    .update({
      template_id: data.templateId,
      channel: data.channel,
      recipient: data.recipient,
      subject: data.subject,
      body: data.body,
      status: data.status,
      scheduled_for: data.scheduledFor,
    })
    .eq("id", data.draftId)
    .eq("organization_id", data.organizationId)
    .is("archived_at", null)
    .select()
    .maybeSingle();
  if (error || !draft)
    throw new Error("That message draft is not available.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "message_draft",
    entityId: draft.id,
    metadata: {
      event: "message_draft.updated",
      conversation_id: draft.conversation_id,
      channel: draft.channel,
      status: draft.status,
      scheduled_for: draft.scheduled_for,
    },
  });
  return draft;
}

export async function createDeal(input: DealInput) {
  const data = dealInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DEAL_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      organization_id: data.organizationId,
      contact_id: data.contactId ?? null,
      owner_id: data.ownerId ?? null,
      title: data.title,
      stage: data.stage,
      value_amount: data.valueAmount ?? null,
      currency: data.currency,
      source: data.source ?? null,
      source_campaign: data.sourceCampaign ?? null,
      destination: data.destination ?? null,
      probability: data.probability,
      next_step: data.nextStep ?? null,
      expected_close_at: data.expectedCloseAt ?? null,
      last_activity_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("activity_events").insert({
    organization_id: data.organizationId,
    contact_id: deal.contact_id,
    deal_id: deal.id,
    activity_type: "deal_created",
    body: `Deal created at ${deal.stage} stage.`,
  });
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "deal",
    entityId: deal.id,
    metadata: { event: "deal.created", stage: deal.stage },
  });
  return deal;
}

/**
 * Stores a private traveller document and its tenant-scoped database record.
 * Browser clients never receive the service-role key and cannot overwrite or
 * delete objects from the travel-document bucket.
 */
export async function uploadTravelDocument(
  input: TravelDocumentUploadInput,
  formData: FormData,
) {
  const data = travelDocumentUploadSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DOCUMENT_WRITE_ROLES);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new Error("Choose a travel document to upload.");
  if (file.size > MAX_TRAVEL_DOCUMENT_BYTES)
    throw new Error("Travel documents must be 15 MB or smaller.");
  if (!TRAVEL_DOCUMENT_MIME_TYPES.has(file.type))
    throw new Error(
      "Upload a PDF, JPEG, PNG, WebP, HEIC, or HEIF travel document.",
    );
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesTravelDocumentSignature(file.type, fileBytes))
    throw new Error(
      "The file contents do not match the selected travel-document format.",
    );

  const supabase = await createSupabaseServerClient();
  const [{ data: claims }, { data: deal, error: dealError }] =
    await Promise.all([
      supabase.auth.getClaims(),
      supabase
        .from("deals")
        .select("id, contact_id")
        .eq("id", data.dealId)
        .eq("organization_id", data.organizationId)
        .maybeSingle(),
    ]);
  const actorId = claims?.claims.sub;
  if (!actorId) throw new Error("Sign in is required.");
  if (dealError || !deal || deal.contact_id !== data.contactId)
    throw new Error(
      "This traveller is not linked to the selected opportunity.",
    );

  const documentId = crypto.randomUUID();
  const fileName = travelDocumentDisplayName(file.name);
  const storagePath = `${data.organizationId}/${documentId}/${travelDocumentStorageName(fileName)}`;
  const { error: uploadError } = await supabase.storage
    .from("travel-documents")
    .upload(storagePath, fileBytes, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
  if (uploadError)
    throw new Error(
      `The private document could not be stored: ${uploadError.message}`,
    );

  const { data: document, error: documentError } = await supabase
    .rpc("record_travel_document", {
      target_organization_id: data.organizationId,
      target_deal_id: data.dealId,
      target_contact_id: data.contactId,
      target_document_id: documentId,
      target_storage_path: storagePath,
      target_file_name: fileName,
      target_mime_type: file.type,
      target_byte_size: file.size,
    });

  if (documentError || !document) {
    const admin = createSupabaseAdminClient();
    await admin.storage.from("travel-documents").remove([storagePath]);
    throw new Error("The document record could not be created.");
  }
  return document;
}

export async function createTask(input: TaskInput) {
  const data = taskInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TASK_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  if (data.contactId) {
    const { data: contact, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", data.contactId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error || !contact)
      throw new Error(
        "The selected contact is not available in this workspace.",
      );
  }
  if (data.dealId) {
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id")
      .eq("id", data.dealId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error || !deal)
      throw new Error("The selected deal is not available in this workspace.");
  }
  await assertActiveOrganizationMember(
    supabase,
    data.organizationId,
    data.assigneeId,
  );
  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: data.organizationId,
      contact_id: data.contactId ?? null,
      deal_id: data.dealId ?? null,
      title: data.title,
      assignee_id: data.assigneeId ?? null,
      due_at: data.dueAt ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("activity_events").insert({
    organization_id: data.organizationId,
    contact_id: task.contact_id,
    deal_id: task.deal_id,
    activity_type: "task_created",
    body: `Task created: ${task.title}`,
  });
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "task",
    entityId: task.id,
    metadata: { event: "task.created" },
  });
  return task;
}

/** Updates an internal follow-up only within the caller's active organization. */
export async function updateTaskStatus(input: TaskStatusUpdateInput) {
  const data = taskStatusUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TASK_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const completedAt =
    data.status === "completed" ? new Date().toISOString() : null;
  const { data: task, error } = await supabase
    .from("tasks")
    .update({ status: data.status, completed_at: completedAt })
    .eq("id", data.taskId)
    .eq("organization_id", data.organizationId)
    .select()
    .single();
  if (error) throw error;
  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      contact_id: task.contact_id,
      deal_id: task.deal_id,
      activity_type: "task_status_changed",
      body: `Task ${data.status.replace("_", " ")}: ${task.title}`,
      metadata: { status: data.status },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "task",
    entityId: task.id,
    metadata: { event: "task.status_updated", status: task.status },
  });
  return task;
}

/** Reassigns an internal task only to another active member of the same organization. */
export async function updateTaskAssignee(input: TaskAssigneeUpdateInput) {
  const data = taskAssigneeUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TASK_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  await assertActiveOrganizationMember(
    supabase,
    data.organizationId,
    data.assigneeId,
  );
  const { data: task, error } = await supabase
    .from("tasks")
    .update({ assignee_id: data.assigneeId })
    .eq("id", data.taskId)
    .eq("organization_id", data.organizationId)
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "task",
    entityId: task.id,
    metadata: { event: "task.assignee_updated", assignee_id: task.assignee_id },
  });
  return task;
}

/** Moves a deal only within the caller's active organization and preserves an audit trail. */
export async function updateDealStage(input: DealStageUpdateInput) {
  const data = dealStageUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DEAL_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: deal, error } = await supabase
    .rpc("transition_deal_stage", {
      target_organization_id: data.organizationId,
      target_deal_id: data.dealId,
      target_stage: data.stage,
      target_lost_reason: data.lostReason ?? null,
    })
    .single();
  if (error || !deal)
    throw new Error(error?.message || "The opportunity stage was not updated.");
  return deal;
}

/** Records a human response and clears any open first-response escalation. */
export async function acknowledgeLeadResponse(input: DealResponseInput) {
  const data = dealResponseInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DEAL_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: deal, error } = await supabase
    .rpc("acknowledge_lead_response", {
      target_organization_id: data.organizationId,
      target_deal_id: data.dealId,
    })
    .single();
  if (error || !deal)
    throw new Error(error?.message || "The lead response was not recorded.");
  return deal;
}

/** Creates a tenant-owned public capture endpoint without exposing table writes. */
export async function createLeadCaptureForm(input: LeadCaptureFormInput) {
  const data = leadCaptureFormInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
  ]);
  const supabase = await createSupabaseServerClient();
  await assertActiveOrganizationMember(
    supabase,
    data.organizationId,
    data.defaultOwnerId,
  );
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (claimsError || !userId) throw new Error("Sign in is required.");
  const { data: form, error } = await supabase
    .from("lead_capture_forms")
    .insert({
      organization_id: data.organizationId,
      name: data.name,
      headline: data.headline,
      source: data.source,
      default_owner_id: data.defaultOwnerId,
      first_response_minutes: data.firstResponseMinutes,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "lead_capture_form",
    entityId: form.id,
    metadata: {
      event: "lead_capture_form.created",
      first_response_minutes: form.first_response_minutes,
    },
  });
  return form;
}

/** Pauses or resumes a public form without deleting its submission history. */
export async function updateLeadCaptureFormStatus(
  input: LeadCaptureFormStatusUpdateInput,
) {
  const data = leadCaptureFormStatusUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: form, error } = await supabase
    .from("lead_capture_forms")
    .update({ is_active: data.isActive })
    .eq("id", data.formId)
    .eq("organization_id", data.organizationId)
    .select()
    .maybeSingle();
  if (error || !form)
    throw new Error(error?.message || "That lead capture form is unavailable.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "lead_capture_form",
    entityId: form.id,
    metadata: {
      event: "lead_capture_form.status_updated",
      is_active: form.is_active,
    },
  });
  return form;
}

/** Assigns an opportunity only to an active member of the current organization. */
export async function updateDealOwner(input: DealOwnerUpdateInput) {
  const data = dealOwnerUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DEAL_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  await assertActiveOrganizationMember(
    supabase,
    data.organizationId,
    data.ownerId,
  );
  const { data: deal, error } = await supabase
    .from("deals")
    .update({ owner_id: data.ownerId })
    .eq("id", data.dealId)
    .eq("organization_id", data.organizationId)
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "deal",
    entityId: deal.id,
    metadata: { event: "deal.owner_updated", owner_id: deal.owner_id },
  });
  return deal;
}

/** Updates commercial planning context within the caller's active organization. */
export async function updateDealCommercialPlan(
  input: DealCommercialPlanUpdateInput,
) {
  const data = dealCommercialPlanUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DEAL_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const updatedAt = new Date().toISOString();
  const { data: deal, error } = await supabase
    .from("deals")
    .update({
      probability: data.probability,
      value_amount: data.valueAmount,
      destination: data.destination,
      next_step: data.nextStep,
      expected_close_at: data.expectedCloseAt,
      follow_up_due_at: data.followUpDueAt,
      last_activity_at: updatedAt,
    })
    .eq("id", data.dealId)
    .eq("organization_id", data.organizationId)
    .select()
    .single();
  if (error) throw error;
  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      deal_id: deal.id,
      activity_type: "deal_commercial_plan_updated",
      body: "Commercial plan updated.",
      metadata: {
        probability: deal.probability,
        value_amount: deal.value_amount,
        destination: deal.destination,
        expected_close_at: deal.expected_close_at,
        follow_up_due_at: deal.follow_up_due_at,
      },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "deal",
    entityId: deal.id,
    metadata: {
      event: "deal.commercial_plan_updated",
      probability: deal.probability,
      value_amount: deal.value_amount,
      destination: deal.destination,
      expected_close_at: deal.expected_close_at,
      follow_up_due_at: deal.follow_up_due_at,
    },
  });
  return deal;
}

/** Creates an internal quote draft and immutable first version in one database transaction. */
export async function createQuoteDraft(input: QuoteDraftInput) {
  const data = quoteDraftInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "trip_designer",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: result, error } = await supabase
    .rpc("create_quote_draft", {
      target_organization_id: data.organizationId,
      target_deal_id: data.dealId,
      quote_title: data.title,
      quote_currency: data.currency,
      quote_valid_until: data.validUntil ?? null,
      quote_total_amount: data.totalAmount,
    })
    .single();
  if (error || !result)
    throw error ?? new Error("Quote draft was not created.");
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select()
    .eq("id", result.quote_id)
    .eq("organization_id", data.organizationId)
    .single();
  if (quoteError || !quote)
    throw quoteError ?? new Error("Quote draft could not be loaded.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "quote",
    entityId: quote.id,
    metadata: {
      event: "quote.draft_created",
      deal_id: data.dealId,
      version: quote.current_version,
      currency: quote.currency,
    },
  });
  return quote;
}

/** Appends an internal price and protected cost estimate; drafts are never overwritten. */
export async function reviseQuoteDraft(input: QuoteRevisionInput) {
  const data = quoteRevisionInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "trip_designer",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: result, error } = await supabase
    .rpc("append_quote_version_with_cost", {
      target_organization_id: data.organizationId,
      target_quote_id: data.quoteId,
      quote_total_amount: data.totalAmount,
      quote_estimated_cost_amount: data.estimatedCostAmount,
    })
    .single();
  if (error || !result)
    throw error ?? new Error("Quote revision was not created.");
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select()
    .eq("id", data.quoteId)
    .eq("organization_id", data.organizationId)
    .single();
  if (quoteError || !quote)
    throw quoteError ?? new Error("Quote revision could not be loaded.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "pricing.changed",
    entityType: "quote",
    entityId: quote.id,
    metadata: {
      event: "quote.version_created",
      version: result.quote_version,
      includes_internal_cost_estimate: true,
    },
  });
  return { quote, version: result.quote_version };
}

/**
 * Opens or returns the human gate for quote delivery. It intentionally creates
 * no outbound message, share link, or customer-visible state change.
 */
export async function requestQuoteShareApproval(input: QuoteShareApprovalInput) {
  const data = quoteShareApprovalInputSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, title, status, current_version")
    .eq("id", data.quoteId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (quoteError || !quote)
    throw quoteError ?? new Error("This quote is not available in this workspace.");
  if (quote.status !== "draft")
    throw new Error("Only an internal draft can be submitted for sharing review.");

  const { data: pendingApproval, error: pendingError } = await supabase
    .from("approval_requests")
    .select("id, approver_id, expires_at")
    .eq("organization_id", data.organizationId)
    .eq("action", "quote.share")
    .eq("entity_type", "quote")
    .eq("entity_id", quote.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) throw pendingError;
  const pendingIsCurrent =
    pendingApproval &&
    (!pendingApproval.expires_at ||
      new Date(pendingApproval.expires_at).getTime() > Date.now());
  if (pendingIsCurrent) {
    return {
      approvalId: pendingApproval.id,
      approverId: pendingApproval.approver_id,
      expiresAt: pendingApproval.expires_at,
      alreadyPending: true,
    };
  }

  const gate = await gateAiosAction({
    organizationId: data.organizationId,
    action: "quote.share",
    entityType: "quote",
    entityId: quote.id,
    payload: {
      quote_id: quote.id,
      quote_version: quote.current_version,
    },
    rationale: `Review requested before sharing quote: ${quote.title}`,
  });
  if (gate.decision !== "approval_required" || !gate.approvalId)
    throw new Error("AIOS could not open the required human sharing review.");
  return {
    approvalId: gate.approvalId,
    approverId: gate.approverId,
    expiresAt: gate.expiresAt,
    alreadyPending: false,
  };
}

/** Opens an internal trip-planning record; it does not create a booking. */
export async function createTripDraft(input: TripDraftInput) {
  const data = tripDraftInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "trip_designer",
    "operations",
  ]);
  const supabase = await createSupabaseServerClient();
  if (data.dealId) {
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id")
      .eq("id", data.dealId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error || !deal)
      throw error ?? new Error("The selected opportunity is not available.");
  }
  const { data: trip, error } = await supabase
    .from("trips")
    .insert({
      organization_id: data.organizationId,
      deal_id: data.dealId ?? null,
      name: data.name,
      status: "draft",
      start_date: data.startDate ?? null,
      end_date: data.endDate ?? null,
      currency: data.currency,
    })
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "trip",
    entityId: trip.id,
    metadata: { event: "trip.draft_created", deal_id: trip.deal_id },
  });
  return trip;
}

/** Appends a planning item atomically so two editors cannot share a position. */
export async function addItineraryItem(input: ItineraryItemInput) {
  const data = itineraryItemInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "trip_designer",
    "operations",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: result, error } = await supabase
    .rpc("append_itinerary_item", {
      target_organization_id: data.organizationId,
      target_trip_id: data.tripId,
      target_day_number: data.dayNumber,
      target_item_type: data.itemType,
      target_title: data.title,
      target_location_name: data.locationName ?? null,
      target_notes: data.notes ?? null,
    })
    .single();
  if (error || !result)
    throw error ?? new Error("AIOS could not add this itinerary item.");
  const { data: item, error: itemError } = await supabase
    .from("itinerary_items")
    .select()
    .eq("id", result.itinerary_item_id)
    .eq("organization_id", data.organizationId)
    .single();
  if (itemError || !item)
    throw itemError ?? new Error("The itinerary item could not be loaded.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "itinerary_item",
    entityId: item.id,
    metadata: { event: "itinerary.item_created", trip_id: data.tripId, day: item.day_number },
  });
  return item;
}

/** Saves an internal trip pattern as a tenant-scoped reusable template. */
export async function createItineraryTemplateFromTrip(
  input: ItineraryTemplateFromTripInput,
) {
  const data = itineraryTemplateFromTripInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "trip_designer",
    "operations",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: templateId, error } = await supabase.rpc(
    "create_itinerary_template_from_trip",
    {
      target_organization_id: data.organizationId,
      source_trip_id: data.sourceTripId,
      template_name: data.name,
      template_description: data.description,
    },
  );
  if (error || !templateId)
    throw error ?? new Error("AIOS could not save this itinerary template.");
  const { data: template, error: templateError } = await supabase
    .from("itinerary_templates")
    .select()
    .eq("id", templateId)
    .eq("organization_id", data.organizationId)
    .single();
  if (templateError || !template)
    throw templateError ?? new Error("The itinerary template could not be loaded.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "itinerary_template",
    entityId: template.id,
    metadata: {
      event: "itinerary.template_created_from_trip",
      source_trip_id: data.sourceTripId,
    },
  });
  return template;
}

/** Applies a saved internal template only after a planner explicitly selects it. */
export async function applyItineraryTemplate(
  input: ItineraryTemplateApplyInput,
) {
  const data = itineraryTemplateApplyInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
    "trip_designer",
    "operations",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: copiedItemCount, error } = await supabase.rpc(
    "append_itinerary_template_to_trip",
    {
      target_organization_id: data.organizationId,
      target_template_id: data.templateId,
      target_trip_id: data.targetTripId,
    },
  );
  if (error)
    throw error ?? new Error("AIOS could not apply this itinerary template.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "trip",
    entityId: data.targetTripId,
    metadata: {
      event: "itinerary.template_applied",
      itinerary_template_id: data.templateId,
      copied_item_count: copiedItemCount,
    },
  });
  return { copiedItemCount: copiedItemCount ?? 0 };
}

/** Adds an append-only internal planning comment to a tenant-scoped trip. */
export async function addItineraryComment(input: ItineraryCommentInput) {
  const data = itineraryCommentInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TASK_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const createdBy = claims?.claims.sub;
  if (claimsError || !createdBy) throw new Error("Sign in is required.");
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id")
    .eq("id", data.tripId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (tripError || !trip)
    throw new Error("This trip is not available in the active workspace.");
  const { data: comment, error } = await supabase
    .from("itinerary_comments")
    .insert({
      organization_id: data.organizationId,
      trip_id: data.tripId,
      body: data.body,
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "itinerary_comment",
    entityId: comment.id,
    metadata: { event: "itinerary.comment_created", trip_id: data.tripId },
  });
  return comment;
}
