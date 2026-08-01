import { z } from "zod";

import { MAX_QUOTE_AMOUNT, QUOTE_LINE_CATEGORIES } from "./quote-pricing";
import {
  MAX_QUOTE_PROPOSAL_ITEM_LENGTH,
  MAX_QUOTE_PROPOSAL_ITEMS,
} from "./quote-proposal";

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

const savedAnalyticsFiltersSchema = z
  .object({
    range: z.enum(["30d", "90d", "365d", "all"]),
    source: z.string().trim().min(1).max(120),
    ownerId: z.union([z.uuid(), z.enum(["all", "unassigned"])]),
    managementPeriod: z.union([
      z.literal(30),
      z.literal(90),
      z.literal(365),
      z.literal("custom"),
    ]).default(30),
    customPeriodStart: z.union([
      z.literal(""),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ]).default(""),
    customPeriodEnd: z.union([
      z.literal(""),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ]).default(""),
  })
  .superRefine((value, context) => {
    if (value.managementPeriod !== "custom") return;
    const start = new Date(`${value.customPeriodStart}T00:00:00.000Z`);
    const end = new Date(`${value.customPeriodEnd}T00:00:00.000Z`);
    const startIsValid =
      value.customPeriodStart !== "" &&
      !Number.isNaN(start.getTime()) &&
      start.toISOString().slice(0, 10) === value.customPeriodStart;
    const endIsValid =
      value.customPeriodEnd !== "" &&
      !Number.isNaN(end.getTime()) &&
      end.toISOString().slice(0, 10) === value.customPeriodEnd;
    if (!startIsValid || !endIsValid) {
      context.addIssue({
        code: "custom",
        path: ["customPeriodStart"],
        message: "A custom Analytics view needs real start and end dates.",
      });
      return;
    }
    const span = end.getTime() - start.getTime();
    if (span < 0 || span > 365 * 86_400_000) {
      context.addIssue({
        code: "custom",
        path: ["customPeriodEnd"],
        message: "A custom Analytics period must span 1 to 366 days.",
      });
    }
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
    filters: savedAnalyticsFiltersSchema,
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

export const quoteApprovalPolicyInputSchema = z.object({
  organizationId: z.uuid(),
  minimumMarginPercent: z.number().finite().min(0).max(100),
  requireCostEstimate: z.boolean(),
  requireValidUntil: z.boolean(),
  maximumValidityDays: z.number().int().min(1).max(365),
});

export const structuredQuoteLineInputSchema = z
  .object({
    catalogRateId: z.uuid().nullable().optional(),
    category: z.enum(QUOTE_LINE_CATEGORIES),
    description: z.string().trim().min(1).max(180),
    quantity: z.number().finite().positive().max(100000),
    unitPriceAmount: z.number().finite().nonnegative().max(MAX_QUOTE_AMOUNT),
    unitCostAmount: z.number().finite().nonnegative().max(MAX_QUOTE_AMOUNT),
    discountAmount: z.number().finite().nonnegative().default(0),
    taxPercent: z.number().finite().min(0).max(100).default(0),
  })
  .superRefine((line, context) => {
    const baseAmount = Math.round(line.quantity * line.unitPriceAmount * 100) / 100;
    if (line.discountAmount > baseAmount) {
      context.addIssue({
        code: "custom",
        path: ["discountAmount"],
        message: "A line discount cannot exceed its sell amount.",
      });
    }
    const costAmount = Math.round(line.quantity * line.unitCostAmount * 100) / 100;
    const netAmount = baseAmount - line.discountAmount;
    const totalAmount =
      netAmount + Math.round((netAmount * line.taxPercent) / 100 * 100) / 100;
    if (
      baseAmount > MAX_QUOTE_AMOUNT ||
      costAmount > MAX_QUOTE_AMOUNT ||
      totalAmount > MAX_QUOTE_AMOUNT
    ) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "The calculated line amount exceeds the supported limit.",
      });
    }
  });

