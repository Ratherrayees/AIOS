import type { Json } from "../../types/database";

export type LeadIntakeSource = {
  id: string;
  title: string;
  source: string | null;
  destination: string | null;
  travelStart: string | null;
  travelEnd: string | null;
  travellerCount: number | null;
  notes: string | null;
};

const MAX_LEAD_NOTES_CHARS = 8_000;
const MAX_ITINERARY_ITEMS = 60;

const suspiciousInstructionPatterns = [
  ["ignore_instructions", /ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|system|developer)?\s*(?:instructions|rules|prompt)/i],
  ["system_prompt", /(?:system|developer)\s+(?:prompt|message|instruction)/i],
  ["prompt_exfiltration", /(?:reveal|show|print|repeat)\s+(?:your|the)\s+(?:system|developer|hidden)\s*(?:prompt|instructions?)/i],
  ["role_override", /(?:jailbreak|you\s+are\s+(?:chatgpt|an?\s+ai|the\s+assistant)|act\s+as\s+(?:an?\s+ai|the\s+assistant))/i],
] as const;

function cleanUntrustedText(value: string | null, maxLength: number) {
  if (!value) return null;
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isDisallowedControl =
      codePoint <= 8 ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127;
    return isDisallowedControl ? " " : character;
  })
    .join("")
    .slice(0, maxLength);
}

type RedactionCounts = {
  email: number;
  phone: number;
  passport: number;
};

function emptyRedactionCounts(): RedactionCounts {
  return { email: 0, phone: 0, passport: 0 };
}

function addRedactionCounts(
  target: RedactionCounts,
  source: RedactionCounts,
) {
  target.email += source.email;
  target.phone += source.phone;
  target.passport += source.passport;
}

/**
 * Removes common direct identifiers from free text before provider transit.
 * Structured CRM fields stay governed separately; this helper never logs the
 * original values.
 */
