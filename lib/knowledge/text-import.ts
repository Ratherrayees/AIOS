import { z } from "zod";

import {
  knowledgeAuthoritySchema,
  knowledgeSourceKindSchema,
} from "./schemas";

export const MAX_KNOWLEDGE_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_KNOWLEDGE_IMPORT_SECTIONS = 80;
export const MAX_KNOWLEDGE_CHUNK_CHARACTERS = 1_800;

const optionalImportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

export const knowledgeTextImportInputSchema = z
  .object({
    organizationId: z.uuid(),
    title: z.string().trim().min(2).max(180),
    sourceKind: knowledgeSourceKindSchema,
    authority: knowledgeAuthoritySchema,
    sensitivity: z.enum(["normal", "restricted"]),
    versionLabel: z.string().trim().min(1).max(80),
    sourceUrl: z
      .url()
      .refine(
        (value) => value.startsWith("https://"),
        "Use an HTTPS source link.",
      )
      .nullable()
      .optional(),
    summary: z.string().trim().max(2_000).nullable().optional(),
    validFrom: optionalImportDateSchema,
    reviewDueOn: optionalImportDateSchema,
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine(
        (value) =>
          [...value].every((character) => {
            const code = character.charCodeAt(0);
            return (
              character !== "/" &&
              character !== "\\" &&
              code >= 32 &&
              code !== 127
            );
          }) &&
          /\.(?:txt|md|markdown)$/i.test(value),
        "Use a safe .txt, .md, or .markdown file name.",
      ),
    mimeType: z.enum([
      "text/plain",
      "text/markdown",
      "text/x-markdown",
      "application/octet-stream",
    ]),
    text: z.string().min(2).max(MAX_KNOWLEDGE_TEXT_FILE_BYTES),
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

export type KnowledgeTextImportInput = z.infer<
  typeof knowledgeTextImportInputSchema
>;

export type KnowledgeTextChunk = {
  heading: string;
  content: string;
  citationLabel: string;
  position: number;
};

function splitLongBlock(value: string) {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining.length > MAX_KNOWLEDGE_CHUNK_CHARACTERS) {
    const candidate = remaining.slice(0, MAX_KNOWLEDGE_CHUNK_CHARACTERS + 1);
    const breakAt = Math.max(
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" "),
    );
    const safeBreak =
      breakAt >= Math.floor(MAX_KNOWLEDGE_CHUNK_CHARACTERS * 0.55)
        ? breakAt + (candidate.slice(breakAt, breakAt + 2) === ". " ? 1 : 0)
        : MAX_KNOWLEDGE_CHUNK_CHARACTERS;
    parts.push(remaining.slice(0, safeBreak).trim());
    remaining = remaining.slice(safeBreak).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function removeUnsafeControls(value: string) {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return (
        character === "\n" ||
        character === "\t" ||
        (code >= 32 && code !== 127)
      );
    })
    .join("");
}

/**
 * Converts untrusted plain text or Markdown into bounded reviewable passages.
 * It performs no semantic interpretation and never approves imported content.
 */
export function createKnowledgeTextChunks(input: {
  title: string;
  fileName: string;
  text: string;
}): KnowledgeTextChunk[] {
  const normalized = removeUnsafeControls(
    input.text.replace(/\r\n?/g, "\n"),
  ).trim();
  if (normalized.length < 2)
    throw new Error("The text file contains no reviewable content.");

  const blocks: Array<{ heading: string; content: string }> = [];
  let currentHeading = "Imported passage";
  let paragraph: string[] = [];
  const flushParagraph = () => {
    const content = paragraph.join("\n").trim();
    if (content) blocks.push({ heading: currentHeading, content });
    paragraph = [];
  };

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trimEnd();
    const markdownHeading = line.match(/^#{1,6}\s+(.{1,180})$/);
    if (markdownHeading) {
      flushParagraph();
      currentHeading = markdownHeading[1].trim();
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  const chunks = blocks.flatMap((block) =>
    splitLongBlock(block.content).map((content) => ({
      heading: block.heading,
      content,
    })),
  );
  if (chunks.length === 0)
    throw new Error("The text file contains no reviewable content.");
  if (chunks.length > MAX_KNOWLEDGE_IMPORT_SECTIONS)
    throw new Error(
      `The file expands beyond ${MAX_KNOWLEDGE_IMPORT_SECTIONS} reviewable passages.`,
    );

  return chunks.map((chunk, index) => ({
    heading:
      chunk.heading === "Imported passage"
        ? `Imported passage ${String(index + 1).padStart(2, "0")}`
        : chunk.heading,
    content: chunk.content,
    citationLabel: `${input.title} · ${input.fileName} · passage ${index + 1}`,
    position: index,
  }));
}
