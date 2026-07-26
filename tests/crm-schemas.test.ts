import assert from "node:assert/strict";
import test from "node:test";

import {
  companyInputSchema,
  contactImportSchema,
  contactInputSchema,
  contactOwnerUpdateSchema,
  contactPreferencesInputSchema,
  conversationInputSchema,
  conversationNoteInputSchema,
  conversationAssigneeUpdateSchema,
  conversationSlaUpdateSchema,
  conversationStatusUpdateSchema,
  dealCommercialPlanUpdateSchema,
  dealInputSchema,
  dealOwnerUpdateSchema,
  dealStageUpdateSchema,
  quoteDraftInputSchema,
  quoteRevisionInputSchema,
  quoteShareApprovalInputSchema,
  tripDraftInputSchema,
  itineraryItemInputSchema,
  itineraryCommentInputSchema,
  itineraryTemplateApplyInputSchema,
  itineraryTemplateFromTripInputSchema,
  messageDraftInputSchema,
  messageDraftUpdateSchema,
  messageTemplateInputSchema,
  messageTemplateStatusUpdateSchema,
  organizationInvitationAcceptSchema,
  organizationInvitationInputSchema,
  organizationInvitationRevokeSchema,
  organizationMembershipRoleUpdateSchema,
  organizationMembershipStatusUpdateSchema,
  savedViewInputSchema,
  taskInputSchema,
  taskAssigneeUpdateSchema,
  taskStatusUpdateSchema,
} from "../lib/crm/schemas";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("contact email identity is trimmed and normalized", () => {
  const result = contactInputSchema.parse({
    organizationId,
    firstName: "Rayees",
    email: "  RAYEES@STATEAI.IN ",
  });

  assert.equal(result.email, "rayees@stateai.in");
});

test("contacts can be created with no email identity", () => {
  const result = contactInputSchema.parse({
    organizationId,
    firstName: "Walk-in traveller",
    email: null,
  });
  assert.equal(result.email, null);
});

test("recorded communication consent requires a source", () => {
  const result = contactPreferencesInputSchema.safeParse({
    organizationId: crypto.randomUUID(),
    contactId: crypto.randomUUID(),
    consentStatus: "granted",
    consentSource: null,
    preferredChannel: "email",
    preferredLocale: "en-IN",
    timeZone: "Asia/Kolkata",
  });
  assert.equal(result.success, false);
});

test("unknown communication consent cannot carry fabricated evidence", () => {
  const result = contactPreferencesInputSchema.safeParse({
    organizationId: crypto.randomUUID(),
    contactId: crypto.randomUUID(),
    consentStatus: "unknown",
    consentSource: "Assumed from an old spreadsheet",
    preferredChannel: "phone",
    preferredLocale: null,
    timeZone: null,
  });
  assert.equal(result.success, false);
});

test("contact preferences accept a valid channel, locale, and time zone", () => {
  const result = contactPreferencesInputSchema.safeParse({
    organizationId: crypto.randomUUID(),
    contactId: crypto.randomUUID(),
    consentStatus: "withdrawn",
    consentSource: "Customer email",
    preferredChannel: "none",
    preferredLocale: "en-IN",
    timeZone: "Asia/Kolkata",
  });
  assert.equal(result.success, true);
});

test("contact ownership requires tenant-scoped identifiers", () => {
  assert.equal(
    contactOwnerUpdateSchema.safeParse({
      organizationId: crypto.randomUUID(),
      contactId: crypto.randomUUID(),
      ownerId: crypto.randomUUID(),
    }).success,
    true,
  );
  assert.equal(
    contactOwnerUpdateSchema.safeParse({
      organizationId: crypto.randomUUID(),
      contactId: "not-a-contact",
      ownerId: null,
    }).success,
    false,
  );
});

