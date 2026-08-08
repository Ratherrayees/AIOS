"use server";

import { createHash, randomBytes } from "node:crypto";

import { recordAuditEvent } from "../../lib/audit";
import {
  requireActiveMembership,
  requireOrganizationRole,
} from "../../lib/authorization";
import {
  activityNoteInputSchema,
  acceptedQuoteReceivablesInputSchema,
  approvedInvoiceIssuanceInputSchema,
  invoiceDraftPreparationInputSchema,
  invoiceIssuanceApprovalInputSchema,
  invoiceIssuerProfileInputSchema,
  invoiceNumberPolicyInputSchema,
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
  followUpSequenceApplySchema,
  followUpSequenceInputSchema,
  qualificationCheckUpdateSchema,
  qualificationChecklistApplySchema,
  qualificationChecklistTemplateInputSchema,
  travelDocumentUploadSchema,
  taskInputSchema,
  taskAssigneeUpdateSchema,
  taskStatusUpdateSchema,
  quoteDraftInputSchema,
  quoteRevisionInputSchema,
  quoteShareApprovalInputSchema,
  quoteSharePublishSchema,
  quoteShareRevokeSchema,
  quotePaymentScheduleInputSchema,
  quoteApprovalPolicyInputSchema,
  quoteCatalogProductInputSchema,
  quoteCatalogProductStatusInputSchema,
  quoteCatalogRateInputSchema,
  quoteProposalContentInputSchema,
  structuredQuoteRevisionInputSchema,
  savedViewDeleteSchema,
  savedViewInputSchema,
  tripBookingInputSchema,
  tripBookingStatusUpdateSchema,
  tripDraftInputSchema,
  tripDocumentDownloadSchema,
  tripDocumentUploadSchema,
  travelerPortalApprovalSchema,
  travelerPortalPublishSchema,
  travelerPortalRevokeSchema,
  operationalExceptionStatusSchema,
  operationsRadarRefreshSchema,
  tripOperationsUpdateSchema,
  tripStatusUpdateSchema,
  tripTravelerInputSchema,
  travelerEntryCheckInputSchema,
  wonDealConversionSchema,
  itineraryItemInputSchema,
  itineraryTemplateApplyInputSchema,
  itineraryTemplateFromTripInputSchema,
  itineraryCommentInputSchema,
  messageDraftInputSchema,
  messageDraftUpdateSchema,
  messageTemplateInputSchema,
  messageTemplateStatusUpdateSchema,
  paymentAllocationInputSchema,
  paymentLinkApprovalInputSchema,
  paymentLinkDraftPreparationInputSchema,
  paymentObligationInputSchema,
  paymentStatusRefreshSchema,
  paymentVoidInputSchema,
  supplierContactInputSchema,
  supplierContractInputSchema,
  supplierProfileInputSchema,
  type ActivityNoteInput,
  type AcceptedQuoteReceivablesInput,
  type ApprovedInvoiceIssuanceInput,
  type InvoiceDraftPreparationInput,
  type InvoiceIssuanceApprovalInput,
  type InvoiceIssuerProfileInput,
  type InvoiceNumberPolicyInput,
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
  type FollowUpSequenceApplyInput,
  type FollowUpSequenceInput,
  type QualificationCheckUpdateInput,
  type QualificationChecklistApplyInput,
  type QualificationChecklistTemplateInput,
  type TravelDocumentUploadInput,
  type TaskInput,
  type TaskAssigneeUpdateInput,
  type TaskStatusUpdateInput,
  type QuoteDraftInput,
  type QuoteRevisionInput,
  type QuoteShareApprovalInput,
  type QuoteSharePublishInput,
  type QuoteShareRevokeInput,
  type QuotePaymentScheduleInput,
  type QuoteApprovalPolicyInput,
  type QuoteCatalogProductInput,
  type QuoteCatalogProductStatusInput,
  type QuoteCatalogRateInput,
  type QuoteProposalContentInput,
  type StructuredQuoteRevisionInput,
  type SavedViewDeleteInput,
  type SavedViewInput,
  type TripBookingInput,
  type TripBookingStatusUpdateInput,
  type TripDraftInput,
  type TripDocumentDownloadInput,
  type TripDocumentUploadInput,
  type TravelerPortalApprovalInput,
  type TravelerPortalPublishInput,
  type TravelerPortalRevokeInput,
  type OperationalExceptionStatusInput,
  type OperationsRadarRefreshInput,
  type TripOperationsUpdateInput,
  type TripStatusUpdateInput,
  type TripTravelerInput,
  type TravelerEntryCheckInput,
  type WonDealConversionInput,
  type ItineraryItemInput,
  type ItineraryTemplateApplyInput,
  type ItineraryTemplateFromTripInput,
  type ItineraryCommentInput,
  type MessageDraftInput,
  type MessageDraftUpdateInput,
  type MessageTemplateInput,
  type MessageTemplateStatusUpdateInput,
  type PaymentAllocationInput,
  type PaymentLinkApprovalInput,
  type PaymentLinkDraftPreparationInput,
  type PaymentObligationInput,
  type PaymentStatusRefreshInput,
  type PaymentVoidInput,
  type SupplierContactInput,
  type SupplierContractInput,
  type SupplierProfileInput,
} from "../../lib/crm/schemas";
import { gateAiosAction } from "./aios";
import {
  matchesTravelDocumentSignature,
  MAX_TRAVEL_DOCUMENT_BYTES,
  TRAVEL_DOCUMENT_MIME_TYPES,
  travelDocumentDisplayName,
  travelDocumentStorageName,
} from "../../lib/crm/travel-documents";
import { safeDealStageError } from "../../lib/crm/deal-stage-errors";
import { safeSalesWorkflowError } from "../../lib/crm/sales-workflow-errors";
import {
  assessQuoteGuardrails,
  DEFAULT_QUOTE_APPROVAL_POLICY,
  type QuoteApprovalPolicy,
} from "../../lib/crm/quote-guardrails";
import {
  isQuoteProposalContentReady,
  QUOTE_PROPOSAL_SCHEMA_VERSION,
} from "../../lib/crm/quote-proposal";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import type { Json } from "../../types/database";

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
const PORTAL_PUBLISH_ROLES = [
  "owner",
  "admin",
  "trip_designer",
  "operations",
] as const;
const TRIP_PLANNING_ROLES = [
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
] as const;
const TRIP_OPERATIONS_ROLES = [
  "owner",
  "admin",
  "trip_designer",
  "operations",
] as const;
const BOOKING_WRITE_ROLES = [
  "owner",
  "admin",
  "trip_designer",
  "operations",
  "finance",
] as const;
const SUPPLIER_WRITE_ROLES = [
  "owner",
  "admin",
  "trip_designer",
  "operations",
  "finance",
] as const;
const FINANCE_WRITE_ROLES = ["owner", "admin", "finance"] as const;
const QUOTE_COMMERCIAL_ROLES = [
  "owner",
  "admin",
  "sales",
  "trip_designer",
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
  if (data.tripId) {
    const { data: trip, error } = await supabase
      .from("trips")
      .select("id")
      .eq("id", data.tripId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error || !trip)
      throw new Error("The selected trip is not available in this workspace.");
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
      trip_id: data.tripId ?? null,
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
    trip_id: task.trip_id,
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
      trip_id: task.trip_id,
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
    return {
      ok: false as const,
      message: safeDealStageError(error?.message),
    };
  return { ok: true as const, deal };
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

/** Creates one reusable qualification checklist and all of its items atomically. */
export async function createQualificationChecklistTemplate(
  input: QualificationChecklistTemplateInput,
) {
  const parsed = qualificationChecklistTemplateInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      message:
        parsed.error.issues[0]?.message ||
        "The qualification template is invalid.",
    };
  const data = parsed.data;
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: template, error } = await supabase
    .rpc("create_qualification_checklist_template", {
      target_organization_id: data.organizationId,
      target_name: data.name,
      target_description: data.description ?? "",
      target_items: data.items as Json,
    })
    .single();
  if (error || !template)
    return {
      ok: false as const,
      message: safeSalesWorkflowError(
        "create_qualification",
        error?.message,
        error?.code,
      ),
    };
  return { ok: true as const, template };
}