const quoteCatalogRateFields = {
  unitSellAmount: z.number().finite().nonnegative().max(MAX_QUOTE_AMOUNT),
  unitCostAmount: z.number().finite().nonnegative().max(MAX_QUOTE_AMOUNT),
  taxPercent: z.number().finite().min(0).max(100),
  validFrom: z.iso.date(),
  validUntil: z.iso.date().nullable().optional(),
};

export const quoteCatalogProductInputSchema = z
  .object({
    organizationId: z.uuid(),
    supplierId: z.uuid().nullable().optional(),
    category: z.enum(QUOTE_LINE_CATEGORIES),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(180),
    unitLabel: z.string().trim().min(1).max(40),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    ...quoteCatalogRateFields,
  })
  .refine(
    (value) => !value.validUntil || value.validUntil >= value.validFrom,
    {
      path: ["validUntil"],
      message: "The catalog rate cannot expire before it starts.",
    },
  );

export const quoteCatalogRateInputSchema = z
  .object({
    organizationId: z.uuid(),
    productId: z.uuid(),
    ...quoteCatalogRateFields,
  })
  .refine(
    (value) => !value.validUntil || value.validUntil >= value.validFrom,
    {
      path: ["validUntil"],
      message: "The catalog rate cannot expire before it starts.",
    },
  );

export const quoteCatalogProductStatusInputSchema = z.object({
  organizationId: z.uuid(),
  productId: z.uuid(),
  status: z.enum(["active", "archived"]),
  reason: z.string().trim().min(10).max(500),
});

const quoteProposalItemsSchema = z
  .array(z.string().trim().min(1).max(MAX_QUOTE_PROPOSAL_ITEM_LENGTH))
  .max(MAX_QUOTE_PROPOSAL_ITEMS)
  .superRefine((items, context) => {
    const identities = new Set<string>();
    items.forEach((item, index) => {
      const identity = item.toLocaleLowerCase("en");
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Proposal items must be unique within their section.",
        });
      }
      identities.add(identity);
    });
  });

export const quoteProposalContentInputSchema = z.object({
  organizationId: z.uuid(),
  quoteId: z.uuid(),
  inclusions: quoteProposalItemsSchema.min(1),
  exclusions: quoteProposalItemsSchema,
  terms: quoteProposalItemsSchema.min(1),
});

export const structuredQuoteRevisionInputSchema = z
  .object({
    organizationId: z.uuid(),
    quoteId: z.uuid(),
    items: z.array(structuredQuoteLineInputSchema).min(1).max(50),
  })
  .superRefine((revision, context) => {
    let netTotal = 0;
    let taxTotal = 0;
    let costTotal = 0;
    for (const line of revision.items) {
      const base = Math.round(line.quantity * line.unitPriceAmount * 100) / 100;
      const net = base - line.discountAmount;
      netTotal += net;
      taxTotal += Math.round((net * line.taxPercent) / 100 * 100) / 100;
      costTotal += Math.round(line.quantity * line.unitCostAmount * 100) / 100;
    }
    if (
      netTotal > MAX_QUOTE_AMOUNT ||
      netTotal + taxTotal > MAX_QUOTE_AMOUNT ||
      costTotal > MAX_QUOTE_AMOUNT
    ) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "The quote aggregate exceeds the supported currency limit.",
      });
    }
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

const isoCountryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Use a two-letter ISO country code.")
  .transform((value) => value.toUpperCase());

