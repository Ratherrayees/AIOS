import { z } from "zod";

export const knowledgeAnswerQuestionSchema = z.object({
  organizationId: z.uuid(),
  question: z.string().trim().min(2).max(240),
});

export const knowledgeAnswerEvidenceSchema = z.object({
  sectionId: z.uuid(),
  sourceId: z.uuid(),
  sourceTitle: z.string().trim().min(1).max(180),
  versionLabel: z.string().trim().min(1).max(80),
  sourceUrl: z.string().url().nullable(),
  heading: z.string().trim().min(1).max(180),
  excerpt: z.string().trim().min(1).max(500),
  citationLabel: z.string().trim().min(1).max(300),
  reviewDueOn: z.iso.date().nullable(),
  isStale: z.boolean(),
});

export type KnowledgeAnswerEvidence = z.infer<
  typeof knowledgeAnswerEvidenceSchema
>;

export const knowledgeAnswerModelOutputSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().trim().min(2).max(700),
        evidenceSectionIds: z
          .array(z.uuid())
          .min(1)
          .max(8)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Claim evidence must not repeat.",
          ),
      }),
    )
    .min(1)
    .max(8),
  caveats: z
    .array(z.string().trim().min(2).max(300))
    .max(8)
    .refine(
      (items) =>
        new Set(items.map((item) => item.toLowerCase())).size === items.length,
      "Caveats must not repeat.",
    ),
  confidence: z.number().min(0).max(1),
});

export type KnowledgeAnswerModelOutput = z.infer<
  typeof knowledgeAnswerModelOutputSchema
>;

export type KnowledgeAnswerCitation = {
  sectionId: string;
  sourceId: string;
  label: string;
  sourceTitle: string;
  versionLabel: string;
  sourceUrl: string | null;
  reviewDueOn: string | null;
};

export type KnowledgeAnswer = {
  claims: Array<{
    text: string;
    citations: KnowledgeAnswerCitation[];
  }>;
  caveats: string[];
  confidence: number;
};

const SUPPORT_STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "could",
  "from",
  "have",
  "into",
  "must",
  "only",
  "should",
  "that",
  "their",
  "there",
  "these",
  "this",
  "those",
  "traveller",
  "travel",
  "with",
  "would",
]);

function supportTerms(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter(
          (term) => term.length >= 4 && !SUPPORT_STOP_WORDS.has(term),
        ) ?? [],
    ),
  ];
}

function factualTokens(value: string) {
  return [
    ...new Set(
      value.match(
        /\b(?:\d{1,4}(?:[.,]\d+)?%?|[A-Z]{3}\s*\d+(?:[.,]\d+)?|\d{4}-\d{2}-\d{2})\b/g,
      ) ?? [],
    ),
  ];
}

/**
 * Models may choose only from already-retrieved passage IDs. The server maps
 * those IDs to citations and rejects weakly grounded claims or invented
 * numbers/dates before anything is rendered as an answer.
 */
export function parseGroundedKnowledgeAnswer(
  value: unknown,
  evidence: KnowledgeAnswerEvidence[],
): KnowledgeAnswer {
  const parsed = knowledgeAnswerModelOutputSchema.parse(value);
  const allowedEvidence = new Map(
    evidence
      .filter((item) => !item.isStale)
      .map((item) => [item.sectionId, item]),
  );
  const normalizedClaims = new Set<string>();

  const claims = parsed.claims.map((claim) => {
    const claimKey = claim.text.toLowerCase();
    if (normalizedClaims.has(claimKey))
      throw new Error("The model repeated the same knowledge claim.");
    normalizedClaims.add(claimKey);

    const citedEvidence = claim.evidenceSectionIds.map((sectionId) => {
      const item = allowedEvidence.get(sectionId);
      if (!item)
        throw new Error(
          "The model cited evidence that is unavailable, stale, or unauthorized.",
        );
      return item;
    });
    const evidenceText = citedEvidence
      .map((item) => `${item.heading} ${item.excerpt}`)
      .join(" ")
      .toLowerCase();
    const claimTerms = supportTerms(claim.text);
    const supportedTerms = claimTerms.filter((term) =>
      evidenceText.includes(term),
    );
    const minimumSupportedTerms =
      claimTerms.length <= 3 ? 1 : Math.ceil(claimTerms.length * 0.25);
    if (
      claimTerms.length === 0 ||
      supportedTerms.length < minimumSupportedTerms
    )
      throw new Error(
        "The model produced a claim without enough lexical evidence.",
      );
    if (
      factualTokens(claim.text).some(
        (token) => !evidenceText.includes(token.toLowerCase()),
      )
    )
      throw new Error(
        "The model introduced a number or date absent from its evidence.",
      );

    return {
      text: claim.text,
      citations: citedEvidence.map((item) => ({
        sectionId: item.sectionId,
        sourceId: item.sourceId,
        label: item.citationLabel,
        sourceTitle: item.sourceTitle,
        versionLabel: item.versionLabel,
        sourceUrl: item.sourceUrl,
        reviewDueOn: item.reviewDueOn,
      })),
    };
  });

  return {
    claims,
    caveats: parsed.caveats,
    confidence: parsed.confidence,
  };
}

export function knowledgeAnswerNeedsHumanReview(question: string) {
  return /\b(?:visa|passport|immigration|entry requirement|legal|health|medical|refund|payment|price|booking)\b/i.test(
    question,
  );
}