/** Creates an ordered internal-task playbook; no external send is possible. */
export async function createFollowUpSequence(input: FollowUpSequenceInput) {
  const parsed = followUpSequenceInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      message:
        parsed.error.issues[0]?.message || "The follow-up sequence is invalid.",
    };
  const data = parsed.data;
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "sales",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: sequence, error } = await supabase
    .rpc("create_follow_up_sequence", {
      target_organization_id: data.organizationId,
      target_name: data.name,
      target_description: data.description ?? "",
      target_steps: data.steps as Json,
    })
    .single();
  if (error || !sequence)
    return {
      ok: false as const,
      message: safeSalesWorkflowError(
        "create_sequence",
        error?.message,
        error?.code,
      ),
    };
  return { ok: true as const, sequence };
}

/** Instantiates one reusable checklist on an opportunity without duplicating it. */
export async function applyQualificationChecklist(
  input: QualificationChecklistApplyInput,
) {
  const parsed = qualificationChecklistApplySchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      message: "Choose a valid qualification checklist.",
    };
  const data = parsed.data;
  await requireOrganizationRole(data.organizationId, DEAL_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: itemCount, error } = await supabase.rpc(
    "apply_qualification_checklist",
    {
      target_organization_id: data.organizationId,
      target_deal_id: data.dealId,
      target_template_id: data.templateId,
    },
  );
  if (error)
    return {
      ok: false as const,
      message: safeSalesWorkflowError(
        "apply_qualification",
        error.message,
        error.code,
      ),
    };
  return { ok: true as const, itemCount };
}

/** Completes or reopens a qualification item with actor and time evidence. */
export async function updateQualificationCheck(
  input: QualificationCheckUpdateInput,
) {
  const parsed = qualificationCheckUpdateSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      message: "Choose a valid qualification check.",
    };
  const data = parsed.data;
  await requireOrganizationRole(data.organizationId, DEAL_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: check, error } = await supabase
    .rpc("set_deal_qualification_check", {
      target_organization_id: data.organizationId,
      target_check_id: data.checkId,
      target_is_complete: data.isComplete,
    })
    .single();
  if (error || !check)
    return {
      ok: false as const,
      message: safeSalesWorkflowError(
        "update_qualification",
        error?.message,
        error?.code,
      ),
    };
  return { ok: true as const, check };
}

/** Applies a reusable sequence once and atomically creates only internal tasks. */
export async function applyFollowUpSequence(
  input: FollowUpSequenceApplyInput,
) {
  const parsed = followUpSequenceApplySchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      message: "Choose a valid follow-up sequence.",
    };
  const data = parsed.data;
  await requireOrganizationRole(data.organizationId, DEAL_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: run, error } = await supabase
    .rpc("apply_follow_up_sequence", {
      target_organization_id: data.organizationId,
      target_deal_id: data.dealId,
      target_sequence_id: data.sequenceId,
    })
    .single();
  if (error || !run)
    return {
      ok: false as const,
      message: safeSalesWorkflowError(
        "apply_sequence",
        error?.message,
        error?.code,
      ),
    };
  return { ok: true as const, run };
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
  const [quoteResult, versionResult] = await Promise.all([
    supabase
      .from("quotes")
      .select()
      .eq("id", result.quote_id)
      .eq("organization_id", data.organizationId)
      .single(),
    supabase
      .from("quote_versions")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("quote_id", result.quote_id)
      .eq("version", 1)
      .single(),
  ]);
  if (quoteResult.error || !quoteResult.data)
    throw quoteResult.error ?? new Error("Quote draft could not be loaded.");
  if (versionResult.error || !versionResult.data)
    throw versionResult.error ?? new Error("Quote version could not be loaded.");
  const quote = quoteResult.data;
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
  return { quote, versionId: versionResult.data.id };
}

/** Appends an internal price and protected cost estimate; drafts are never overwritten. */
export async function reviseQuoteDraft(input: QuoteRevisionInput) {
  const data = quoteRevisionInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, QUOTE_COMMERCIAL_ROLES);
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
  const [quoteResult, versionResult] = await Promise.all([
    supabase
      .from("quotes")
      .select()
      .eq("id", data.quoteId)
      .eq("organization_id", data.organizationId)
      .single(),
    supabase
      .from("quote_versions")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("quote_id", data.quoteId)
      .eq("version", result.quote_version)
      .single(),
  ]);
  if (quoteResult.error || !quoteResult.data)
    throw quoteResult.error ?? new Error("Quote revision could not be loaded.");
  if (versionResult.error || !versionResult.data)
    throw versionResult.error ?? new Error("Quote version could not be loaded.");
  const quote = quoteResult.data;
  const { data: commercialTerms, error: commercialTermsError } = await supabase
    .from("quote_version_commercial_terms")
    .select(
      "quote_version_id, gross_markup_amount, gross_markup_percent, commission_basis, commission_percent, estimated_commission_amount, post_commission_margin_amount, post_commission_margin_percent",
    )
    .eq("organization_id", data.organizationId)
    .eq("quote_version_id", versionResult.data.id)
    .single();
  if (commercialTermsError || !commercialTerms)
    throw (
      commercialTermsError ??
      new Error("Quote commercial terms could not be loaded.")
    );
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
  return {
    quote,
    version: result.quote_version,
    versionId: versionResult.data.id,
    commercialTerms,
  };
}

/** Appends one immutable, reconciled sell/tax/cost breakdown; it performs no external action. */
export async function reviseQuoteDraftWithLines(
  input: StructuredQuoteRevisionInput,
) {
  const data = structuredQuoteRevisionInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, QUOTE_COMMERCIAL_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: result, error } = await supabase
    .rpc("append_structured_quote_version", {
      target_organization_id: data.organizationId,
      target_quote_id: data.quoteId,
      target_items: data.items.map((item) => ({
        category: item.category,
        description: item.description,
        quantity: item.quantity,
        unit_price_amount: item.unitPriceAmount,
        unit_cost_amount: item.unitCostAmount,
        discount_amount: item.discountAmount,
        tax_percent: item.taxPercent,
        ...(item.catalogRateId
          ? { catalog_rate_id: item.catalogRateId }
          : {}),
      })) as Json,
    })
    .single();
  if (error || !result)
    throw error ?? new Error("Structured quote pricing was not saved.");
  const [
    { data: quote, error: quoteError },
    { data: lines, error: lineError },
    { data: commercialTerms, error: commercialTermsError },
  ] =
    await Promise.all([
      supabase
        .from("quotes")
        .select()
        .eq("organization_id", data.organizationId)
        .eq("id", data.quoteId)
        .single(),
      supabase
        .from("quote_line_items")
        .select(
          "id, quote_version_id, position, category, description, quantity, unit_price_amount, discount_amount, tax_percent, net_amount, tax_amount, total_amount, catalog_product_id, catalog_rate_id, supplier_id",
        )
        .eq("organization_id", data.organizationId)
        .eq("quote_version_id", result.quote_version_id)
        .order("position"),
      supabase
        .from("quote_version_commercial_terms")
        .select(
          "quote_version_id, gross_markup_amount, gross_markup_percent, commission_basis, commission_percent, estimated_commission_amount, post_commission_margin_amount, post_commission_margin_percent",
        )
        .eq("organization_id", data.organizationId)
        .eq("quote_version_id", result.quote_version_id)
        .single(),
    ]);
  if (quoteError || !quote)
    throw quoteError ?? new Error("The revised quote could not be loaded.");
  if (lineError) throw lineError;
  if (commercialTermsError || !commercialTerms)
    throw (
      commercialTermsError ??
      new Error("Quote commercial terms could not be loaded.")
    );
  return { quote, summary: result, lines: lines ?? [], commercialTerms };
}

