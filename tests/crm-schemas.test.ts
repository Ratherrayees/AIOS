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
  quoteApprovalPolicyInputSchema,
  quoteCatalogProductInputSchema,
  quoteCatalogProductStatusInputSchema,
  quoteCatalogRateInputSchema,
  quoteProposalContentInputSchema,
  quoteRevisionInputSchema,
  structuredQuoteRevisionInputSchema,
  quoteShareApprovalInputSchema,
  quoteSharePublishSchema,
  quoteShareRevokeSchema,
  operationalExceptionStatusSchema,
  operationsRadarRefreshSchema,
  approvedInvoiceIssuanceInputSchema,
  invoiceDocumentDownloadInputSchema,
  invoiceDocumentRenderInputSchema,
  invoiceDraftPreparationInputSchema,
  invoiceIssuanceApprovalInputSchema,
  invoiceIssuerProfileInputSchema,
  invoiceNumberPolicyInputSchema,
  paymentAllocationInputSchema,
  paymentLinkApprovalInputSchema,
  paymentLinkDraftPreparationInputSchema,
  paymentObligationInputSchema,
  paymentVoidInputSchema,
  supplierContactInputSchema,
  supplierContractInputSchema,
  supplierProfileInputSchema,
  tripBookingInputSchema,
  tripDocumentDownloadSchema,
  tripDocumentUploadSchema,
  travelerPortalApprovalSchema,
  travelerPortalPublishSchema,
  travelerPortalRevokeSchema,
  tripDraftInputSchema,
  tripOperationsUpdateSchema,
  tripStatusUpdateSchema,
  tripTravelerInputSchema,
  travelerEntryCheckInputSchema,
  wonDealConversionSchema,
  itineraryItemInputSchema,
  itineraryCommentInputSchema,
  itineraryTemplateApplyInputSchema,
  itineraryTemplateFromTripInputSchema,
  leadCaptureFormInputSchema,
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
  followUpSequenceInputSchema,
  qualificationChecklistTemplateInputSchema,
  travelDocumentUploadSchema,
} from "../lib/crm/schemas";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("structured quote revisions require reconcilable bounded lines", () => {
  const base = {
    organizationId,
    quoteId: "22222222-2222-4222-8222-222222222222",
    items: [
      {
        category: "accommodation" as const,
        description: "Two rooms",
        quantity: 2,
        unitPriceAmount: 200_000,
        unitCostAmount: 150_000,
        discountAmount: 20_000,
        taxPercent: 5,
      },
    ],
  };

  assert.equal(structuredQuoteRevisionInputSchema.safeParse(base).success, true);
  assert.equal(
    structuredQuoteRevisionInputSchema.safeParse({
      ...base,
      items: [{ ...base.items[0], discountAmount: 500_000 }],
    }).success,
    false,
  );
  assert.equal(
    structuredQuoteRevisionInputSchema.safeParse({ ...base, items: [] }).success,
    false,
  );
  assert.equal(
    structuredQuoteRevisionInputSchema.safeParse({
      ...base,
      items: [
        {
          ...base.items[0],
          quantity: 100_000,
          unitPriceAmount: 999_999_999_999.99,
        },
      ],
    }).success,
    false,
  );
});

test("quote catalog products require bounded effective-dated pricing", () => {
  const product = {
    organizationId,
    supplierId: null,
    category: "accommodation" as const,
    name: "Heritage room",
    description: "Room and breakfast",
    unitLabel: "room night",
    currency: "INR",
    unitSellAmount: 20_000,
    unitCostAmount: 15_000,
    taxPercent: 5,
    validFrom: "2026-08-01",
    validUntil: "2026-12-31",
  };

  assert.equal(quoteCatalogProductInputSchema.safeParse(product).success, true);
  assert.equal(
    quoteCatalogProductInputSchema.safeParse({
      ...product,
      validUntil: "2026-07-31",
    }).success,
    false,
  );
  assert.equal(
    quoteCatalogProductInputSchema.safeParse({
      ...product,
      taxPercent: 101,
    }).success,
    false,
  );
});

