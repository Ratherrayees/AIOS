import { z } from "zod";

export const contactInputSchema = z.object({
  organizationId: z.uuid(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
});

const optionalTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA time zone.")
  .nullable()
  .optional();

export const contactPreferencesInputSchema = z
  .object({
    organizationId: z.uuid(),
    contactId: z.uuid(),
    consentStatus: z.enum(["unknown", "granted", "withdrawn"]),
    consentSource: z.string().trim().min(2).max(120).nullable().optional(),
    preferredChannel: z.enum(["email", "phone", "whatsapp", "none"]),
    preferredLocale: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .nullable()
      .optional(),
    timeZone: optionalTimeZoneSchema,
  })
  .superRefine((value, context) => {
    if (value.consentStatus !== "unknown" && !value.consentSource)
      context.addIssue({
        code: "custom",
        path: ["consentSource"],
        message:
          "Record where the granted or withdrawn consent was captured.",
      });
    if (value.consentStatus === "unknown" && value.consentSource)
      context.addIssue({
        code: "custom",
        path: ["consentSource"],
        message: "Unknown consent cannot include a consent source.",
      });
  });

export const contactOwnerUpdateSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid(),
  ownerId: z.uuid().nullable(),
});

export const contactMergeInputSchema = z
  .object({
    organizationId: z.uuid(),
    primaryContactId: z.uuid(),
    duplicateContactId: z.uuid(),
  })
  .refine(
    (value) => value.primaryContactId !== value.duplicateContactId,
    {
      path: ["duplicateContactId"],
      message: "Choose two different contacts.",
    },
  );

export const savedViewFeatureSchema = z.enum([
  "contacts",
  "tasks",
  "inbox",
  "leads",
  "analytics",
]);

const savedViewBaseSchema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(1).max(80),
});

export const savedViewInputSchema = z.discriminatedUnion("feature", [
  savedViewBaseSchema.extend({
    feature: z.literal("contacts"),
    filters: z.object({
      query: z.string().trim().max(200),
    }),
  }),
  savedViewBaseSchema.extend({
    feature: z.literal("tasks"),
    filters: z.object({
      query: z.string().trim().max(200),
      assigneeId: z.union([z.uuid(), z.enum(["all", "unassigned"])]),
      timing: z.enum(["all", "overdue", "due_soon", "no_due"]),
    }),
  }),
  savedViewBaseSchema.extend({
    feature: z.literal("inbox"),
    filters: z.object({
      query: z.string().trim().max(200),
      status: z.enum(["all", "inbox", "open", "pending", "closed"]),
      assigneeId: z.union([z.uuid(), z.enum(["all", "unassigned"])]),
      sla: z.enum(["all", "overdue", "due_soon", "no_deadline"]),
    }),
  }),
  savedViewBaseSchema.extend({
    feature: z.literal("leads"),
    filters: z.object({
      query: z.string().trim().max(200),
      stage: z.enum([
        "all",
        "new",
        "qualified",
        "proposal",
        "decision",
      ]),
      ownerId: z.union([z.uuid(), z.enum(["all", "unassigned"])]),
      attention: z.enum(["all", "attention", "healthy"]),
    }),
  }),
  savedViewBaseSchema.extend({
    feature: z.literal("analytics"),
    filters: z.object({
      range: z.enum(["30d", "90d", "365d", "all"]),
      source: z.string().trim().min(1).max(120),
      ownerId: z.union([z.uuid(), z.enum(["all", "unassigned"])]),
    }),
  }),
]);

export const savedViewDeleteSchema = z.object({
  organizationId: z.uuid(),
  savedViewId: z.uuid(),
  feature: savedViewFeatureSchema,
});

export const contactImportSchema = z
  .object({
    organizationId: z.uuid(),
    rows: z
      .array(
        z.object({
          firstName: z.string().trim().min(1).max(100),
          lastName: z.string().trim().max(100).nullable(),
          email: z.string().trim().toLowerCase().pipe(z.email()).nullable(),
          phone: z.string().trim().min(3).max(40).nullable(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.rows.forEach((row, index) => {
      if (!row.email) return;
      if (seen.has(row.email))
        context.addIssue({
          code: "custom",
          path: ["rows", index, "email"],
          message: "Duplicate email in import.",
        });
      seen.add(row.email);
    });
  });

export const companyInputSchema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(1).max(180),
  website: z.url().nullable().optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
});

export const activityNoteInputSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  body: z.string().trim().min(1).max(5_000),
});

