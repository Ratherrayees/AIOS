import { z } from "zod";

export const QUOTE_ACCEPTANCE_STATEMENT_VERSION = 1 as const;
export const MAX_QUOTE_SIGNATORY_NAME_LENGTH = 160;

const quoteAcceptanceTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);

export const publicQuoteAcceptanceInputSchema = z.object({
  token: quoteAcceptanceTokenSchema,
  signatoryName: z
    .string()
    .trim()
    .min(2)
    .max(MAX_QUOTE_SIGNATORY_NAME_LENGTH),
  confirmed: z.literal(true),
  statementVersion: z.literal(QUOTE_ACCEPTANCE_STATEMENT_VERSION),
});

export const quoteAcceptanceSnapshotSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("accepted"),
    accepted_at: z.iso.datetime({ offset: true }),
    statement_version: z.literal(QUOTE_ACCEPTANCE_STATEMENT_VERSION),
  }),
]);

export type PublicQuoteAcceptanceInput = z.infer<
  typeof publicQuoteAcceptanceInputSchema
>;
