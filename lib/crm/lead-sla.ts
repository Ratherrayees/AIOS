export type LeadSlaInput = {
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  followUpDueAt: string | null;
};

export type LeadSlaAssessment = {
  level: 0 | 1 | 2 | 3;
  kind: "first_response" | "follow_up" | null;
  dueAt: string | null;
};

/** Escalates overdue response work at now, four hours, and twenty-four hours. */
export function assessLeadSla(
  input: LeadSlaInput,
  now = new Date(),
): LeadSlaAssessment {
  const kind = !input.firstRespondedAt
    ? "first_response"
    : input.followUpDueAt
      ? "follow_up"
      : null;
  const dueAt =
    kind === "first_response"
      ? input.firstResponseDueAt
      : kind === "follow_up"
        ? input.followUpDueAt
        : null;
  if (!kind || !dueAt) return { level: 0, kind, dueAt };
  const overdueMs = now.getTime() - new Date(dueAt).getTime();
  if (!Number.isFinite(overdueMs) || overdueMs <= 0)
    return { level: 0, kind, dueAt };
  if (overdueMs >= 24 * 60 * 60 * 1000)
    return { level: 3, kind, dueAt };
  if (overdueMs >= 4 * 60 * 60 * 1000)
    return { level: 2, kind, dueAt };
  return { level: 1, kind, dueAt };
}