test("quote catalog rate and lifecycle inputs retain human evidence", () => {
  assert.equal(
    quoteCatalogRateInputSchema.safeParse({
      organizationId,
      productId: "22222222-2222-4222-8222-222222222222",
      unitSellAmount: 22_000,
      unitCostAmount: 16_000,
      taxPercent: 5,
      validFrom: "2026-09-01",
      validUntil: null,
    }).success,
    true,
  );
  assert.equal(
    quoteCatalogProductStatusInputSchema.safeParse({
      organizationId,
      productId: "22222222-2222-4222-8222-222222222222",
      status: "archived",
      reason: "short",
    }).success,
    false,
  );
});

test("quote proposal content requires unique bounded customer evidence", () => {
  const proposal = {
    organizationId,
    quoteId: "22222222-2222-4222-8222-222222222222",
    inclusions: ["Airport transfers", "Daily breakfast"],
    exclusions: ["International flights"],
    terms: ["Subject to availability"],
  };
  assert.equal(
    quoteProposalContentInputSchema.safeParse(proposal).success,
    true,
  );
  assert.equal(
    quoteProposalContentInputSchema.safeParse({
      ...proposal,
      inclusions: ["Daily breakfast", "daily breakfast"],
    }).success,
    false,
  );
  assert.equal(
    quoteProposalContentInputSchema.safeParse({
      ...proposal,
      terms: [],
    }).success,
    false,
  );
});

test("contact email identity is trimmed and normalized", () => {
  const result = contactInputSchema.parse({
    organizationId,
    firstName: "Rayees",
    email: "  RAYEES@STATEAI.IN ",
  });

  assert.equal(result.email, "rayees@stateai.in");
});

test("traveler entry checks normalize minimal country-code evidence", () => {
  const result = travelerEntryCheckInputSchema.parse({
    organizationId,
    tripId: crypto.randomUUID(),
    travelerId: crypto.randomUUID(),
    destinationCountryCode: "jp",
    citizenshipCountryCode: "in",
    passportIssuingCountryCode: "in",
    passportExpiresOn: "2028-12-31",
    passportValidityMonthsRequired: 6,
    visaRequirement: "required",
    visaStatus: "application_pending",
    visaValidUntil: null,
    actionDueOn: "2026-09-01",
    evidenceSourceLabel: "Embassy advisory reviewed by operations",
    evidenceSourceUrl: "https://official.example/entry",
  });

  assert.equal(result.destinationCountryCode, "JP");
  assert.equal(result.citizenshipCountryCode, "IN");
});

test("traveler entry checks require human evidence for visa conclusions", () => {
  assert.equal(
    travelerEntryCheckInputSchema.safeParse({
      organizationId,
      tripId: crypto.randomUUID(),
      travelerId: crypto.randomUUID(),
      destinationCountryCode: "JP",
      citizenshipCountryCode: "IN",
      passportValidityMonthsRequired: 6,
      visaRequirement: "required",
      visaStatus: "researching",
      evidenceSourceLabel: null,
    }).success,
    false,
  );
});