export const travelerEntryCheckInputSchema = z
  .object({
    organizationId: z.uuid(),
    tripId: z.uuid(),
    travelerId: z.uuid(),
    destinationCountryCode: isoCountryCodeSchema,
    citizenshipCountryCode: isoCountryCodeSchema,
    passportIssuingCountryCode: isoCountryCodeSchema.nullable().optional(),
    passportExpiresOn: z.iso.date().nullable().optional(),
    passportValidityMonthsRequired: z.number().int().min(0).max(12),
    visaRequirement: z.enum([
      "unknown",
      "not_required",
      "required",
      "conditional",
    ]),
    visaStatus: z.enum([
      "unknown",
      "not_applicable",
      "researching",
      "application_pending",
      "granted",
      "refused",
    ]),
    visaValidUntil: z.iso.date().nullable().optional(),
    actionDueOn: z.iso.date().nullable().optional(),
    evidenceSourceLabel: z.string().trim().min(2).max(180).nullable().optional(),
    evidenceSourceUrl: z
      .url()
      .max(1_000)
      .refine((value) => new URL(value).protocol === "https:", {
        message: "The evidence link must use HTTPS.",
      })
      .nullable()
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      value.visaRequirement !== "unknown" &&
      !value.evidenceSourceLabel
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceSourceLabel"],
        message: "Name the human-reviewed visa evidence source.",
      });
    }

    const stateIsValid =
      (value.visaRequirement === "not_required" &&
        value.visaStatus === "not_applicable") ||
      (["required", "conditional"].includes(value.visaRequirement) &&
        value.visaStatus !== "not_applicable") ||
      (value.visaRequirement === "unknown" &&
        ["unknown", "researching"].includes(value.visaStatus));

    if (!stateIsValid) {
      context.addIssue({
        code: "custom",
        path: ["visaStatus"],
        message: "The visa requirement and workflow state do not agree.",
      });
    }
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
  documentKind: z.enum([
    "voucher",
    "ticket",
    "insurance",
    "visa",
    "identity",
    "other",
  ]),
  expiresAt: z.iso.date().nullable().optional(),
});

export const tripDocumentDownloadSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  documentId: z.uuid(),
});

export const travelerPortalApprovalSchema = z
  .object({
    organizationId: z.uuid(),
    tripId: z.uuid(),
    documentIds: z.array(z.uuid()).max(20),
    includePaymentStatus: z.boolean(),
    durationDays: z.number().int().min(1).max(30),
  })
  .refine(
    (value) => new Set(value.documentIds).size === value.documentIds.length,
    {
      message: "Choose each traveler document only once.",
      path: ["documentIds"],
    },
  );

export const travelerPortalPublishSchema = z.object({
  organizationId: z.uuid(),
  tripId: z.uuid(),
  approvalId: z.uuid(),
});

export const travelerPortalRevokeSchema = z.object({
  organizationId: z.uuid(),
  portalLinkId: z.uuid(),
  note: z.string().trim().min(5).max(500),
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

export const supplierProfileInputSchema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(2).max(180),
  category: z.string().trim().max(120).nullable().optional(),
  contactName: z.string().trim().max(180).nullable().optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  website: z.url().max(500).nullable().optional(),
  preferredCurrency: z.string().trim().regex(/^[A-Z]{3}$/),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  cancellationTerms: z.string().trim().max(5_000).nullable().optional(),
  internalNotes: z.string().trim().max(5_000).nullable().optional(),
  qualityRating: z.number().min(1).max(5).nullable().optional(),
});

export const supplierContactInputSchema = z
  .object({
    organizationId: z.uuid(),
    supplierId: z.uuid(),
    name: z.string().trim().min(1).max(180),
    roleTitle: z.string().trim().max(180).nullable().optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()).nullable().optional(),
    phone: z.string().trim().min(3).max(40).nullable().optional(),
    isPrimary: z.boolean().default(false),
    notes: z.string().trim().max(2_000).nullable().optional(),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: "Add an email address or phone number.",
    path: ["email"],
  });