test("saved views validate feature-specific filters", () => {
  assert.equal(
    savedViewInputSchema.safeParse({
      organizationId: crypto.randomUUID(),
      feature: "contacts",
      name: "Kashmir prospects",
      filters: { query: "kashmir" },
    }).success,
    true,
  );
  assert.equal(
    savedViewInputSchema.safeParse({
      organizationId: crypto.randomUUID(),
      feature: "leads",
      name: "Unassigned proposals",
      filters: {
        query: "",
        stage: "proposal",
        ownerId: "unassigned",
        attention: "attention",
      },
    }).success,
    true,
  );
  assert.equal(
    savedViewInputSchema.safeParse({
      organizationId: crypto.randomUUID(),
      feature: "tasks",
      name: "Urgent operations",
      filters: {
        query: "visa",
        assigneeId: "unassigned",
        timing: "overdue",
      },
    }).success,
    true,
  );
  assert.equal(
    savedViewInputSchema.safeParse({
      organizationId: crypto.randomUUID(),
      feature: "inbox",
      name: "Waiting on travellers",
      filters: {
        query: "",
        status: "pending",
        assigneeId: "all",
        sla: "due_soon",
      },
    }).success,
    true,
  );
  assert.equal(
    savedViewInputSchema.safeParse({
      organizationId: crypto.randomUUID(),
      feature: "contacts",
      name: "",
      filters: { query: "x".repeat(201) },
    }).success,
    false,
  );
  assert.equal(
    savedViewInputSchema.safeParse({
      organizationId: crypto.randomUUID(),
      feature: "tasks",
      name: "Invalid cross-feature filter",
      filters: {
        query: "",
        status: "open",
        assigneeId: "all",
      },
    }).success,
    false,
  );
});

test("contact imports reject repeated normalized email identities", () => {
  const result = contactImportSchema.safeParse({
    organizationId,
    rows: [
      {
        firstName: "Rayees",
        lastName: null,
        email: "RAYEES@STATEAI.IN",
        phone: null,
      },
      {
        firstName: "Rayees 2",
        lastName: null,
        email: "rayees@stateai.in",
        phone: null,
      },
    ],
  });
  assert.equal(result.success, false);
});

test("company identity is validated and normalized", () => {
  const result = companyInputSchema.parse({
    organizationId,
    name: " State AI Travel ",
    website: "https://stateai.in",
    email: "TRAVEL@STATEAI.IN",
  });

  assert.equal(result.name, "State AI Travel");
  assert.equal(result.email, "travel@stateai.in");
});

test("workspace invitations normalize email and restrict roles to the role catalog", () => {
  const invitation = organizationInvitationInputSchema.parse({
    organizationId,
    email: "  TEAM@STATEAI.IN ",
    role: "operations",
  });
  assert.equal(invitation.email, "team@stateai.in");

  const invalidRole = organizationInvitationInputSchema.safeParse({
    organizationId,
    email: "team@stateai.in",
    role: "super_admin",
  });
  assert.equal(invalidRole.success, false);
});

test("invitation revocation requires tenant-scoped identifiers", () => {
  const result = organizationInvitationRevokeSchema.safeParse({
    organizationId,
    invitationId: "not-an-invitation-id",
  });
  assert.equal(result.success, false);
});

test("invitation acceptance requires a full base64url token", () => {
  assert.equal(
    organizationInvitationAcceptSchema.safeParse({
      token: "a".repeat(43),
    }).success,
    true,
  );
  assert.equal(
    organizationInvitationAcceptSchema.safeParse({
      token: "not-a-complete-token",
    }).success,
    false,
  );
});

test("membership role updates use only the workspace role catalog", () => {
  assert.equal(
    organizationMembershipRoleUpdateSchema.safeParse({
      organizationId,
      membershipId: "22222222-2222-4222-8222-222222222222",
      role: "finance",
    }).success,
    true,
  );
  assert.equal(
    organizationMembershipRoleUpdateSchema.safeParse({
      organizationId,
      membershipId: "22222222-2222-4222-8222-222222222222",
      role: "super_admin",
    }).success,
    false,
  );
});

test("membership lifecycle excludes the legacy invited state", () => {
  const membershipId = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    organizationMembershipStatusUpdateSchema.safeParse({
      organizationId,
      membershipId,
      status: "suspended",
    }).success,
    true,
  );
  assert.equal(
    organizationMembershipStatusUpdateSchema.safeParse({
      organizationId,
      membershipId,
      status: "invited",
    }).success,
    false,
  );
});

