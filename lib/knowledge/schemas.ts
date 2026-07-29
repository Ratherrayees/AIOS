import { z } from "zod";

export const knowledgeSourceKindSchema = z.enum([
  "destination_guide",
  "visa_advisory",
  "supplier_terms",
  "sop",
  "policy",
  "product_sheet",
  "other",
]);

export const knowledgeAuthoritySchema = z.enum([
  "official",
  "supplier",
  "internal",
  "third_party",
]);

export const knowledgeSourceStatusSchema = z.enum([
  "draft",
  "in_review",
  "approved",
  "retired",
]);

const optionalHttpsUrlSchema = z
  .url()
  .refine((value) => value.startsWith("https://"), "Use an HTTPS source link.")
  .nullable()
  .optional();

const optionalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

export const knowledgeSourceInputSchema = z
  .object({
    organizationId: z.uuid(),
    sourceId: z.uuid().nullable().optional(),
    title: z.string().trim().min(2).max(180),
    sourceKind: knowledgeSourceKindSchema,
    authority: knowledgeAuthoritySchema,
    sensitivity: z.enum(["normal", "restricted"]),
    versionLabel: z.string().trim().min(1).max(80),
    sourceUrl: optionalHttpsUrlSchema,
    summary: z.string().trim().max(2_000).nullable().optional(),
    validFrom: optionalDateSchema,
    reviewDueOn: optionalDateSchema,
  })
  .superRefine((value, context) => {
    if (
      value.validFrom &&
      value.reviewDueOn &&
      value.reviewDueOn < value.validFrom
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewDueOn"],
        message: "The review date cannot precede the valid-from date.",
      });
    }
  });

export const knowledgeSectionInputSchema = z.object({
  organizationId: z.uuid(),
  sourceId: z.uuid(),
  heading: z.string().trim().min(2).max(180),
  content: z.string().trim().min(2).max(8_000),
  citationLabel: z.string().trim().min(2).max(300),
  position: z.number().int().min(0).max(10_000),
});

export const knowledgeTransitionInputSchema = z.object({
  organizationId: z.uuid(),
  sourceId: z.uuid(),
  status: knowledgeSourceStatusSchema,
});

export const knowledgeSearchInputSchema = z.object({
  organizationId: z.uuid(),
  query: z.string().trim().min(2).max(240),
  limit: z.number().int().min(1).max(12).default(8),
});

export const knowledgeSearchResultSchema = z.object({
  section_id: z.uuid(),
  source_id: z.uuid(),
  source_title: z.string().min(1),
  source_kind: knowledgeSourceKindSchema,
  authority: knowledgeAuthoritySchema,
  sensitivity: z.enum(["normal", "restricted"]),
  version_label: z.string().min(1),
  source_url: z.string().nullable(),
  heading: z.string().min(1),
  excerpt: z.string().min(1),
  citation_label: z.string().min(1),
  review_due_on: z.string().nullable(),
  is_stale: z.boolean(),
  relevance: z.number(),
});

export type KnowledgeSourceInput = z.infer<typeof knowledgeSourceInputSchema>;
export type KnowledgeSectionInput = z.infer<typeof knowledgeSectionInputSchema>;
export type KnowledgeSearchResult = z.infer<
  typeof knowledgeSearchResultSchema
>;

export function isKnowledgeReviewStale(
  reviewDueOn: string | null,
  today: string,
) {
  return reviewDueOn === null || reviewDueOn < today;
}