export const organizationInvitationInputSchema = z.object({
  organizationId: z.uuid(),
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  role: z.enum([
    "owner",
    "admin",
    "sales",
    "trip_designer",
    "operations",
    "finance",
    "agent",
    "viewer",
  ]),
});

export const organizationInvitationRevokeSchema = z.object({
  organizationId: z.uuid(),
  invitationId: z.uuid(),
});

export const organizationInvitationAcceptSchema = z.object({
  token: z
    .string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]+$/, "Invitation token is invalid."),
});

export const organizationMembershipRoleUpdateSchema = z.object({
  organizationId: z.uuid(),
  membershipId: z.uuid(),
  role: z.enum([
    "owner",
    "admin",
    "sales",
    "trip_designer",
    "operations",
    "finance",
    "agent",
    "viewer",
  ]),
});

export const organizationMembershipStatusUpdateSchema = z.object({
  organizationId: z.uuid(),
  membershipId: z.uuid(),
  status: z.enum(["active", "suspended"]),
});

export const conversationInputSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  subject: z.string().trim().min(1).max(300),
});

export const conversationNoteInputSchema = z.object({
  organizationId: z.uuid(),
  conversationId: z.uuid(),
  body: z.string().trim().min(1).max(10_000),
});
export const conversationStatusUpdateSchema = z.object({
  organizationId: z.uuid(),
  conversationId: z.uuid(),
  status: z.enum(["inbox", "open", "pending", "closed"]),
});
export const conversationAssigneeUpdateSchema = z.object({
  organizationId: z.uuid(),
  conversationId: z.uuid(),
  assigneeId: z.uuid().nullable(),
});
export const conversationSlaUpdateSchema = z.object({
  organizationId: z.uuid(),
  conversationId: z.uuid(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  responseDueAt: z.iso.datetime().nullable(),
});
export const messageTemplateInputSchema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["reply", "signature"]).default("reply"),
  channel: z.enum(["email", "whatsapp"]),
  subject: z.string().trim().max(300).nullable(),
  body: z.string().trim().min(1).max(10_000),
});
export const messageTemplateStatusUpdateSchema = z.object({
  organizationId: z.uuid(),
  templateId: z.uuid(),
  isActive: z.boolean(),
});
export const messageDraftInputSchema = z.object({
  organizationId: z.uuid(),
  conversationId: z.uuid(),
  templateId: z.uuid().nullable(),
  channel: z.enum(["email", "whatsapp"]),
  recipient: z.string().trim().max(320).nullable(),
  subject: z.string().trim().max(300).nullable(),
  body: z.string().trim().min(1).max(10_000),
  status: z.enum(["draft", "ready_for_review"]),
  scheduledFor: z.iso.datetime().nullable(),
});
export const messageDraftUpdateSchema = messageDraftInputSchema
  .omit({ conversationId: true })
  .extend({ draftId: z.uuid() });

export const dealInputSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(180),
  stage: z
    .enum(["new", "qualified", "proposal", "decision", "won", "lost"])
    .default("new"),
  valueAmount: z.number().nonnegative().finite().nullable().optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .default("INR"),
  source: z.string().trim().min(1).max(120).nullable().optional(),
  sourceCampaign: z.string().trim().min(1).max(120).nullable().optional(),
  destination: z.string().trim().min(1).max(180).nullable().optional(),
  probability: z.number().int().min(0).max(100).default(10),
  nextStep: z.string().trim().min(1).max(500).nullable().optional(),
  expectedCloseAt: z.iso.date().nullable().optional(),
});

export const taskInputSchema = z.object({
  organizationId: z.uuid(),
  contactId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  tripId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(500),
  assigneeId: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
});

export const taskStatusUpdateSchema = z.object({
  organizationId: z.uuid(),
  taskId: z.uuid(),
  status: z.enum(["open", "in_progress", "completed", "cancelled"]),
});

export const taskAssigneeUpdateSchema = z.object({
  organizationId: z.uuid(),
  taskId: z.uuid(),
  assigneeId: z.uuid().nullable(),
});

export const dealStageUpdateSchema = z
  .object({
    organizationId: z.uuid(),
    dealId: z.uuid(),
    stage: z.enum(["new", "qualified", "proposal", "decision", "won", "lost"]),
    lostReason: z.string().trim().min(3).max(500).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.stage === "lost" && !value.lostReason)
      context.addIssue({
        code: "custom",
        path: ["lostReason"],
        message:
          "A loss reason is required when closing an opportunity as lost.",
      });
  });

