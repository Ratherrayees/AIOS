/**
 * Prompt versions are release identifiers, not model names. Increment the
 * relevant value whenever instructions or structured-output intent changes.
 */
export const AIOS_PROMPT_VERSIONS = {
  leadIntake: "lead-intake.2026-07-26.1",
  itineraryDraft: "itinerary-draft.2026-07-26.1",
} as const;
