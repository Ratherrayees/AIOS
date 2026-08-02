import { z } from "zod";

import { QUOTE_LINE_CATEGORIES } from "./quote-pricing";
import {
  MAX_QUOTE_PAYMENT_SCHEDULE_ITEMS,
  quotePaymentScheduleStoredItemSchema,
} from "./quote-payment-schedule";
import {
  MAX_QUOTE_PROPOSAL_ITEM_LENGTH,
  MAX_QUOTE_PROPOSAL_ITEMS,
  QUOTE_PROPOSAL_SCHEMA_VERSION,
} from "./quote-proposal";

export const quoteShareTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);

const proposalItemsSchema = z
  .array(z.string().trim().min(1).max(MAX_QUOTE_PROPOSAL_ITEM_LENGTH))
  .max(MAX_QUOTE_PROPOSAL_ITEMS);

export const quoteShareSnapshotSchema = z.object({
  schema_version: z.literal(1),
  published_at: z.iso.datetime({ offset: true }),
  expires_at: z.iso.datetime({ offset: true }),
  organization: z.object({
    name: z.string().trim().min(1).max(180),
  }),
  customer: z.object({
    name: z.string().trim().min(1).max(201),
    destination: z.string().nullable(),
  }),
  quote: z.object({
    title: z.string().trim().min(1).max(180),
    version: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    valid_until: z.iso.date().nullable(),
    total_amount: z.number().nonnegative(),
    line_items: z.array(
      z.object({
        position: z.number().int().min(0).max(49),
        category: z.enum(QUOTE_LINE_CATEGORIES),
        description: z.string().trim().min(1).max(180),
        quantity: z.number().positive(),
        discount_amount: z.number().nonnegative(),
        tax_percent: z.number().min(0).max(100),
        tax_amount: z.number().nonnegative(),
        total_amount: z.number().nonnegative(),
      }),
    ).max(50),
    payment_schedule: z
      .array(quotePaymentScheduleStoredItemSchema)
      .max(MAX_QUOTE_PAYMENT_SCHEDULE_ITEMS)
      .default([]),
    content: z.object({
      schema_version: z.literal(QUOTE_PROPOSAL_SCHEMA_VERSION),
      inclusions: proposalItemsSchema.min(1),
      exclusions: proposalItemsSchema,
      terms: proposalItemsSchema.min(1),
    }),
  }),
});

export type QuoteShareSnapshot = z.infer<typeof quoteShareSnapshotSchema>;