/**
 * Appends customer-facing inclusions, exclusions, and terms as a new exact
 * quote revision. Pricing and protected costs are copied; nothing is shared.
 */
export async function reviseQuoteProposalContent(
  input: QuoteProposalContentInput,
) {
  const data = quoteProposalContentInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, QUOTE_COMMERCIAL_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: result, error } = await supabase
    .rpc("append_quote_proposal_content_version", {
      target_organization_id: data.organizationId,
      target_quote_id: data.quoteId,
      target_content: {
        schema_version: QUOTE_PROPOSAL_SCHEMA_VERSION,
        inclusions: data.inclusions,
        exclusions: data.exclusions,
        terms: data.terms,
      },
    })
    .single();
  if (error || !result)
    throw error ?? new Error("Proposal content was not saved.");

  const [quoteResult, versionResult, costResult, lineResult, commercialResult] =
    await Promise.all([
      supabase
        .from("quotes")
        .select()
        .eq("organization_id", data.organizationId)
        .eq("id", data.quoteId)
        .single(),
      supabase
        .from("quote_versions")
        .select(
          "id, quote_id, version, total_amount, net_amount, tax_amount, margin_amount, margin_percent, terms_snapshot",
        )
        .eq("organization_id", data.organizationId)
        .eq("id", result.quote_version_id)
        .single(),
      supabase
        .from("quote_cost_estimates")
        .select("quote_version_id, estimated_cost_amount")
        .eq("organization_id", data.organizationId)
        .eq("quote_version_id", result.quote_version_id)
        .maybeSingle(),
      supabase
        .from("quote_line_items")
        .select(
          "id, quote_version_id, position, category, description, quantity, unit_price_amount, discount_amount, tax_percent, net_amount, tax_amount, total_amount, catalog_product_id, catalog_rate_id, supplier_id",
        )
        .eq("organization_id", data.organizationId)
        .eq("quote_version_id", result.quote_version_id)
        .order("position"),
      supabase
        .from("quote_version_commercial_terms")
        .select(
          "quote_version_id, gross_markup_amount, gross_markup_percent, commission_basis, commission_percent, estimated_commission_amount, post_commission_margin_amount, post_commission_margin_percent",
        )
        .eq("organization_id", data.organizationId)
        .eq("quote_version_id", result.quote_version_id)
        .maybeSingle(),
    ]);
  if (quoteResult.error || !quoteResult.data)
    throw quoteResult.error ?? new Error("The revised quote could not be loaded.");
  if (versionResult.error || !versionResult.data)
    throw versionResult.error ?? new Error("The proposal revision could not be loaded.");
  if (costResult.error) throw costResult.error;
  if (lineResult.error) throw lineResult.error;
  if (commercialResult.error) throw commercialResult.error;
  return {
    quote: quoteResult.data,
    version: versionResult.data,
    cost: costResult.data,
    lines: lineResult.data ?? [],
    commercialTerms: commercialResult.data,
  };
}

/**
 * Appends customer payment terms for the exact current quote version. This
 * records no receivable, issues no invoice, collects no money, and sends
 * nothing externally.
 */
export async function saveQuotePaymentSchedule(
  input: QuotePaymentScheduleInput,
) {
  const data = quotePaymentScheduleInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, QUOTE_COMMERCIAL_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: schedule, error } = await supabase
    .rpc("append_quote_payment_schedule", {
      target_organization_id: data.organizationId,
      target_quote_id: data.quoteId,
      target_items: data.items.map((item) => ({
        kind: item.kind,
        label: item.label,
        amount: item.amount,
        due_date: item.dueDate,
      })),
    })
    .single();
  if (error || !schedule)
    throw new Error(
      error?.message || "The quote payment schedule could not be saved.",
    );
  return {
    ...schedule,
    item_count: schedule.item_count ?? data.items.length,
  };
}

/** Creates one reusable product and its first human-published internal rate. */
export async function createQuoteCatalogProduct(
  input: QuoteCatalogProductInput,
) {
  const data = quoteCatalogProductInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, SUPPLIER_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: result, error } = await supabase
    .rpc("create_quote_catalog_product", {
      target_organization_id: data.organizationId,
      target_supplier_id: data.supplierId ?? null,
      target_category: data.category,
      target_name: data.name,
      target_description: data.description,
      target_unit_label: data.unitLabel,
      target_currency: data.currency,
      target_unit_sell_amount: data.unitSellAmount,
      target_unit_cost_amount: data.unitCostAmount,
      target_tax_percent: data.taxPercent,
      target_valid_from: data.validFrom,
      target_valid_until: data.validUntil ?? null,
    })
    .single();
  if (error || !result)
    throw error ?? new Error("The quote catalog product was not created.");
  return result;
}

/** Appends an immutable effective-dated rate; existing quote snapshots do not change. */
export async function publishQuoteCatalogRate(input: QuoteCatalogRateInput) {
  const data = quoteCatalogRateInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, SUPPLIER_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: result, error } = await supabase
    .rpc("publish_quote_catalog_rate", {
      target_organization_id: data.organizationId,
      target_product_id: data.productId,
      target_unit_sell_amount: data.unitSellAmount,
      target_unit_cost_amount: data.unitCostAmount,
      target_tax_percent: data.taxPercent,
      target_valid_from: data.validFrom,
      target_valid_until: data.validUntil ?? null,
    })
    .single();
  if (error || !result)
    throw error ?? new Error("The catalog rate was not published.");
  return result;
}

/** Archives or restores a product without deleting rate or quote history. */
export async function setQuoteCatalogProductStatus(
  input: QuoteCatalogProductStatusInput,
) {
  const data = quoteCatalogProductStatusInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, SUPPLIER_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: product, error } = await supabase
    .rpc("set_quote_catalog_product_status", {
      target_organization_id: data.organizationId,
      target_product_id: data.productId,
      target_status: data.status,
      target_reason: data.reason,
    })
    .single();
  if (error || !product)
    throw error ?? new Error("The catalog product status was not updated.");
  return product;
}