test("traveler entry checks reject inconsistent visa workflow states", () => {
  assert.equal(
    travelerEntryCheckInputSchema.safeParse({
      organizationId,
      tripId: crypto.randomUUID(),
      travelerId: crypto.randomUUID(),
      destinationCountryCode: "JP",
      citizenshipCountryCode: "IN",
      passportValidityMonthsRequired: 6,
      visaRequirement: "not_required",
      visaStatus: "granted",
      evidenceSourceLabel: "Official destination advisory",
    }).success,
    false,
  );
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
      feature: "analytics",
      name: "90-day website performance",
      filters: {
        range: "90d",
        source: "Website",
        ownerId: "all",
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
  assert.equal(
    savedViewInputSchema.safeParse({
      organizationId,
      name: "Quarterly management review",
      feature: "analytics",
      filters: {
        range: "90d",
        source: "all",
        ownerId: "all",
        managementPeriod: "custom",
        customPeriodStart: "2026-07-01",
        customPeriodEnd: "2026-09-30",
      },
    }).success,
    true,
  );
  assert.equal(
    savedViewInputSchema.safeParse({
      organizationId,
      name: "Invalid management period",
      feature: "analytics",
      filters: {
        range: "90d",
        source: "all",
        ownerId: "all",
        managementPeriod: "custom",
        customPeriodStart: "2026-09-30",
        customPeriodEnd: "2026-07-01",
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
    valueAmount: 450000,
    destination: "Kyoto",
    nextStep: "Present the revised family itinerary",
    expectedCloseAt: "2026-02-30",
    followUpDueAt: "2026-08-01T10:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("lead capture forms enforce bounded response targets", () => {
  assert.equal(
    leadCaptureFormInputSchema.safeParse({
      organizationId,
      name: "StateAI website",
      headline: "Plan an extraordinary journey",
      source: "Website",
      defaultOwnerId: null,
      firstResponseMinutes: 15,
    }).success,
    true,
  );
  assert.equal(
    leadCaptureFormInputSchema.safeParse({
      organizationId,
      name: "StateAI website",
      headline: "Plan an extraordinary journey",
      source: "Website",
      defaultOwnerId: null,
      firstResponseMinutes: 1,
    }).success,
    false,
  );
});

test("travel document metadata must stay linked to real tenant records", () => {
  assert.equal(
    travelDocumentUploadSchema.safeParse({
      organizationId,
      dealId: crypto.randomUUID(),
      contactId: crypto.randomUUID(),
    }).success,
    true,
  );
  assert.equal(
    travelDocumentUploadSchema.safeParse({
      organizationId,
      dealId: "another-tenant-deal",
      contactId: crypto.randomUUID(),
    }).success,
    false,
  );
});

test("qualification templates require bounded reusable evidence items", () => {
  const result = qualificationChecklistTemplateInputSchema.parse({
    organizationId,
    name: "Premium leisure qualification",
    description: "Evidence required before proposal",
    items: [
      {
        label: "Confirm travel dates",
        guidance: "Record date flexibility",
        required: true,
      },
      {
        label: "Record visa support preference",
        guidance: null,
        required: false,
      },
    ],
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].required, true);
});

test("follow-up sequence delays cannot move backwards", () => {
  assert.equal(
    followUpSequenceInputSchema.safeParse({
      organizationId,
      name: "Qualified lead momentum",
      description: null,
      steps: [
        { title: "Confirm the brief", delayDays: 3 },
        { title: "Review itinerary direction", delayDays: 1 },
      ],
    }).success,
    false,
  );
  assert.equal(
    followUpSequenceInputSchema.safeParse({
      organizationId,
      name: "Qualified lead momentum",
      description: null,
      steps: [
        { title: "Confirm the brief", delayDays: 0 },
        { title: "Review itinerary direction", delayDays: 2 },
      ],
    }).success,
    true,
  );
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

test("public proposal publication and revocation keep bounded human controls", () => {
  assert.equal(
    quoteSharePublishSchema.safeParse({
      organizationId,
      quoteId: "22222222-2222-4222-8222-222222222222",
      approvalId: "33333333-3333-4333-8333-333333333333",
      durationDays: 7,
    }).success,
    true,
  );
  assert.equal(
    quoteSharePublishSchema.safeParse({
      organizationId,
      quoteId: "22222222-2222-4222-8222-222222222222",
      approvalId: "33333333-3333-4333-8333-333333333333",
      durationDays: 31,
    }).success,
    false,
  );
  assert.equal(
    quoteShareRevokeSchema.safeParse({
      organizationId,
      shareLinkId: "44444444-4444-4444-8444-444444444444",
      note: "too short",
    }).success,
    false,
  );
});

test("quote approval policies enforce bounded commercial controls", () => {
  assert.equal(
    quoteApprovalPolicyInputSchema.safeParse({
      organizationId,
      minimumMarginPercent: 101,
      requireCostEstimate: true,
      requireValidUntil: true,
      maximumValidityDays: 0,
    }).success,
    false,
  );
  assert.equal(
    quoteApprovalPolicyInputSchema.safeParse({
      organizationId,
      minimumMarginPercent: 20,
      requireCostEstimate: true,
      requireValidUntil: true,
      maximumValidityDays: 60,
    }).success,
    true,
  );
  assert.equal(
    quoteApprovalPolicyInputSchema.safeParse({
      organizationId,
      minimumMarginPercent: 20,
      requireCostEstimate: true,
      requireValidUntil: true,
      maximumValidityDays: 60,
      maximumDiscountPercent: 3,
      enforceStandardTerms: true,
      standardTerms: [],
    }).success,
    false,
  );
  assert.equal(
    quoteApprovalPolicyInputSchema.safeParse({
      organizationId,
      minimumMarginPercent: 20,
      requireCostEstimate: true,
      requireValidUntil: true,
      maximumValidityDays: 60,
      maximumDiscountPercent: 3,
      enforceStandardTerms: true,
      standardTerms: ["Subject to availability", "subject to availability"],
    }).success,
    false,
  );
  assert.equal(
    quoteApprovalPolicyInputSchema.safeParse({
      organizationId,
      minimumMarginPercent: 20,
      minimumMarkupPercent: 25,
      requireCostEstimate: true,
      requireValidUntil: true,
      maximumValidityDays: 60,
      maximumDiscountPercent: 5,
      commissionBasis: "revenue_after_tax",
      commissionPercent: 110,
      minimumPostCommissionMarginPercent: 10,
    }).success,
    false,
  );
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

test("won-deal conversion requires tenant-scoped deal identity", () => {
  assert.equal(
    wonDealConversionSchema.safeParse({
      organizationId,
      dealId: crypto.randomUUID(),
    }).success,
    true,
  );
  assert.equal(
    wonDealConversionSchema.safeParse({
      organizationId,
      dealId: "not-a-deal",
    }).success,
    false,
  );
});

test("trip operations reject inverted dates and unbounded notes", () => {
  const base = {
    organizationId,
    tripId: crypto.randomUUID(),
    name: "Japan family journey",
    destination: "Kyoto",
    startDate: "2026-10-14",
    endDate: "2026-10-12",
    currency: "INR",
    ownerId: null,
    operationsNotes: null,
  };
  assert.equal(tripOperationsUpdateSchema.safeParse(base).success, false);
  assert.equal(
    tripOperationsUpdateSchema.safeParse({
      ...base,
      endDate: "2026-10-18",
      operationsNotes: "x".repeat(5_001),
    }).success,
    false,
  );
});

test("trip lifecycle accepts only known statuses and bounded notes", () => {
  assert.equal(
    tripStatusUpdateSchema.safeParse({
      organizationId,
      tripId: crypto.randomUUID(),
      status: "in_travel",
      note: "Lead traveller checked in",
    }).success,
    true,
  );
  assert.equal(
    tripStatusUpdateSchema.safeParse({
      organizationId,
      tripId: crypto.randomUUID(),
      status: "boarding",
    }).success,
    false,
  );
});

test("traveller manifests validate identity and roster roles", () => {
  assert.equal(
    tripTravelerInputSchema.safeParse({
      organizationId,
      tripId: crypto.randomUUID(),
      firstName: "Aarav",
      email: "AARAV@EXAMPLE.COM",
      role: "traveler",
    }).success,
    true,
  );
  assert.equal(
    tripTravelerInputSchema.safeParse({
      organizationId,
      tripId: crypto.randomUUID(),
      firstName: "",
      role: "operator",
    }).success,
    false,
  );
});

test("booking records reject inverted service times and negative costs", () => {
  const result = tripBookingInputSchema.safeParse({
    organizationId,
    tripId: crypto.randomUUID(),
    title: "Kyoto hotel",
    bookingType: "hotel",
    serviceStartAt: "2026-10-14T12:00:00.000Z",
    serviceEndAt: "2026-10-12T12:00:00.000Z",
    costAmount: -1,
    currency: "INR",
  });
  assert.equal(result.success, false);
});

test("trip document metadata requires bounded tenant identities", () => {
  const tripId = crypto.randomUUID();
  assert.equal(
    tripDocumentUploadSchema.safeParse({
      organizationId,
      tripId,
      documentKind: "voucher",
      expiresAt: "2027-01-01",
    }).success,
    true,
  );
  assert.equal(
    tripDocumentDownloadSchema.safeParse({
      organizationId,
      tripId,
      documentId: "not-a-document",
    }).success,
    false,
  );
});

test("traveler portals require bounded, unique, human-reviewed scope", () => {
  const tripId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  assert.equal(
    travelerPortalApprovalSchema.safeParse({
      organizationId,
      tripId,
      documentIds: [documentId],
      includePaymentStatus: true,
      durationDays: 7,
    }).success,
    true,
  );
  assert.equal(
    travelerPortalApprovalSchema.safeParse({
      organizationId,
      tripId,
      documentIds: [documentId, documentId],
      includePaymentStatus: true,
      durationDays: 31,
    }).success,
    false,
  );
  assert.equal(
    travelerPortalPublishSchema.safeParse({
      organizationId,
      tripId,
      approvalId: crypto.randomUUID(),
    }).success,
    true,
  );
  assert.equal(
    travelerPortalRevokeSchema.safeParse({
      organizationId,
      portalLinkId: crypto.randomUUID(),
      note: " ",
    }).success,
    false,
  );
});

test("operations radar refresh and exception resolution stay tenant scoped", () => {
  assert.equal(
    operationsRadarRefreshSchema.safeParse({ organizationId }).success,
    true,
  );
  assert.equal(
    operationalExceptionStatusSchema.safeParse({
      organizationId,
      exceptionId: crypto.randomUUID(),
      status: "acknowledged",
    }).success,
    true,
  );
  assert.equal(
    operationalExceptionStatusSchema.safeParse({
      organizationId,
      exceptionId: crypto.randomUUID(),
      status: "resolved",
      note: " ",
    }).success,
    false,
  );
});

test("supplier profiles validate commercial terms without requiring PII", () => {
  assert.equal(
    supplierProfileInputSchema.safeParse({
      organizationId,
      name: "Kyoto Ground Partners",
      category: "DMC",
      preferredCurrency: "JPY",
      paymentTermsDays: 30,
      qualityRating: 4.5,
    }).success,
    true,
  );
  assert.equal(
    supplierProfileInputSchema.safeParse({
      organizationId,
      name: "K",
      preferredCurrency: "yen",
      paymentTermsDays: 500,
    }).success,
    false,
  );
});

test("supplier contacts require a reachable contact method", () => {
  assert.equal(
    supplierContactInputSchema.safeParse({
      organizationId,
      supplierId: crypto.randomUUID(),
      name: "Mika Tanaka",
      email: "mika@example.invalid",
      isPrimary: true,
    }).success,
    true,
  );
  assert.equal(
    supplierContactInputSchema.safeParse({
      organizationId,
      supplierId: crypto.randomUUID(),
      name: "Mika Tanaka",
    }).success,
    false,
  );
});

test("supplier contract periods cannot end before they start", () => {
  assert.equal(
    supplierContractInputSchema.safeParse({
      organizationId,
      supplierId: crypto.randomUUID(),
      title: "2027 ground services",
      status: "active",
      startsOn: "2027-04-01",
      endsOn: "2027-03-31",
      currency: "JPY",
    }).success,
    false,
  );
});

test("payment obligations require positive currency-safe amounts", () => {
  assert.equal(
    paymentObligationInputSchema.safeParse({
      organizationId,
      direction: "payable",
      title: "Kyoto hotel deposit",
      amount: 125000,
      currency: "JPY",
      supplierId: crypto.randomUUID(),
    }).success,
    true,
  );
  assert.equal(
    paymentObligationInputSchema.safeParse({
      organizationId,
      direction: "payable",
      title: "Invalid deposit",
      amount: -1,
      currency: "YEN",
    }).success,
    false,
  );
});

test("invoice draft readiness accepts only bounded numbering controls", () => {
  assert.equal(
    invoiceNumberPolicyInputSchema.safeParse({
      organizationId,
      numberPrefix: "inv/2027-",
      nextNumber: 42,
      numberPadding: 5,
    }).success,
    true,
  );
  assert.equal(
    invoiceNumberPolicyInputSchema.safeParse({
      organizationId,
      numberPrefix: "Invoice # ",
      nextNumber: 0,
      numberPadding: 2,
    }).success,
    false,
  );
  assert.equal(
    invoiceDraftPreparationInputSchema.safeParse({
      organizationId,
      quoteId: crypto.randomUUID(),
    }).success,
    true,
  );
});

test("invoice issuance requires bounded issuer identity and exact human evidence", () => {
  const invoiceDraftId = crypto.randomUUID();
  assert.equal(
    invoiceIssuerProfileInputSchema.safeParse({
      organizationId,
      legalName: "StateAI Travel Private Limited",
      registeredAddress: "12 Fictional Market Road, Bengaluru 560001",
      jurisdictionCountryCode: "in",
      taxRegistrationId: "29abcde1234f1z5",
    }).success,
    true,
  );
  assert.equal(
    invoiceIssuerProfileInputSchema.safeParse({
      organizationId,
      legalName: "A",
      registeredAddress: "short",
      jurisdictionCountryCode: "IND",
    }).success,
    false,
  );
  assert.equal(
    invoiceIssuanceApprovalInputSchema.safeParse({
      organizationId,
      invoiceDraftId,
      rationale: "Finance checked the exact immutable invoice evidence.",
    }).success,
    true,
  );
  assert.equal(
    invoiceIssuanceApprovalInputSchema.safeParse({
      organizationId,
      invoiceDraftId,
      rationale: "short",
    }).success,
    false,
  );
  assert.equal(
    approvedInvoiceIssuanceInputSchema.safeParse({
      organizationId,
      invoiceDraftId,
      approvalRequestId: crypto.randomUUID(),
    }).success,
    true,
  );
});

test("private invoice rendering accepts only exact document identifiers", () => {
  const invoiceIssuanceId = crypto.randomUUID();
  assert.equal(
    invoiceDocumentRenderInputSchema.safeParse({
      organizationId,
      invoiceIssuanceId,
    }).success,
    true,
  );
  assert.equal(
    invoiceDocumentDownloadInputSchema.safeParse({
      organizationId,
      invoiceDocumentId: crypto.randomUUID(),
    }).success,
    true,
  );
  assert.equal(
    invoiceDocumentRenderInputSchema.safeParse({
      organizationId,
      invoiceIssuanceId: "foreign-invoice",
    }).success,
    false,
  );
});

test("payment-link readiness binds exact receivable evidence to human review", () => {
  const paymentId = crypto.randomUUID();
  const paymentLinkDraftId = crypto.randomUUID();
  assert.equal(
    paymentLinkDraftPreparationInputSchema.safeParse({
      organizationId,
      paymentId,
    }).success,
    true,
  );
  assert.equal(
    paymentLinkApprovalInputSchema.safeParse({
      organizationId,
      paymentLinkDraftId,
      rationale:
        "Finance verified the invoice and exact current outstanding balance.",
    }).success,
    true,
  );
  assert.equal(
    paymentLinkApprovalInputSchema.safeParse({
      organizationId,
      paymentLinkDraftId,
      rationale: "too short",
    }).success,
    false,
  );
});

test("settlements and voids require explicit human evidence", () => {
  assert.equal(
    paymentAllocationInputSchema.safeParse({
      organizationId,
      paymentId: crypto.randomUUID(),
      amount: 5000,
      occurredAt: new Date().toISOString(),
      reference: "BANK-2026-001",
    }).success,
    true,
  );
  assert.equal(
    paymentAllocationInputSchema.safeParse({
      organizationId,
      paymentId: crypto.randomUUID(),
      amount: 5000,
      occurredAt: new Date().toISOString(),
    }).success,
    false,
  );
  assert.equal(
    paymentVoidInputSchema.safeParse({
      organizationId,
      paymentId: crypto.randomUUID(),
      reason: " ",
    }).success,
    false,
  );
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
