const FIRST_RETRY_DELAY_SECONDS = 30;
const RETRY_MULTIPLIER = 4;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;

/**
 * Returns the delay after a failed attempt. The bounded schedule is
 * deterministic so workers agree on retry timing without provider calls.
 */
export function aiJobRetryDelaySeconds(attempt: number) {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    MAX_RETRY_DELAY_SECONDS,
    FIRST_RETRY_DELAY_SECONDS *
      RETRY_MULTIPLIER ** (normalizedAttempt - 1),
  );
}