export function redactSensitiveModelText(value: string | null) {
  if (!value) return { value, counts: emptyRedactionCounts() };
  const counts = emptyRedactionCounts();
  let redacted = value.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    () => {
      counts.email += 1;
      return "[REDACTED_EMAIL]";
    },
  );
  redacted = redacted.replace(
    /\b((?:phone|mobile|whatsapp|tel(?:ephone)?)\s*[:#-]?\s*)\+?\d[\d\s().-]{6,}\d\b/gi,
    (_match, prefix: string) => {
      counts.phone += 1;
      return `${prefix}[REDACTED_PHONE]`;
    },
  );
  redacted = redacted.replace(
    /(^|[^\w])\+\d[\d\s().-]{7,}\d\b/g,
    (_match, prefix: string) => {
      counts.phone += 1;
      return `${prefix}[REDACTED_PHONE]`;
    },
  );
  redacted = redacted.replace(
    /\b(passport(?:\s+(?:number|no\.?))?\s*[:#-]?\s*)[A-Z0-9]{6,12}\b/gi,
    (_match, prefix: string) => {
      counts.passport += 1;
      return `${prefix}[REDACTED_PASSPORT]`;
    },
  );
  return { value: redacted, counts };
}

function suspiciousSignals(values: Array<string | null>) {
  const sourceText = values.filter((value): value is string => Boolean(value)).join("\n");
  return suspiciousInstructionPatterns
    .filter(([, pattern]) => pattern.test(sourceText))
    .map(([signal]) => signal);
}

/**
 * Prepares data before it crosses the model boundary. It never logs raw lead
 * notes in its audit result; unsafe content is handed back for human rewrite.
 */
export function inspectLeadIntakeInput(source: LeadIntakeSource) {
  const originalNotes = source.notes || "";
  const signals = suspiciousSignals([
    source.title,
    source.source,
    source.destination,
    source.notes,
  ]);
  const notesTruncated = originalNotes.length > MAX_LEAD_NOTES_CHARS;
  const blocked = signals.length > 0 || notesTruncated;
  const errorCode = signals.length > 0 ? "UNTRUSTED_LEAD_CONTENT" : notesTruncated ? "LEAD_INPUT_TOO_LARGE" : null;
  const redactionCounts = emptyRedactionCounts();
  const redact = (value: string | null, maxLength: number) => {
    const result = redactSensitiveModelText(
      cleanUntrustedText(value, maxLength),
    );
    addRedactionCounts(redactionCounts, result.counts);
    return result.value;
  };

  return {
    source: {
      ...source,
      title: redact(source.title, 180) || "Untitled lead",
      source: redact(source.source, 120),
      destination: redact(source.destination, 180),
      notes: redact(source.notes, MAX_LEAD_NOTES_CHARS),
    },
    blocked,
    errorCode,
    audit: {
      suspicious_instruction_signals: signals,
      notes_truncated: notesTruncated,
      notes_character_count: originalNotes.length,
      sensitive_redactions: redactionCounts,
    } satisfies Json,
  };
}

export type ItineraryDraftSource = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  items: Array<{
    dayNumber: number;
    itemType: string;
    title: string;
  }>;
};

/**
 * Removes control characters and blocks instruction-like trip content before it
 * crosses the model boundary. The audit payload contains counts and signals,
 * never the trip's raw names or itinerary text.
 */
export function inspectItineraryDraftInput(source: ItineraryDraftSource) {
  const signals = suspiciousSignals([
    source.name,
    ...source.items.map((item) => item.title),
  ]);
  const tooManyItems = source.items.length > MAX_ITINERARY_ITEMS;
  const blocked = signals.length > 0 || tooManyItems;
  const errorCode =
    signals.length > 0
      ? "UNTRUSTED_ITINERARY_CONTENT"
      : tooManyItems
        ? "ITINERARY_INPUT_TOO_LARGE"
        : null;
  const redactionCounts = emptyRedactionCounts();
  const redact = (value: string | null, maxLength: number) => {
    const result = redactSensitiveModelText(
      cleanUntrustedText(value, maxLength),
    );
    addRedactionCounts(redactionCounts, result.counts);
    return result.value;
  };

  return {
    source: {
      ...source,
      name: redact(source.name, 180) || "Untitled trip",
      items: source.items.slice(0, MAX_ITINERARY_ITEMS).map((item) => ({
        dayNumber: item.dayNumber,
        itemType: redact(item.itemType, 40) || "note",
        title: redact(item.title, 300) || "Untitled item",
      })),
    },
    blocked,
    errorCode,
    audit: {
      suspicious_instruction_signals: signals,
      itinerary_item_count: source.items.length,
      itinerary_items_truncated: tooManyItems,
      sensitive_redactions: redactionCounts,
    } satisfies Json,
  };
}

export type KnowledgeAnswerInput = {
  question: string;
  evidence: Array<{
    sectionId: string;
    heading: string;
    excerpt: string;
  }>;
};

/**
 * Treats both the operator question and retrieved passage text as untrusted
 * model input. Approved status is a governance signal, not permission for a
 * passage to override the Answer Desk instructions.
 */
export function inspectKnowledgeAnswerInput(input: KnowledgeAnswerInput) {
  const questionTooLarge = input.question.length > 240;
  const evidenceTooLarge = input.evidence.length > 8;
  const questionSignals = suspiciousSignals([input.question]);
  const evidenceSignals = suspiciousSignals(
    input.evidence.flatMap((item) => [item.heading, item.excerpt]),
  );
  const blocked =
    questionTooLarge ||
    evidenceTooLarge ||
    questionSignals.length > 0 ||
    evidenceSignals.length > 0;
  const errorCode =
    questionSignals.length > 0
      ? "UNTRUSTED_KNOWLEDGE_QUESTION"
      : evidenceSignals.length > 0
        ? "UNTRUSTED_KNOWLEDGE_CONTENT"
        : questionTooLarge || evidenceTooLarge
          ? "KNOWLEDGE_INPUT_TOO_LARGE"
          : null;
  const redactionCounts = emptyRedactionCounts();
  const redact = (value: string, maxLength: number) => {
    const result = redactSensitiveModelText(
      cleanUntrustedText(value, maxLength),
    );
    addRedactionCounts(redactionCounts, result.counts);
    return result.value || "";
  };

  return {
    input: {
      question: redact(input.question, 240),
      evidence: input.evidence.slice(0, 8).map((item) => ({
        sectionId: item.sectionId,
        heading: redact(item.heading, 180),
        excerpt: redact(item.excerpt, 500),
      })),
    },
    blocked,
    errorCode,
    audit: {
      suspicious_question_signals: questionSignals,
      suspicious_evidence_signals: evidenceSignals,
      question_truncated: questionTooLarge,
      evidence_count: input.evidence.length,
      evidence_truncated: evidenceTooLarge,
      sensitive_redactions: redactionCounts,
    } satisfies Json,
  };
}

export type ConversationCopilotSource = {
  id: string;
  subject: string | null;
  channel: string;
  status: string;
  priority: string;
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    sentAt: string;
  }>;
};

const MAX_COPILOT_MESSAGES = 12;
const MAX_COPILOT_MESSAGE_CHARS = 2_500;
const MAX_COPILOT_TOTAL_CHARS = 12_000;

/**
 * Creates a bounded, redacted transcript for the Sales Copilot. Recipient
 * addresses are deliberately absent from this contract and raw text is never
 * copied into audit telemetry.
 */
export function inspectConversationCopilotInput(
  source: ConversationCopilotSource,
) {
  const messages = source.messages.slice(-MAX_COPILOT_MESSAGES);
  const messageTooLarge = messages.some(
    (message) => message.body.length > MAX_COPILOT_MESSAGE_CHARS,
  );
  const totalCharacters = messages.reduce(
    (total, message) => total + message.body.length,
    0,
  );
  const totalTooLarge = totalCharacters > MAX_COPILOT_TOTAL_CHARS;
  const missingEvidence = messages.length === 0;
  const signals = suspiciousSignals([
    source.subject,
    ...messages.map((message) => message.body),
  ]);
  const blocked =
    missingEvidence ||
    messageTooLarge ||
    totalTooLarge ||
    signals.length > 0;
  const errorCode = missingEvidence
    ? "CONVERSATION_EVIDENCE_MISSING"
    : signals.length > 0
      ? "UNTRUSTED_CONVERSATION_CONTENT"
      : messageTooLarge || totalTooLarge
        ? "CONVERSATION_INPUT_TOO_LARGE"
        : null;
  const redactionCounts = emptyRedactionCounts();
  const redact = (value: string | null, maxLength: number) => {
    const result = redactSensitiveModelText(
      cleanUntrustedText(value, maxLength),
    );
    addRedactionCounts(redactionCounts, result.counts);
    return result.value;
  };

  return {
    source: {
      ...source,
      subject: redact(source.subject, 300),
      channel: redact(source.channel, 40) || "manual",
      status: redact(source.status, 40) || "open",
      priority: redact(source.priority, 40) || "normal",
      messages: messages.map((message) => ({
        ...message,
        direction: redact(message.direction, 40) || "internal",
        body:
          redact(message.body, MAX_COPILOT_MESSAGE_CHARS) ||
          "[EMPTY_MESSAGE]",
      })),
    },
    blocked,
    errorCode,
    audit: {
      suspicious_instruction_signals: signals,
      message_count: messages.length,
      messages_truncated: source.messages.length > MAX_COPILOT_MESSAGES,
      message_too_large: messageTooLarge,
      total_character_count: totalCharacters,
      total_too_large: totalTooLarge,
      evidence_missing: missingEvidence,
      sensitive_redactions: redactionCounts,
    } satisfies Json,
  };
}