/** Updates bounded tenant quote-review rules; it never shares or changes a quote. */
export async function updateQuoteApprovalPolicy(
  input: QuoteApprovalPolicyInput,
) {
  const data = quoteApprovalPolicyInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, ["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: policy, error } = await supabase
    .rpc("upsert_quote_approval_policy", {
      target_organization_id: data.organizationId,
      target_minimum_margin_percent: data.minimumMarginPercent,
      target_require_cost_estimate: data.requireCostEstimate,
      target_require_valid_until: data.requireValidUntil,
      target_maximum_validity_days: data.maximumValidityDays,
      target_maximum_discount_percent: data.maximumDiscountPercent,
      target_minimum_markup_percent: data.minimumMarkupPercent,
      target_commission_basis: data.commissionBasis,
      target_commission_percent: data.commissionPercent,
      target_minimum_post_commission_margin_percent:
        data.minimumPostCommissionMarginPercent,
      target_enforce_standard_terms: data.enforceStandardTerms,
      target_standard_terms: data.standardTerms,
    })
    .single();
  if (error || !policy)
    throw error ?? new Error("Quote guardrails were not updated.");
  return policy;
}

/**
 * Opens or returns the human gate for quote delivery. It intentionally creates
 * no outbound message, share link, or customer-visible state change.
 */
export async function requestQuoteShareApproval(input: QuoteShareApprovalInput) {
  const data = quoteShareApprovalInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, QUOTE_COMMERCIAL_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, status, current_version, valid_until")
    .eq("id", data.quoteId)
    .eq("organization_id", data.organizationId)
    .maybeSingle();
  if (quoteError || !quote)
    throw quoteError ?? new Error("This quote is not available in this workspace.");
  if (quote.status !== "draft")
    throw new Error("Only an internal draft can be submitted for sharing review.");

  const [versionResult, policyResult] = await Promise.all([
    supabase
      .from("quote_versions")
      .select("id, total_amount, net_amount, terms_snapshot")
      .eq("organization_id", data.organizationId)
      .eq("quote_id", quote.id)
      .eq("version", quote.current_version)
      .maybeSingle(),
    supabase
      .from("quote_approval_policies")
      .select(
        "minimum_margin_percent, minimum_markup_percent, require_cost_estimate, require_valid_until, maximum_validity_days, maximum_discount_percent, commission_basis, commission_percent, minimum_post_commission_margin_percent, enforce_standard_terms, standard_terms",
      )
      .eq("organization_id", data.organizationId)
      .maybeSingle(),
  ]);
  if (versionResult.error) throw versionResult.error;
  if (policyResult.error) throw policyResult.error;

  let cost: { estimated_cost_amount: number } | null = null;
  let pricingLines: Array<{
    quantity: number;
    unit_price_amount: number;
    discount_amount: number;
  }> = [];
  if (versionResult.data) {
    const [costResult, lineResult] = await Promise.all([
      supabase
        .from("quote_cost_estimates")
        .select("estimated_cost_amount")
        .eq("organization_id", data.organizationId)
        .eq("quote_version_id", versionResult.data.id)
        .maybeSingle(),
      supabase
        .from("quote_line_items")
        .select("quantity, unit_price_amount, discount_amount")
        .eq("organization_id", data.organizationId)
        .eq("quote_version_id", versionResult.data.id),
    ]);
    if (costResult.error) throw costResult.error;
    if (lineResult.error) throw lineResult.error;
    cost = costResult.data;
    pricingLines = lineResult.data ?? [];
  }
  const listAmount = pricingLines.reduce(
    (sum, line) => sum + Number(line.quantity) * Number(line.unit_price_amount),
    0,
  );
  const discountAmount = pricingLines.reduce(
    (sum, line) => sum + Number(line.discount_amount),
    0,
  );

  const policy: QuoteApprovalPolicy = policyResult.data
    ? {
        minimumMarginPercent: Number(
          policyResult.data.minimum_margin_percent,
        ),
        minimumMarkupPercent: Number(
          policyResult.data.minimum_markup_percent,
        ),
        requireCostEstimate: policyResult.data.require_cost_estimate,
        requireValidUntil: policyResult.data.require_valid_until,
        maximumValidityDays: policyResult.data.maximum_validity_days,
        maximumDiscountPercent: Number(
          policyResult.data.maximum_discount_percent,
        ),
        commissionBasis: policyResult.data.commission_basis as
          | "net_sell"
          | "gross_margin",
        commissionPercent: Number(policyResult.data.commission_percent),
        minimumPostCommissionMarginPercent: Number(
          policyResult.data.minimum_post_commission_margin_percent,
        ),
        enforceStandardTerms: policyResult.data.enforce_standard_terms,
        standardTerms: Array.isArray(policyResult.data.standard_terms)
          ? policyResult.data.standard_terms.filter(
              (term): term is string => typeof term === "string",
            )
          : [],
      }
    : DEFAULT_QUOTE_APPROVAL_POLICY;
  const guardrails = assessQuoteGuardrails(
    {
      status: quote.status,
      totalAmount: versionResult.data?.total_amount ?? null,
      netAmount: versionResult.data?.net_amount ?? null,
      estimatedCostAmount: cost?.estimated_cost_amount ?? null,
      validUntil: quote.valid_until,
      proposalContentReady: isQuoteProposalContentReady(
        versionResult.data?.terms_snapshot,
      ),
      listAmount,
      discountAmount,
      proposalTerms:
        versionResult.data?.terms_snapshot &&
        typeof versionResult.data.terms_snapshot === "object" &&
        !Array.isArray(versionResult.data.terms_snapshot) &&
        Array.isArray(versionResult.data.terms_snapshot.terms)
          ? versionResult.data.terms_snapshot.terms.filter(
              (term): term is string => typeof term === "string",
            )
          : [],
    },
    policy,
  );
  if (!guardrails.canRequestReview) {
    throw new Error(
      `Complete quote guardrails before review: ${guardrails.blockers
        .map((blocker) => blocker.label)
        .join("; ")}.`,
    );
  }

  const { data: pendingApproval, error: pendingError } = await supabase
    .from("approval_requests")
    .select("id, approver_id, expires_at, payload")
    .eq("organization_id", data.organizationId)
    .eq("action", "quote.share")
    .eq("entity_type", "quote")
    .eq("entity_id", quote.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) throw pendingError;
  const pendingPayload = pendingApproval?.payload;
  const pendingVersion =
    pendingPayload &&
    typeof pendingPayload === "object" &&
    !Array.isArray(pendingPayload)
      ? pendingPayload.quote_version
      : null;
  const pendingIsCurrent =
    pendingApproval &&
    pendingVersion === quote.current_version &&
    (!pendingApproval.expires_at ||
      new Date(pendingApproval.expires_at).getTime() > Date.now());
  if (pendingIsCurrent) {
    return {
      approvalId: pendingApproval.id,
      approverId: pendingApproval.approver_id,
      expiresAt: pendingApproval.expires_at,
      alreadyPending: true,
      guardrailStatus: guardrails.status.code,
      riskCodes: guardrails.riskCodes,
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
      guardrail_status: guardrails.status.code,
      risk_codes: guardrails.riskCodes,
      guardrail_policy: guardrails.policySnapshot,
      external_share_performed: false,
    },
    rationale: `Quote version ${quote.current_version} passed deterministic readiness checks and requires human sharing review.`,
  });
  if (gate.decision !== "approval_required" || !gate.approvalId)
    throw new Error("AIOS could not open the required human sharing review.");
  return {
    approvalId: gate.approvalId,
    approverId: gate.approverId,
    expiresAt: gate.expiresAt,
    alreadyPending: false,
    guardrailStatus: guardrails.status.code,
    riskCodes: guardrails.riskCodes,
  };
}

/**
 * Publishes one expiring, customer-safe snapshot after the database consumes
 * the exact resolved approval. The raw bearer token is returned once and is
 * never persisted in the database, copied into audit evidence, or sent to a
 * customer by this action.
 */
export async function publishQuoteShare(input: QuoteSharePublishInput) {
  const data = quoteSharePublishSchema.parse(input);
  await requireOrganizationRole(data.organizationId, QUOTE_COMMERCIAL_ROLES);
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(
    Date.now() + data.durationDays * 86_400_000,
  ).toISOString();
  const supabase = await createSupabaseServerClient();
  const { data: link, error } = await supabase
    .rpc("publish_quote_share", {
      target_organization_id: data.organizationId,
      target_quote_id: data.quoteId,
      target_approval_id: data.approvalId,
      target_token_hash: tokenHash,
      target_expires_at: expiresAt,
    })
    .single();
  if (error || !link)
    throw new Error(
      error?.message || "The approved public proposal could not be published.",
    );
  return {
    id: link.share_link_id,
    status: link.share_status,
    quoteVersion: link.quote_version,
    publishedAt: link.published_at,
    expiresAt: link.expires_at,
    path: `/proposal/${rawToken}`,
  };
}