export const dealOwnerUpdateSchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
  ownerId: z.uuid().nullable(),
});

export const dealCommercialPlanUpdateSchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
  probability: z.number().int().min(0).max(100),
  valueAmount: z.number().nonnegative().finite().nullable(),
  destination: z.string().trim().min(1).max(180).nullable(),
  nextStep: z.string().trim().min(1).max(500).nullable(),
  expectedCloseAt: z.iso.date().nullable(),
  followUpDueAt: z.iso.datetime().nullable(),
});

export const dealResponseInputSchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
});

export const travelDocumentUploadSchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
  contactId: z.uuid(),
});

const qualificationChecklistItemSchema = z.object({
  label: z.string().trim().min(2).max(180),
  guidance: z.string().trim().min(2).max(500).nullable(),
  required: z.boolean(),
});

export const qualificationChecklistTemplateInputSchema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(2).max(500).nullable(),
  items: z.array(qualificationChecklistItemSchema).min(1).max(20),
});

const followUpSequenceStepSchema = z.object({
  title: z.string().trim().min(2).max(500),
  delayDays: z.number().int().min(0).max(365),
});

export const followUpSequenceInputSchema = z
  .object({
    organizationId: z.uuid(),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().min(2).max(500).nullable(),
    steps: z.array(followUpSequenceStepSchema).min(1).max(20),
  })
  .superRefine((value, context) => {
    value.steps.forEach((step, index) => {
      if (index > 0 && step.delayDays < value.steps[index - 1].delayDays)
        context.addIssue({
          code: "custom",
          path: ["steps", index, "delayDays"],
          message: "Sequence delays must not move backwards.",
        });
    });
  });

export const qualificationChecklistApplySchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
  templateId: z.uuid(),
});

export const qualificationCheckUpdateSchema = z.object({
  organizationId: z.uuid(),
  checkId: z.uuid(),
  isComplete: z.boolean(),
});

export const followUpSequenceApplySchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
  sequenceId: z.uuid(),
});

export const leadCaptureFormInputSchema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  headline: z.string().trim().min(3).max(140),
  source: z.string().trim().min(1).max(120),
  defaultOwnerId: z.uuid().nullable(),
  firstResponseMinutes: z.number().int().min(5).max(1440),
});

export const leadCaptureFormStatusUpdateSchema = z.object({
  organizationId: z.uuid(),
  formId: z.uuid(),
  isActive: z.boolean(),
});

export const quoteDraftInputSchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
  title: z.string().trim().min(1).max(180),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .default("INR"),
  validUntil: z.iso.date().nullable().optional(),
  totalAmount: z.number().nonnegative().finite().default(0),
});

export const quoteRevisionInputSchema = z.object({
  organizationId: z.uuid(),
  quoteId: z.uuid(),
  totalAmount: z.number().nonnegative().finite(),
  estimatedCostAmount: z.number().nonnegative().finite(),
});

/** A request to review external delivery; this is never permission to send. */
export const quoteShareApprovalInputSchema = z.object({
  organizationId: z.uuid(),
  quoteId: z.uuid(),
});

export const tripDraftInputSchema = z
  .object({
    organizationId: z.uuid(),
    name: z.string().trim().min(1).max(180),
    dealId: z.uuid().nullable().optional(),
    startDate: z.iso.date().nullable().optional(),
    endDate: z.iso.date().nullable().optional(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).default("INR"),
  })
  .refine(
    (value) => !value.startDate || !value.endDate || value.endDate >= value.startDate,
    { message: "The trip end date cannot be before its start date.", path: ["endDate"] },
  );

export const wonDealConversionSchema = z.object({
  organizationId: z.uuid(),
  dealId: z.uuid(),
});

export const tripOperationsUpdateSchema = z
  .object({
    organizationId: z.uuid(),
    tripId: z.uuid(),
    name: z.string().trim().min(1).max(180),
    destination: z.string().trim().min(1).max(180).nullable(),
    startDate: z.iso.date().nullable(),
    endDate: z.iso.date().nullable(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    ownerId: z.uuid().nullable(),
    operationsNotes: z.string().trim().max(5_000).nullable(),
  })
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.endDate >= value.startDate,
    {
      message: "The trip end date cannot be before its start date.",
      path: ["endDate"],
    },
  );

