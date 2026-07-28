const SAFE_DEAL_STAGE_MESSAGES = [
  "Sign in is required.",
  "Multi-factor verification is required.",
  "You do not have permission to move opportunities.",
  "That opportunity is not available.",
  "That pipeline transition is not allowed.",
  "Qualification requires an owner, destination, next step, expected close date, and probability of at least 20%.",
  "Proposal requires a positive value, next step, and expected close date.",
  "Decision requires a positive value, probability of at least 50%, and a next step.",
  "A won opportunity requires a contact and positive value.",
  "A loss reason is required.",
  "Complete every required qualification check before advancing this opportunity.",
] as const;

const DEAL_STAGE_FALLBACK =
  "The opportunity stage was not updated. Please try again.";

/**
 * Exposes only reviewed business-rule errors across the Server Action boundary.
 * Database details and unexpected failures remain private.
 */
export function safeDealStageError(message: string | null | undefined) {
  if (!message) return DEAL_STAGE_FALLBACK;
  return (
    SAFE_DEAL_STAGE_MESSAGES.find((candidate) => message.includes(candidate)) ??
    DEAL_STAGE_FALLBACK
  );
}