/** Immediately invalidates an active proposal link without erasing acceptance evidence. */
export async function revokeQuoteShare(input: QuoteShareRevokeInput) {
  const data = quoteShareRevokeSchema.parse(input);
  await requireOrganizationRole(data.organizationId, QUOTE_COMMERCIAL_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: link, error } = await supabase
    .rpc("revoke_quote_share", {
      target_organization_id: data.organizationId,
      target_share_link_id: data.shareLinkId,
      target_note: data.note,
    })
    .single();
  if (error || !link)
    throw new Error(error?.message || "The public proposal could not be revoked.");
  return {
    id: link.share_link_id,
    status: link.share_status,
    revokedAt: link.revoked_at,
  };
}

/** Opens an internal trip-planning record; it does not create a booking. */
export async function createTripDraft(input: TripDraftInput) {
  const data = tripDraftInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TRIP_PLANNING_ROLES);
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

/** Atomically turns a won opportunity into its one operational trip. */
export async function convertWonDealToTrip(input: WonDealConversionInput) {
  const data = wonDealConversionSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TRIP_PLANNING_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: trip, error } = await supabase
    .rpc("convert_won_deal_to_trip", {
      target_organization_id: data.organizationId,
      target_deal_id: data.dealId,
    })
    .single();
  if (error || !trip)
    throw error ?? new Error("AIOS could not open the operational trip.");
  return trip;
}

/** Updates operational facts without bypassing the governed status lifecycle. */
export async function updateTripOperations(input: TripOperationsUpdateInput) {
  const data = tripOperationsUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TRIP_PLANNING_ROLES);
  const supabase = await createSupabaseServerClient();
  await assertActiveOrganizationMember(
    supabase,
    data.organizationId,
    data.ownerId,
  );
  const { data: trip, error } = await supabase
    .from("trips")
    .update({
      name: data.name,
      destination: data.destination,
      start_date: data.startDate,
      end_date: data.endDate,
      currency: data.currency,
      owner_id: data.ownerId,
      operations_notes: data.operationsNotes,
    })
    .eq("organization_id", data.organizationId)
    .eq("id", data.tripId)
    .select()
    .maybeSingle();
  if (error || !trip)
    throw error ?? new Error("This trip is not available in the workspace.");

  const { data: deal } = trip.deal_id
    ? await supabase
        .from("deals")
        .select("contact_id")
        .eq("organization_id", data.organizationId)
        .eq("id", trip.deal_id)
        .maybeSingle()
    : { data: null };
  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      contact_id: deal?.contact_id ?? null,
      deal_id: trip.deal_id,
      trip_id: trip.id,
      activity_type: "trip_updated",
      body: `Trip operations updated: ${trip.name}`,
      metadata: {
        destination: trip.destination,
        start_date: trip.start_date,
        end_date: trip.end_date,
      },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.updated",
    entityType: "trip",
    entityId: trip.id,
    metadata: { event: "trip.operations_updated" },
  });
  return trip;
}

/** Moves a trip through the database-enforced operational lifecycle. */
export async function transitionTripStatus(input: TripStatusUpdateInput) {
  const data = tripStatusUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TRIP_OPERATIONS_ROLES);
  const supabase = await createSupabaseServerClient();
  const args = {
    target_organization_id: data.organizationId,
    target_trip_id: data.tripId,
    target_status: data.status,
    ...(data.note ? { target_note: data.note } : {}),
  };
  const { data: trip, error } = await supabase
    .rpc("transition_trip_status", args)
    .single();
  if (error || !trip)
    throw error ?? new Error("AIOS could not move this trip.");
  return trip;
}

/** Adds a traveller to a tenant-scoped operational roster. */
export async function addTripTraveler(input: TripTravelerInput) {
  const data = tripTravelerInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    ...TRIP_PLANNING_ROLES,
    "agent",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, deal_id")
    .eq("organization_id", data.organizationId)
    .eq("id", data.tripId)
    .maybeSingle();
  if (tripError || !trip)
    throw new Error("This trip is not available in the workspace.");
  if (data.contactId) {
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("id", data.contactId)
      .is("archived_at", null)
      .maybeSingle();
    if (contactError || !contact)
      throw new Error("That traveller contact is not available.");
  }

  const { data: traveler, error } = await supabase
    .from("travelers")
    .insert({
      organization_id: data.organizationId,
      trip_id: data.tripId,
      contact_id: data.contactId ?? null,
      first_name: data.firstName,
      last_name: data.lastName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      date_of_birth: data.dateOfBirth ?? null,
      role: data.role,
      preferences: data.preferences
        ? { internal_notes: data.preferences }
        : {},
    })
    .select()
    .single();
  if (error) throw error;
  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      deal_id: trip.deal_id,
      trip_id: trip.id,
      activity_type: "traveler_added",
      body: `Traveller added: ${traveler.first_name}${traveler.last_name ? ` ${traveler.last_name}` : ""}`,
      metadata: { traveler_id: traveler.id, role: traveler.role },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "traveler",
    entityId: traveler.id,
    metadata: { event: "trip.traveler_added", trip_id: trip.id },
  });
  return traveler;
}

/**
 * Records a human-reviewed entry-readiness checkpoint without storing a
 * passport number or allowing AIOS to make an immigration determination.
 */
export async function upsertTravelerEntryCheck(
  input: TravelerEntryCheckInput,
) {
  const data = travelerEntryCheckInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, [
    "owner",
    "admin",
    "trip_designer",
    "operations",
    "agent",
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: entryCheck, error } = await supabase
    .rpc("upsert_traveler_entry_check", {
      target_organization_id: data.organizationId,
      target_trip_id: data.tripId,
      target_traveler_id: data.travelerId,
      target_destination_country_code: data.destinationCountryCode,
      target_citizenship_country_code: data.citizenshipCountryCode,
      target_passport_validity_months_required:
        data.passportValidityMonthsRequired,
      target_visa_requirement: data.visaRequirement,
      target_visa_status: data.visaStatus,
      ...(data.passportIssuingCountryCode
        ? {
            target_passport_issuing_country_code:
              data.passportIssuingCountryCode,
          }
        : {}),
      ...(data.passportExpiresOn
        ? { target_passport_expires_on: data.passportExpiresOn }
        : {}),
      ...(data.visaValidUntil
        ? { target_visa_valid_until: data.visaValidUntil }
        : {}),
      ...(data.actionDueOn
        ? { target_action_due_on: data.actionDueOn }
        : {}),
      ...(data.evidenceSourceLabel
        ? { target_evidence_source_label: data.evidenceSourceLabel }
        : {}),
      ...(data.evidenceSourceUrl
        ? { target_evidence_source_url: data.evidenceSourceUrl }
        : {}),
    })
    .single();
  if (error || !entryCheck) {
    throw (
      error ??
      new Error("The traveler entry-readiness review could not be saved.")
    );
  }
  return entryCheck;
}