export const tripStatusUpdateSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  status: z.enum([
    "draft",
    "confirmed",
    "in_travel",
    "completed",
    "cancelled",
  ]),
  note: z.string().trim().max(500).nullable().optional(),
});

export const tripTravelerInputSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  contactId: z.uuid().nullable().optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  dateOfBirth: z.iso.date().nullable().optional(),
  role: z.enum(["lead_traveler", "traveler", "child"]).default("traveler"),
  preferences: z.string().trim().max(2_000).nullable().optional(),
});

export const tripBookingInputSchema = z
  .object({
    organizationId: z.uuid(),
    tripId: z.uuid(),
    supplierId: z.uuid().nullable().optional(),
    title: z.string().trim().min(1).max(180),
    bookingType: z.enum([
      "flight",
      "hotel",
      "transfer",
      "activity",
      "insurance",
      "other",
    ]),
    serviceStartAt: z.iso.datetime().nullable().optional(),
    serviceEndAt: z.iso.datetime().nullable().optional(),
    costAmount: z.number().nonnegative().finite().nullable().optional(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    confirmationReference: z
      .string()
      .trim()
      .max(180)
      .nullable()
      .optional(),
    notes: z.string().trim().max(4_000).nullable().optional(),
  })
  .refine(
    (value) =>
      !value.serviceStartAt ||
      !value.serviceEndAt ||
      value.serviceEndAt >= value.serviceStartAt,
    {
      message: "The service end cannot be before its start.",
      path: ["serviceEndAt"],
    },
  );

export const tripBookingStatusUpdateSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  bookingId: z.uuid(),
  status: z.enum(["draft", "requested", "confirmed", "cancelled", "failed"]),
  confirmationReference: z.string().trim().max(180).nullable().optional(),
});

export const tripDocumentUploadSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  expiresAt: z.iso.date().nullable().optional(),
});

export const tripDocumentDownloadSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  documentId: z.uuid(),
});

export const operationsRadarRefreshSchema = z.object({
  organizationId: z.uuid(),
});

export const operationalExceptionStatusSchema = z
  .object({
    organizationId: z.uuid(),
    exceptionId: z.uuid(),
    status: z.enum(["open", "acknowledged", "resolved"]),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (value) => value.status !== "resolved" || Boolean(value.note?.trim()),
    {
      message: "Add a short resolution note before resolving this exception.",
      path: ["note"],
    },
  );

export const itineraryItemInputSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  dayNumber: z.number().int().min(1).max(365),
  itemType: z.enum(["flight", "stay", "transfer", "activity", "meal", "free_time", "note"]),
  title: z.string().trim().min(1).max(300),
  locationName: z.string().trim().min(1).max(180).nullable().optional(),
  notes: z.string().trim().max(4_000).nullable().optional(),
});

export const itineraryTemplateFromTripInputSchema = z.object({
  organizationId: z.uuid(),
  sourceTripId: z.uuid(),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(1_200).default(""),
});

export const itineraryTemplateApplyInputSchema = z.object({
  organizationId: z.uuid(),
  templateId: z.uuid(),
  targetTripId: z.uuid(),
});

export const itineraryCommentInputSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  body: z.string().trim().min(1).max(4_000),
});

export type ContactInput = z.infer<typeof contactInputSchema>;
export type ContactPreferencesInput = z.infer<
  typeof contactPreferencesInputSchema
>;
export type ContactOwnerUpdateInput = z.infer<
  typeof contactOwnerUpdateSchema
>;
export type ContactMergeInput = z.infer<typeof contactMergeInputSchema>;
export type SavedViewInput = z.infer<typeof savedViewInputSchema>;
export type SavedViewDeleteInput = z.infer<typeof savedViewDeleteSchema>;
export type ContactImportInput = z.infer<typeof contactImportSchema>;
export type CompanyInput = z.infer<typeof companyInputSchema>;
export type ActivityNoteInput = z.infer<typeof activityNoteInputSchema>;
export type OrganizationInvitationInput = z.infer<
  typeof organizationInvitationInputSchema
>;
export type OrganizationInvitationRevokeInput = z.infer<
  typeof organizationInvitationRevokeSchema
>;
export type OrganizationInvitationAcceptInput = z.infer<
  typeof organizationInvitationAcceptSchema
