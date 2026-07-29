import assert from "node:assert/strict";
import test from "node:test";

import {
  createKnowledgeTextChunks,
  knowledgeTextImportInputSchema,
  MAX_KNOWLEDGE_CHUNK_CHARACTERS,
} from "../lib/knowledge/text-import";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("Markdown imports retain headings and deterministic citation provenance", () => {
  const chunks = createKnowledgeTextChunks({
    title: "Japan operating guide",
    fileName: "japan-ops.md",
    text: [
      "# Arrival support",
      "Meet the traveller at the signed airport desk.",
      "",
      "## Escalation",
      "Call the duty operator when a confirmed service is missing.",
    ].join("\n"),
  });
  assert.deepEqual(
    chunks.map((chunk) => ({
      heading: chunk.heading,
      citationLabel: chunk.citationLabel,
      position: chunk.position,
    })),
    [
      {
        heading: "Arrival support",
        citationLabel:
          "Japan operating guide · japan-ops.md · passage 1",
        position: 0,
      },
      {
        heading: "Escalation",
        citationLabel:
          "Japan operating guide · japan-ops.md · passage 2",
        position: 1,
      },
    ],
  );
});

test("long imported paragraphs are split into bounded review passages", () => {
  const chunks = createKnowledgeTextChunks({
    title: "Long guide",
    fileName: "long.txt",
    text: "reviewable guidance ".repeat(300),
  });
  assert.ok(chunks.length > 1);
  assert.ok(
    chunks.every(
      (chunk) => chunk.content.length <= MAX_KNOWLEDGE_CHUNK_CHARACTERS,
    ),
  );
});

test("text import rejects unsafe file names and inverted review dates", () => {
  const parsed = knowledgeTextImportInputSchema.safeParse({
    organizationId,
    title: "Unsafe import",
    sourceKind: "sop",
    authority: "internal",
    sensitivity: "restricted",
    versionLabel: "1",
    validFrom: "2027-08-01",
    reviewDueOn: "2027-07-31",
    fileName: "../unsafe.md",
    mimeType: "text/markdown",
    text: "Useful evidence.",
  });
  assert.equal(parsed.success, false);
});

test("plain text imports receive human-readable fallback headings", () => {
  const chunks = createKnowledgeTextChunks({
    title: "Airport playbook",
    fileName: "airport.txt",
    text: "First reviewed step.\n\nSecond reviewed step.",
  });
  assert.deepEqual(
    chunks.map((chunk) => chunk.heading),
    ["Imported passage 01", "Imported passage 02"],
  );
});
