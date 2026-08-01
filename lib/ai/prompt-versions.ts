/**
 * Prompt versions are release identifiers, not model names. Increment the
 * relevant value whenever instructions or structured-output intent changes.
 */
export const AIOS_PROMPT_VERSIONS = {
  leadIntake: "lead-intake.2026-07-26.1",
  itineraryDraft: "itinerary-draft.2026-07-26.1",
  knowledgeAnswer: "knowledge-answer.2026-07-29.1",
  conversationReplyDraft: "conversation-reply-draft.2026-08-01.1",
} as const;
