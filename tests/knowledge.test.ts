import assert from "node:assert/strict";
import test from "node:test";

import {
  isKnowledgeReviewStale,
  knowledgeRenewalInputSchema,
  knowledgeSearchInputSchema,
  knowledgeSearchResultSchema,
  knowledgeSectionDeleteInputSchema,
  knowledgeSectionInputSchema,
  knowledgeSectionRevisionInputSchema,
  knowledgeSourceInputSchema,
} from "../lib/knowledge/schemas";

const organizationId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";

test("knowledge sources require an HTTPS evidence link", () => {
  const parsed = knowledgeSourceInputSchema.safeParse({
    organizationId,
    title: "Kyoto rail policy",
    sourceKind: "destination_guide",
    authority: "official",
    sensitivity: "normal",
    versionLabel: "2026.1",
    sourceUrl: "http://example.com/policy",
    reviewDueOn: "2027-07-29",
  });
  assert.equal(parsed.success, false);
});

test("knowledge source review cannot precede its valid-from date", () => {
  const parsed = knowledgeSourceInputSchema.safeParse({
    organizationId,
    title: "Supplier terms",
    sourceKind: "supplier_terms",
    authority: "supplier",
    sensitivity: "restricted",
    versionLabel: "4",
    validFrom: "2027-08-01",
    reviewDueOn: "2027-07-31",
  });
  assert.equal(parsed.success, false);
});

test("citation-ready sections enforce bounded evidence", () => {
  const parsed = knowledgeSectionInputSchema.parse({
    organizationId,
    sourceId,
    heading: "Cancellation windows",
    content: "Operator review is required before a customer commitment.",
    citationLabel: "Policy §4",
    position: 0,
  });
  assert.equal(parsed.citationLabel, "Policy §4");
});

test("draft passage revisions retain source and section boundaries", () => {
  const parsed = knowledgeSectionRevisionInputSchema.parse({
    organizationId,
    sourceId,
    sectionId: "33333333-3333-4333-8333-333333333333",
    heading: "Revised cancellation windows",
    content: "The reviewed replacement policy requires a human confirmation.",
    citationLabel: "Policy §5",
    position: 0,
  });
  assert.equal(parsed.sourceId, sourceId);
  assert.equal(
    knowledgeSectionDeleteInputSchema.parse({
      organizationId,
      sourceId,
      sectionId: parsed.sectionId,
    }).sectionId,
    parsed.sectionId,
  );
});

test("knowledge replacements require a valid review window", () => {
  const parsed = knowledgeRenewalInputSchema.safeParse({
    organizationId,
    sourceId,
    versionLabel: "2027.1",
    validFrom: "2027-08-01",
    reviewDueOn: "2027-07-31",
  });
  assert.equal(parsed.success, false);
});

test("knowledge searches trim the question and cap retrieval", () => {
  const parsed = knowledgeSearchInputSchema.parse({
    organizationId,
    query: "  rail cancellation  ",
    limit: 12,
  });
  assert.equal(parsed.query, "rail cancellation");
  assert.equal(parsed.limit, 12);
});

test("retrieval contracts preserve citations and explicit freshness", () => {
  const result = knowledgeSearchResultSchema.parse({
    section_id: "33333333-3333-4333-8333-333333333333",
    source_id: sourceId,
    source_title: "Kyoto rail policy",
    source_kind: "destination_guide",
    authority: "official",
    sensitivity: "normal",
    version_label: "2026.1",
    source_url: "https://example.com/policy",
    heading: "Cancellation windows",
    excerpt: "Operator review is required.",
    citation_label: "Policy §4",
    review_due_on: "2026-07-28",
    is_stale: true,
    relevance: 0.9,
  });
  assert.equal(result.is_stale, true);
  assert.equal(
    isKnowledgeReviewStale(result.review_due_on, "2026-07-29"),
    true,
  );
});