>;
export type OrganizationMembershipRoleUpdateInput = z.infer<
  typeof organizationMembershipRoleUpdateSchema
>;
export type OrganizationMembershipStatusUpdateInput = z.infer<
  typeof organizationMembershipStatusUpdateSchema
>;
export type ConversationInput = z.infer<typeof conversationInputSchema>;
export type ConversationNoteInput = z.infer<typeof conversationNoteInputSchema>;
export type ConversationStatusUpdateInput = z.infer<
  typeof conversationStatusUpdateSchema
>;
export type ConversationAssigneeUpdateInput = z.infer<
  typeof conversationAssigneeUpdateSchema
>;
export type ConversationSlaUpdateInput = z.infer<
  typeof conversationSlaUpdateSchema
>;
export type MessageTemplateInput = z.infer<
  typeof messageTemplateInputSchema
>;
export type MessageTemplateStatusUpdateInput = z.infer<
  typeof messageTemplateStatusUpdateSchema
>;
export type MessageDraftInput = z.infer<typeof messageDraftInputSchema>;
export type MessageDraftUpdateInput = z.infer<
  typeof messageDraftUpdateSchema
>;
export type DealInput = z.infer<typeof dealInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskStatusUpdateInput = z.infer<typeof taskStatusUpdateSchema>;
export type TaskAssigneeUpdateInput = z.infer<typeof taskAssigneeUpdateSchema>;
export type DealStageUpdateInput = z.infer<typeof dealStageUpdateSchema>;
export type DealOwnerUpdateInput = z.infer<typeof dealOwnerUpdateSchema>;
export type DealCommercialPlanUpdateInput = z.infer<
  typeof dealCommercialPlanUpdateSchema
>;
export type DealResponseInput = z.infer<typeof dealResponseInputSchema>;
export type TravelDocumentUploadInput = z.infer<
  typeof travelDocumentUploadSchema
>;
export type QualificationChecklistTemplateInput = z.infer<
  typeof qualificationChecklistTemplateInputSchema
>;
export type FollowUpSequenceInput = z.infer<
  typeof followUpSequenceInputSchema
>;
export type QualificationChecklistApplyInput = z.infer<
  typeof qualificationChecklistApplySchema
>;
export type QualificationCheckUpdateInput = z.infer<
  typeof qualificationCheckUpdateSchema
>;
export type FollowUpSequenceApplyInput = z.infer<
  typeof followUpSequenceApplySchema
>;
export type LeadCaptureFormInput = z.infer<typeof leadCaptureFormInputSchema>;
export type LeadCaptureFormStatusUpdateInput = z.infer<
  typeof leadCaptureFormStatusUpdateSchema
>;
export type QuoteDraftInput = z.infer<typeof quoteDraftInputSchema>;
export type QuoteRevisionInput = z.infer<typeof quoteRevisionInputSchema>;
export type QuoteShareApprovalInput = z.infer<
  typeof quoteShareApprovalInputSchema
>;
export type TripDraftInput = z.infer<typeof tripDraftInputSchema>;
export type WonDealConversionInput = z.infer<typeof wonDealConversionSchema>;
export type TripOperationsUpdateInput = z.infer<
  typeof tripOperationsUpdateSchema
>;
export type TripStatusUpdateInput = z.infer<typeof tripStatusUpdateSchema>;
export type TripTravelerInput = z.infer<typeof tripTravelerInputSchema>;
export type TripBookingInput = z.infer<typeof tripBookingInputSchema>;
export type TripBookingStatusUpdateInput = z.infer<
  typeof tripBookingStatusUpdateSchema
>;
export type TripDocumentUploadInput = z.infer<
  typeof tripDocumentUploadSchema
>;
export type TripDocumentDownloadInput = z.infer<
  typeof tripDocumentDownloadSchema
>;
export type OperationsRadarRefreshInput = z.infer<
  typeof operationsRadarRefreshSchema
>;
export type OperationalExceptionStatusInput = z.infer<
  typeof operationalExceptionStatusSchema
>;
export type ItineraryItemInput = z.infer<typeof itineraryItemInputSchema>;
export type ItineraryTemplateFromTripInput = z.infer<
  typeof itineraryTemplateFromTripInputSchema
>;
export type ItineraryTemplateApplyInput = z.infer<
  typeof itineraryTemplateApplyInputSchema
>;
export type ItineraryCommentInput = z.infer<typeof itineraryCommentInputSchema>;