/** Records an internal supplier-service booking; it never contacts a supplier. */
export async function createTripBooking(input: TripBookingInput) {
  const data = tripBookingInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, BOOKING_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, deal_id")
    .eq("organization_id", data.organizationId)
    .eq("id", data.tripId)
    .maybeSingle();
  if (tripError || !trip)
    throw new Error("This trip is not available in the workspace.");
  if (data.supplierId) {
    const { data: supplier, error: supplierError } = await supabase
      .from("suppliers")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("id", data.supplierId)
      .is("archived_at", null)
      .maybeSingle();
    if (supplierError || !supplier)
      throw new Error("That supplier is not available in the workspace.");
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      organization_id: data.organizationId,
      trip_id: data.tripId,
      supplier_id: data.supplierId ?? null,
      title: data.title,
      booking_type: data.bookingType,
      status: "draft",
      confirmation_reference: data.confirmationReference ?? null,
      service_start_at: data.serviceStartAt ?? null,
      service_end_at: data.serviceEndAt ?? null,
      cost_amount: data.costAmount ?? null,
      currency: data.currency,
      details: data.notes ? { internal_notes: data.notes } : {},
    })
    .select()
    .single();
  if (error) throw error;
  const { error: activityError } = await supabase
    .from("activity_events")
    .insert({
      organization_id: data.organizationId,
      deal_id: trip.deal_id,
      trip_id: trip.id,
      activity_type: "booking_created",
      body: `Internal booking record created: ${booking.title}`,
      metadata: {
        booking_id: booking.id,
        booking_type: booking.booking_type,
      },
    });
  if (activityError) throw activityError;
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "booking",
    entityId: booking.id,
    metadata: { event: "trip.booking_created", trip_id: trip.id },
  });
  return booking;
}

/** Advances internal booking tracking through the guarded database lifecycle. */
export async function updateTripBookingStatus(
  input: TripBookingStatusUpdateInput,
) {
  const data = tripBookingStatusUpdateSchema.parse(input);
  await requireOrganizationRole(data.organizationId, BOOKING_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const args = {
    target_organization_id: data.organizationId,
    target_trip_id: data.tripId,
    target_booking_id: data.bookingId,
    target_status: data.status,
    ...(data.confirmationReference
      ? { target_confirmation_reference: data.confirmationReference }
      : {}),
  };
  const { data: booking, error } = await supabase
    .rpc("transition_booking_status", args)
    .single();
  if (error || !booking)
    throw error ?? new Error("AIOS could not move this booking.");
  return booking;
}

/** Uploads a private document and binds it to a single operational trip. */
export async function uploadTripDocument(
  input: TripDocumentUploadInput,
  formData: FormData,
) {
  const data = tripDocumentUploadSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DOCUMENT_WRITE_ROLES);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new Error("Choose a trip document to upload.");
  if (file.size > MAX_TRAVEL_DOCUMENT_BYTES)
    throw new Error("Trip documents must be 15 MB or smaller.");
  if (!TRAVEL_DOCUMENT_MIME_TYPES.has(file.type))
    throw new Error(
      "Upload a PDF, JPEG, PNG, WebP, HEIC, or HEIF trip document.",
    );
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesTravelDocumentSignature(file.type, fileBytes))
    throw new Error(
      "The file contents do not match the selected trip-document format.",
    );

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) throw new Error("Sign in is required.");
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id")
    .eq("organization_id", data.organizationId)
    .eq("id", data.tripId)
    .maybeSingle();
  if (tripError || !trip)
    throw new Error("This trip is not available in the workspace.");

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

  const rpcArgs = {
    target_organization_id: data.organizationId,
    target_trip_id: data.tripId,
    target_document_id: documentId,
    target_storage_path: storagePath,
    target_file_name: fileName,
    target_mime_type: file.type,
    target_byte_size: file.size,
    ...(data.expiresAt ? { target_expires_at: data.expiresAt } : {}),
  };
  const { data: document, error: documentError } = await supabase
    .rpc("record_trip_document", rpcArgs)
    .single();
  if (documentError || !document) {
    const admin = createSupabaseAdminClient();
    await admin.storage.from("travel-documents").remove([storagePath]);
    throw new Error("The trip document record could not be created.");
  }
  const { data: classifiedDocument, error: classificationError } =
    await supabase
      .rpc("classify_trip_document", {
        target_organization_id: data.organizationId,
        target_trip_id: data.tripId,
        target_document_id: document.id,
        target_document_kind: data.documentKind,
      })
      .single();
  if (classificationError || !classifiedDocument) {
    const admin = createSupabaseAdminClient();
    await admin.from("documents").delete().eq("id", document.id);
    await admin.storage.from("travel-documents").remove([storagePath]);
    throw new Error("The trip document could not be classified safely.");
  }
  return classifiedDocument;
}

/** Issues a short-lived, RLS-authorized download URL for a private trip file. */
export async function createTripDocumentDownload(
  input: TripDocumentDownloadInput,
) {
  const data = tripDocumentDownloadSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DOCUMENT_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: document, error } = await supabase
    .from("documents")
    .select("id, storage_path, file_name")
    .eq("organization_id", data.organizationId)
    .eq("trip_id", data.tripId)
    .eq("id", data.documentId)
    .maybeSingle();
  if (error || !document)
    throw new Error("This private document is not available.");
  const { data: signed, error: signedError } = await supabase.storage
    .from("travel-documents")
    .createSignedUrl(document.storage_path, 60, {
      download: document.file_name,
    });
  if (signedError || !signed?.signedUrl)
    throw new Error("The secure download link could not be created.");
  return { url: signed.signedUrl, expiresInSeconds: 60 };
}

/**
 * Requests a non-bypassable human decision for one frozen traveler-portal
 * scope. No link or customer-visible state is created at this step.
 */
export async function requestTravelerPortalApproval(
  input: TravelerPortalApprovalInput,
) {
  const data = travelerPortalApprovalSchema.parse(input);
  await requireOrganizationRole(data.organizationId, DOCUMENT_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id")
    .eq("organization_id", data.organizationId)
    .eq("id", data.tripId)
    .maybeSingle();
  if (tripError || !trip)
    throw new Error("This trip is not available in the workspace.");

  if (data.documentIds.length > 0) {
    const { data: documents, error: documentsError } = await supabase
      .from("documents")
      .select("id, sensitivity, document_kind")
      .eq("organization_id", data.organizationId)
      .eq("trip_id", data.tripId)
      .in("id", data.documentIds);
    const shareableKinds = new Set([
      "voucher",
      "ticket",
      "insurance",
      "visa",
      "other",
    ]);
    if (
      documentsError ||
      documents?.length !== data.documentIds.length ||
      documents.some(
        (document) =>
          document.sensitivity !== "normal" ||
          !shareableKinds.has(document.document_kind),
      )
    ) {
      throw new Error(
        "Only selected, normal-sensitivity traveler documents can be shared.",
      );
    }
  }

  const { data: existingReview } = await supabase
    .from("approval_requests")
    .select("id, status")
    .eq("organization_id", data.organizationId)
    .eq("action", "document.share")
    .eq("entity_type", "trip")
    .eq("entity_id", data.tripId)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingReview) {
    const { data: existingPortal } = await supabase
      .from("trip_portal_links")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("approval_request_id", existingReview.id)
      .maybeSingle();
    if (!existingPortal) {
      throw new Error(
        existingReview.status === "pending"
          ? "This trip already has a traveler-share request awaiting review."
          : "Publish the already-approved traveler portal before requesting another.",
      );
    }
  }

  const portalExpiresAt = new Date(
    Date.now() + data.durationDays * 86_400_000,
  ).toISOString();
  const decision = await gateAiosAction({
    organizationId: data.organizationId,
    action: "document.share",
    entityType: "trip",
    entityId: data.tripId,
    payload: {
      schema_version: 1,
      document_ids: data.documentIds,
      include_payment_status: data.includePaymentStatus,
      portal_expires_at: portalExpiresAt,
    },
    rationale:
      "Publish an expiring traveler portal with only the explicitly reviewed snapshot and files.",
  });
  if (decision.decision !== "approval_required") {
    throw new Error(
      decision.reason ||
        "Traveler sharing is unavailable until a human approval can be routed.",
    );
  }
  return decision;
}