test("internal conversation notes reject empty content", () => {
  const result = conversationNoteInputSchema.safeParse({
    organizationId,
    conversationId: "22222222-2222-4222-8222-222222222222",
    body: "   ",
  });

  assert.equal(result.success, false);
});

test("new conversations require valid linked record identifiers", () => {
  const result = conversationInputSchema.safeParse({
    organizationId,
    contactId: null,
    dealId: "not-a-deal-id",
    subject: "Traveller wants to compare two itinerary ideas",
  });
  assert.equal(result.success, false);
});

test("conversation workflow rejects unknown statuses", () => {
  const result = conversationStatusUpdateSchema.safeParse({
    organizationId,
    conversationId: "22222222-2222-4222-8222-222222222222",
    status: "sent",
  });
  assert.equal(result.success, false);
});

test("conversation assignment requires a valid workspace member identifier", () => {
  const result = conversationAssigneeUpdateSchema.safeParse({
    organizationId,
    conversationId: "22222222-2222-4222-8222-222222222222",
    assigneeId: "not-a-member-id",
  });
  assert.equal(result.success, false);
});

test("conversation SLA controls require a known priority and ISO deadline", () => {
  assert.equal(
    conversationSlaUpdateSchema.safeParse({
      organizationId,
      conversationId: crypto.randomUUID(),
      priority: "urgent",
      responseDueAt: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(
    conversationSlaUpdateSchema.safeParse({
      organizationId,
      conversationId: crypto.randomUUID(),
      priority: "whenever",
      responseDueAt: "tomorrow",
    }).success,
    false,
  );
});

test("message templates and drafts remain bounded internal records", () => {
  assert.equal(
    messageTemplateInputSchema.safeParse({
      organizationId,
      name: "Visa reminder",
      kind: "reply",
      channel: "email",
      subject: "A reminder for your trip",
      body: "Please review the outstanding visa information.",
    }).success,
    true,
  );
  assert.equal(
    messageTemplateInputSchema.safeParse({
      organizationId,
      name: "Rayees signature",
      kind: "signature",
      channel: "email",
      subject: null,
      body: "Regards,\nRayees Amin",
    }).success,
    true,
  );
  assert.equal(
    messageDraftInputSchema.safeParse({
      organizationId,
      conversationId: crypto.randomUUID(),
      templateId: null,
      channel: "email",
      recipient: "traveller@example.com",
      subject: "Draft only",
      body: "This remains inside AIOS.",
      status: "ready_for_review",
      scheduledFor: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(
    messageTemplateStatusUpdateSchema.safeParse({
      organizationId,
      templateId: crypto.randomUUID(),
      isActive: false,
    }).success,
    true,
  );
  assert.equal(
    messageDraftUpdateSchema.safeParse({
      organizationId,
      draftId: crypto.randomUUID(),
      templateId: null,
      channel: "whatsapp",
      recipient: "+919876543210",
      subject: null,
      body: "Revised internal copy.",
      status: "draft",
      scheduledFor: null,
    }).success,
    true,
  );
  assert.equal(
    messageDraftInputSchema.safeParse({
      organizationId,
      conversationId: crypto.randomUUID(),
      templateId: null,
      channel: "sms",
      recipient: null,
      subject: null,
      body: "",
      status: "sent",
      scheduledFor: "tomorrow",
    }).success,
    false,
  );
});

test("task updates only accept a known workflow status", () => {
  const result = taskStatusUpdateSchema.safeParse({
    organizationId,
    taskId: "22222222-2222-4222-8222-222222222222",
    status: "sent",
  });
  assert.equal(result.success, false);
});

test("task assignment requires valid workspace and member identifiers", () => {
  const result = taskAssigneeUpdateSchema.safeParse({
    organizationId,
    taskId: "22222222-2222-4222-8222-222222222222",
    assigneeId: "not-a-member-id",
  });
  assert.equal(result.success, false);
});

test("deal assignment rejects an invalid owner identifier", () => {
  const result = dealOwnerUpdateSchema.safeParse({
    organizationId,
    dealId: "22222222-2222-4222-8222-222222222222",
    ownerId: "not-a-member-id",
  });
  assert.equal(result.success, false);
});

test("lost opportunities require a useful loss reason", () => {
  const result = dealStageUpdateSchema.safeParse({
    organizationId,
    dealId: "22222222-2222-4222-8222-222222222222",
    stage: "lost",
    lostReason: null,
  });
  assert.equal(result.success, false);
});

test("commercial plans only accept a real calendar close date", () => {
  const result = dealCommercialPlanUpdateSchema.safeParse({
    organizationId,
    dealId: "22222222-2222-4222-8222-222222222222",
    probability: 65,
    nextStep: "Present the revised family itinerary",
    expectedCloseAt: "2026-02-30",
  });
  assert.equal(result.success, false);
});

test("new opportunities retain a valid expected close date", () => {
  const result = dealInputSchema.parse({
    organizationId,
    title: "Honeymoon to Japan",
    expectedCloseAt: "2026-08-14",
  });
  assert.equal(result.expectedCloseAt, "2026-08-14");
});

test("follow-up deadlines require an ISO timestamp", () => {
  const result = taskInputSchema.safeParse({
    organizationId,
    title: "Confirm hotel room configuration",
    dueAt: "next Thursday",
  });
  assert.equal(result.success, false);
});

test("quote drafts require a real opportunity, currency, and non-negative total", () => {
  const invalid = quoteDraftInputSchema.safeParse({
    organizationId,
    dealId: "not-a-deal-id",
    title: "Japan family itinerary",
    currency: "inr",
    totalAmount: -1,
  });
  assert.equal(invalid.success, false);

  const valid = quoteDraftInputSchema.parse({
    organizationId,
    dealId: "22222222-2222-4222-8222-222222222222",
    title: "Japan family itinerary",
    currency: "INR",
    validUntil: "2026-08-14",
    totalAmount: 450000,
  });
  assert.equal(valid.totalAmount, 450000);
});

test("quote revisions require a real quote and a non-negative replacement total", () => {
  const result = quoteRevisionInputSchema.safeParse({
    organizationId,
    quoteId: "not-a-quote-id",
    totalAmount: -200,
    estimatedCostAmount: -100,
  });
  assert.equal(result.success, false);

  const valid = quoteRevisionInputSchema.parse({
    organizationId,
    quoteId: "22222222-2222-4222-8222-222222222222",
    totalAmount: 450000,
    estimatedCostAmount: 315000,
  });
  assert.equal(valid.estimatedCostAmount, 315000);
});

test("quote sharing review requires a tenant-scoped quote identifier", () => {
  const result = quoteShareApprovalInputSchema.safeParse({
    organizationId,
    quoteId: "not-a-quote-id",
  });
  assert.equal(result.success, false);
});

test("trip drafts reject an inverted travel date range", () => {
  const result = tripDraftInputSchema.safeParse({
    organizationId,
    name: "Japan family journey",
    startDate: "2026-10-14",
    endDate: "2026-10-12",
  });
  assert.equal(result.success, false);
});

test("itinerary items require a valid internal planning shape", () => {
  const result = itineraryItemInputSchema.safeParse({
    organizationId,
    tripId: "22222222-2222-4222-8222-222222222222",
    dayNumber: 2,
    itemType: "activity",
    title: "Old Kyoto walk",
  });
  assert.equal(result.success, true);
});

test("itinerary templates require a named source trip", () => {
  const result = itineraryTemplateFromTripInputSchema.safeParse({
    organizationId,
    sourceTripId: "22222222-2222-4222-8222-222222222222",
    name: "   ",
  });
  assert.equal(result.success, false);
});

test("applying a template requires tenant-scoped template and trip ids", () => {
  const result = itineraryTemplateApplyInputSchema.safeParse({
    organizationId,
    templateId: "not-a-template-id",
    targetTripId: "not-a-trip-id",
  });
  assert.equal(result.success, false);
});

test("internal itinerary comments require useful team context", () => {
  const result = itineraryCommentInputSchema.safeParse({
    organizationId,
    tripId: "22222222-2222-4222-8222-222222222222",
    body: "   ",
  });
  assert.equal(result.success, false);
});
