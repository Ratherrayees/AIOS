export type InboxSlaPriority = "low" | "normal" | "high" | "urgent";
export type InboxSlaEscalationLevel = 0 | 1 | 2 | 3;

const HOUR_MS = 60 * 60 * 1000;

export function inboxSlaPriority(value: unknown): InboxSlaPriority {
  return value === "low" ||
    value === "high" ||
    value === "urgent"
    ? value
    : "normal";
}

/**
 * Converts an objective response deadline into a bounded escalation tier.
 * Urgent conversations advance one tier, but never beyond level three.
 */
export function inboxSlaEscalationLevel(input: {
  responseDueAt: string | null;
  priority: InboxSlaPriority;
  now?: Date;
}): InboxSlaEscalationLevel {
  if (!input.responseDueAt) return 0;
  const dueAt = new Date(input.responseDueAt).getTime();
  const now = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(dueAt) || dueAt >= now) return 0;

  const overdueHours = (now - dueAt) / HOUR_MS;
  const baseLevel: InboxSlaEscalationLevel =
    overdueHours >= 24 ? 3 : overdueHours >= 4 ? 2 : 1;
  if (input.priority !== "urgent") return baseLevel;
  return Math.min(3, baseLevel + 1) as InboxSlaEscalationLevel;
}

export function inboxSlaEscalationLabel(
  level: InboxSlaEscalationLevel,
) {
  if (level === 3) return "Critical escalation";
  if (level === 2) return "Manager escalation";
  if (level === 1) return "Owner follow-up";
  return "No escalation";
}