/**
 * Publishes or safely rotates a portal token only after the database verifies
 * the exact trip-scoped approval. The raw token is returned once and is never
 * persisted.
 */
export async function publishTravelerPortal(
  input: TravelerPortalPublishInput,
) {
  const data = travelerPortalPublishSchema.parse(input);
  await requireOrganizationRole(data.organizationId, PORTAL_PUBLISH_ROLES);
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const supabase = await createSupabaseServerClient();
  const { data: portal, error } = await supabase
    .rpc("publish_traveler_portal", {
      target_organization_id: data.organizationId,
      target_trip_id: data.tripId,
      target_approval_id: data.approvalId,
      target_token_hash: tokenHash,
    })
    .single();
  if (error || !portal)
    throw new Error(
      error?.message ||
        "The approved traveler portal could not be published.",
    );
  return {
    id: portal.id,
    status: portal.status,
    expiresAt: portal.expires_at,
    path: `/portal/${rawToken}`,
  };
}

/** Immediately invalidates an active traveler link with human evidence. */
export async function revokeTravelerPortal(
  input: TravelerPortalRevokeInput,
) {
  const data = travelerPortalRevokeSchema.parse(input);
  await requireOrganizationRole(data.organizationId, PORTAL_PUBLISH_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: portal, error } = await supabase
    .rpc("revoke_traveler_portal", {
      target_organization_id: data.organizationId,
      target_portal_link_id: data.portalLinkId,
      target_note: data.note,
    })
    .single();
  if (error || !portal)
    throw new Error(
      error?.message || "The traveler portal could not be revoked.",
    );
  return {
    id: portal.id,
    status: portal.status,
    revokedAt: portal.revoked_at,
  };
}

/**
 * Runs the bounded internal rules engine. It can create or clear internal
 * exception records, but it cannot contact suppliers or commit bookings.
 */
export async function refreshOperationsRadar(
  input: OperationsRadarRefreshInput,
) {
  const data = operationsRadarRefreshSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TRIP_OPERATIONS_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: summary, error } = await supabase
    .rpc("refresh_operational_exceptions", {
      target_organization_id: data.organizationId,
    })
    .single();
  if (error || !summary)
    throw error ?? new Error("Operations Radar could not complete its scan.");
  return summary;
}

/** Records explicit human ownership or resolution of an operational risk. */
export async function updateOperationalExceptionStatus(
  input: OperationalExceptionStatusInput,
) {
  const data = operationalExceptionStatusSchema.parse(input);
  await requireOrganizationRole(data.organizationId, TRIP_OPERATIONS_ROLES);
  const supabase = await createSupabaseServerClient();
  const args = {
    target_organization_id: data.organizationId,
    target_exception_id: data.exceptionId,
    target_status: data.status,
    ...(data.note ? { target_note: data.note } : {}),
  };
  const { data: exception, error } = await supabase
    .rpc("set_operational_exception_status", args)
    .single();
  if (error || !exception)
    throw error ?? new Error("The operational exception could not be updated.");
  return exception;
}

/** Creates a tenant-scoped supplier profile without contacting the supplier. */
export async function createSupplierProfile(input: SupplierProfileInput) {
  const data = supplierProfileInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, SUPPLIER_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: supplier, error } = await supabase
    .from("suppliers")
    .insert({
      organization_id: data.organizationId,
      name: data.name,
      category: data.category ?? null,
      contact_name: data.contactName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      website: data.website ?? null,
      preferred_currency: data.preferredCurrency,
      payment_terms_days: data.paymentTermsDays ?? null,
      cancellation_terms: data.cancellationTerms ?? null,
      internal_notes: data.internalNotes ?? null,
      quality_rating: data.qualityRating ?? null,
      status: "active",
    })
    .select()
    .single();
  if (error || !supplier)
    throw error ?? new Error("The supplier profile could not be created.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "supplier",
    entityId: supplier.id,
    metadata: {
      event: "supplier.profile_created",
      category: supplier.category,
    },
  });
  return supplier;
}

/** Adds an internal supplier contact; no message is sent. */
export async function createSupplierContact(input: SupplierContactInput) {
  const data = supplierContactInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, SUPPLIER_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id")
    .eq("organization_id", data.organizationId)
    .eq("id", data.supplierId)
    .is("archived_at", null)
    .maybeSingle();
  if (supplierError || !supplier)
    throw new Error("That supplier is not available in this workspace.");

  const { data: contact, error } = await supabase
    .from("supplier_contacts")
    .insert({
      organization_id: data.organizationId,
      supplier_id: data.supplierId,
      name: data.name,
      role_title: data.roleTitle ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      is_primary: data.isPrimary,
      notes: data.notes ?? null,
    })
    .select()
    .single();
  if (error?.code === "23505")
    throw new Error(
      "This supplier already has a primary contact. Add this person as another contact.",
    );
  if (error || !contact)
    throw error ?? new Error("The supplier contact could not be added.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "supplier_contact",
    entityId: contact.id,
    metadata: {
      event: "supplier.contact_created",
      supplier_id: data.supplierId,
      is_primary: contact.is_primary,
    },
  });
  return contact;
}

/** Records contract terms for internal use; it never accepts or signs terms. */
export async function createSupplierContract(input: SupplierContractInput) {
  const data = supplierContractInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, SUPPLIER_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const actorId = claims?.claims.sub;
  if (claimsError || !actorId) throw new Error("Sign in is required.");
  const { data: contract, error } = await supabase
    .from("supplier_contracts")
    .insert({
      organization_id: data.organizationId,
      supplier_id: data.supplierId,
      title: data.title,
      contract_reference: data.contractReference ?? null,
      status: data.status,
      starts_on: data.startsOn ?? null,
      ends_on: data.endsOn ?? null,
      currency: data.currency,
      payment_terms_days: data.paymentTermsDays ?? null,
      cancellation_terms: data.cancellationTerms ?? null,
      internal_notes: data.internalNotes ?? null,
      created_by: actorId,
    })
    .select()
    .single();
  if (error || !contract)
    throw error ?? new Error("The supplier contract could not be recorded.");
  await recordAuditEvent({
    organizationId: data.organizationId,
    eventType: "record.created",
    entityType: "supplier_contract",
    entityId: contract.id,
    metadata: {
      event: "supplier.contract_recorded",
      supplier_id: data.supplierId,
      status: contract.status,
    },
  });
  return contract;
}

/** Creates an internal receivable or payable; no money is moved. */
export async function createPaymentObligation(input: PaymentObligationInput) {
  const data = paymentObligationInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const args = {
    target_organization_id: data.organizationId,
    target_direction: data.direction,
    target_title: data.title,
    target_amount: data.amount,
    target_currency: data.currency,
    ...(data.dueAt ? { target_due_at: data.dueAt } : {}),
    ...(data.dealId ? { target_deal_id: data.dealId } : {}),
    ...(data.tripId ? { target_trip_id: data.tripId } : {}),
    ...(data.supplierId ? { target_supplier_id: data.supplierId } : {}),
    ...(data.invoiceNumber
      ? { target_invoice_number: data.invoiceNumber }
      : {}),
    ...(data.description ? { target_description: data.description } : {}),
  };
  const { data: payment, error } = await supabase
    .rpc("create_payment_obligation", args)
    .single();
  if (error?.code === "23505")
    throw new Error("That invoice number is already in this workspace.");
  if (error || !payment)
    throw error ?? new Error("The payment obligation could not be created.");
  return payment;
}