export const supplierContractInputSchema = z
  .object({
    organizationId: z.uuid(),
    supplierId: z.uuid(),
    title: z.string().trim().min(1).max(180),
    contractReference: z.string().trim().max(180).nullable().optional(),
    status: z.enum(["draft", "active"]),
    startsOn: z.iso.date().nullable().optional(),
    endsOn: z.iso.date().nullable().optional(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
    cancellationTerms: z.string().trim().max(5_000).nullable().optional(),
    internalNotes: z.string().trim().max(5_000).nullable().optional(),
  })
  .refine(
    (value) =>
      !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn,
    {
      message: "The contract end date cannot be before its start date.",
      path: ["endsOn"],
    },
  );

export const paymentObligationInputSchema = z.object({
  organizationId: z.uuid(),
  direction: z.enum(["receivable", "payable"]),
  title: z.string().trim().min(1).max(180),
  amount: z.number().positive().max(999_999_999_999.99).finite(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  dueAt: z.iso.date().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  tripId: z.uuid().nullable().optional(),
  supplierId: z.uuid().nullable().optional(),
  invoiceNumber: z.string().trim().max(180).nullable().optional(),
  description: z.string().trim().max(4_000).nullable().optional(),
});

export const paymentAllocationInputSchema = z
  .object({
    organizationId: z.uuid(),
    paymentId: z.uuid(),
    amount: z.number().positive().max(999_999_999_999.99).finite(),
    occurredAt: z.iso.datetime(),
    reference: z.string().trim().max(180).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Boolean(value.reference || value.note), {
    message: "Add a reference or note as settlement evidence.",
    path: ["reference"],
  });

export const paymentVoidInputSchema = z.object({
  organizationId: z.uuid(),
  paymentId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const paymentStatusRefreshSchema = z.object({
  organizationId: z.uuid(),
});

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
export type QuoteApprovalPolicyInput = z.infer<
  typeof quoteApprovalPolicyInputSchema
>;
export type StructuredQuoteRevisionInput = z.infer<
  typeof structuredQuoteRevisionInputSchema
>;
export type QuoteCatalogProductInput = z.infer<
  typeof quoteCatalogProductInputSchema
>;
export type QuoteCatalogRateInput = z.infer<
  typeof quoteCatalogRateInputSchema
>;
export type QuoteCatalogProductStatusInput = z.infer<
  typeof quoteCatalogProductStatusInputSchema
>;
export type QuoteProposalContentInput = z.infer<
  typeof quoteProposalContentInputSchema
>;
export type TripDraftInput = z.infer<typeof tripDraftInputSchema>;
export type WonDealConversionInput = z.infer<typeof wonDealConversionSchema>;
export type TripOperationsUpdateInput = z.infer<
  typeof tripOperationsUpdateSchema
>;
export type TripStatusUpdateInput = z.infer<typeof tripStatusUpdateSchema>;
export type TripTravelerInput = z.infer<typeof tripTravelerInputSchema>;
export type TravelerEntryCheckInput = z.infer<
  typeof travelerEntryCheckInputSchema
>;
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
export type TravelerPortalApprovalInput = z.infer<
  typeof travelerPortalApprovalSchema
>;
export type TravelerPortalPublishInput = z.infer<
  typeof travelerPortalPublishSchema
>;
export type TravelerPortalRevokeInput = z.infer<
  typeof travelerPortalRevokeSchema
>;
export type OperationsRadarRefreshInput = z.infer<
  typeof operationsRadarRefreshSchema
>;
export type OperationalExceptionStatusInput = z.infer<
  typeof operationalExceptionStatusSchema
>;
export type SupplierProfileInput = z.infer<typeof supplierProfileInputSchema>;
export type SupplierContactInput = z.infer<typeof supplierContactInputSchema>;
export type SupplierContractInput = z.infer<typeof supplierContractInputSchema>;
export type PaymentObligationInput = z.infer<
  typeof paymentObligationInputSchema
>;
export type PaymentAllocationInput = z.infer<
  typeof paymentAllocationInputSchema
>;
export type PaymentVoidInput = z.infer<typeof paymentVoidInputSchema>;
export type PaymentStatusRefreshInput = z.infer<
  typeof paymentStatusRefreshSchema
>;
export type ItineraryItemInput = z.infer<typeof itineraryItemInputSchema>;
export type ItineraryTemplateFromTripInput = z.infer<
  typeof itineraryTemplateFromTripInputSchema
>;
export type ItineraryTemplateApplyInput = z.infer<
  typeof itineraryTemplateApplyInputSchema
>;
export type ItineraryCommentInput = z.infer<typeof itineraryCommentInputSchema>;