/**
 * Materializes an accepted quote's exact milestones as internal receivables.
 * It does not issue or deliver an invoice, charge a customer, or record money.
 */
export async function createAcceptedQuoteReceivables(
  input: AcceptedQuoteReceivablesInput,
) {
  const data = acceptedQuoteReceivablesInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: summary, error } = await supabase
    .rpc("create_accepted_quote_receivables", {
      target_organization_id: data.organizationId,
      target_quote_id: data.quoteId,
    })
    .single();
  if (error || !summary)
    throw new Error(
      error?.message || "The accepted quote receivables could not be created.",
    );

  const { data: receivables, error: receivablesError } = await supabase
    .from("payments")
    .select(
      "id, quote_id, quote_version_id, quote_acceptance_id, quote_payment_schedule_id, quote_schedule_item_position, direction, status, title, amount, paid_amount, currency, due_at, invoice_number",
    )
    .eq("organization_id", data.organizationId)
    .eq("quote_acceptance_id", summary.quote_acceptance_id)
    .order("quote_schedule_item_position");
  if (receivablesError || !receivables)
    throw new Error("The receivables were created but could not be reloaded.");

  return { summary, receivables };
}

/** Configures the next-number preview only; it allocates no legal number. */
export async function updateInvoiceNumberPolicy(
  input: InvoiceNumberPolicyInput,
) {
  const data = invoiceNumberPolicyInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: policy, error } = await supabase
    .rpc("upsert_invoice_number_policy", {
      target_organization_id: data.organizationId,
      target_number_prefix: data.numberPrefix,
      target_next_number: data.nextNumber,
      target_number_padding: data.numberPadding,
    })
    .single();
  if (error || !policy)
    throw new Error(
      error?.message || "The invoice numbering policy could not be saved.",
    );
  return policy;
}

/**
 * Freezes an internal pre-issuance invoice pack from accepted quote evidence.
 * It allocates no invoice number, issues no document, and performs no delivery.
 */
export async function prepareAcceptedQuoteInvoiceDraft(
  input: InvoiceDraftPreparationInput,
) {
  const data = invoiceDraftPreparationInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: summary, error } = await supabase
    .rpc("prepare_accepted_quote_invoice_draft", {
      target_organization_id: data.organizationId,
      target_quote_id: data.quoteId,
    })
    .single();
  if (error || !summary)
    throw new Error(
      error?.message || "The invoice draft could not be prepared.",
    );
  return summary;
}

/** Saves the seller identity that will be frozen into approved issuance. */
export async function updateInvoiceIssuerProfile(
  input: InvoiceIssuerProfileInput,
) {
  const data = invoiceIssuerProfileInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: profile, error } = await supabase
    .rpc("upsert_invoice_issuer_profile", {
      target_organization_id: data.organizationId,
      target_legal_name: data.legalName,
      target_registered_address: data.registeredAddress,
      target_jurisdiction_country_code: data.jurisdictionCountryCode,
      ...(data.taxRegistrationId
        ? { target_tax_registration_id: data.taxRegistrationId }
        : {}),
    })
    .single();
  if (error || !profile)
    throw new Error(
      error?.message || "The invoice issuer identity could not be saved.",
    );
  return profile;
}

/** Routes one exact immutable draft and issuer snapshot to a human gate. */
export async function requestInvoiceIssuanceApproval(
  input: InvoiceIssuanceApprovalInput,
) {
  const data = invoiceIssuanceApprovalInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: approval, error } = await supabase
    .rpc("request_invoice_issuance_approval", {
      target_organization_id: data.organizationId,
      target_invoice_draft_id: data.invoiceDraftId,
      target_rationale: data.rationale,
    })
    .single();
  if (error || !approval)
    throw new Error(
      error?.message || "The invoice issuance review could not be requested.",
    );
  return approval;
}

/**
 * Atomically consumes one permanent number after exact human approval. It
 * records issuance but does not render, deliver, message, link, or collect.
 */
export async function issueApprovedInvoice(
  input: ApprovedInvoiceIssuanceInput,
) {
  const data = approvedInvoiceIssuanceInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: issuance, error } = await supabase
    .rpc("issue_approved_invoice", {
      target_organization_id: data.organizationId,
      target_invoice_draft_id: data.invoiceDraftId,
      target_approval_request_id: data.approvalRequestId,
    })
    .single();
  if (error || !issuance)
    throw new Error(
      error?.message || "The approved invoice could not be issued.",
    );
  return issuance;
}

/**
 * Freezes the full current balance of one issued receivable. It creates only
 * internal evidence: no provider link, message, charge, or settlement.
 */
export async function preparePaymentLinkDraft(
  input: PaymentLinkDraftPreparationInput,
) {
  const data = paymentLinkDraftPreparationInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: draft, error } = await supabase
    .rpc("prepare_payment_link_draft", {
      target_organization_id: data.organizationId,
      target_payment_id: data.paymentId,
    })
    .single();
  if (error || !draft)
    throw new Error(
      error?.message || "The exact payment request could not be prepared.",
    );
  return draft;
}

/**
 * Routes one immutable payment-request draft to a finance human. Approval is
 * evidence for a later provider handoff and performs no external effect.
 */
export async function requestPaymentLinkApproval(
  input: PaymentLinkApprovalInput,
) {
  const data = paymentLinkApprovalInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: approval, error } = await supabase
    .rpc("request_payment_link_approval", {
      target_organization_id: data.organizationId,
      target_payment_link_draft_id: data.paymentLinkDraftId,
      target_rationale: data.rationale,
    })
    .single();
  if (error || !approval)
    throw new Error(
      error?.message || "The payment-link review could not be requested.",
    );
  return approval;
}

/** Records evidence of a settlement that already happened; it cannot charge. */
export async function recordPaymentAllocation(
  input: PaymentAllocationInput,
) {
  const data = paymentAllocationInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const args = {
    target_organization_id: data.organizationId,
    target_payment_id: data.paymentId,
    target_amount: data.amount,
    target_occurred_at: data.occurredAt,
    ...(data.reference ? { target_reference: data.reference } : {}),
    ...(data.note ? { target_note: data.note } : {}),
  };
  const { data: payment, error } = await supabase
    .rpc("record_payment_allocation", args)
    .single();
  if (error?.code === "23505")
    throw new Error("That settlement reference has already been recorded.");
  if (error || !payment)
    throw error ?? new Error("The settlement could not be recorded.");
  return payment;
}

/** Voids an unsettled internal obligation with explicit human evidence. */
export async function voidPaymentObligation(input: PaymentVoidInput) {
  const data = paymentVoidInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: payment, error } = await supabase
    .rpc("void_payment_obligation", {
      target_organization_id: data.organizationId,
      target_payment_id: data.paymentId,
      target_reason: data.reason,
    })
    .single();
  if (error || !payment)
    throw error ?? new Error("The payment obligation could not be voided.");
  return payment;
}

/** Recomputes only deterministic internal ledger states from dates and totals. */
export async function refreshPaymentStatuses(
  input: PaymentStatusRefreshInput,
) {
  const data = paymentStatusRefreshSchema.parse(input);
  await requireOrganizationRole(data.organizationId, FINANCE_WRITE_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: summary, error } = await supabase
    .rpc("refresh_payment_obligation_statuses", {
      target_organization_id: data.organizationId,
    })
    .single();
  if (error || !summary)
    throw error ?? new Error("The payment ledger could not refresh.");
  return summary;
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
