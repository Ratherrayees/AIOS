export type LeadHealthInput = { id: string; name: string; ownerId: string | null; nextStep: string | null; lastActivityAt: string | null; expectedCloseAt: string | null };

export function assessLeadHealth(lead: LeadHealthInput, now = new Date()) {
  const reasons: string[] = [];
  let score = 0;
  if (!lead.ownerId) { reasons.push("Unassigned"); score += 3; }
  if (!lead.nextStep) { reasons.push("No next step"); score += 2; }
  if (lead.expectedCloseAt && new Date(`${lead.expectedCloseAt}T23:59:59`).getTime() < now.getTime()) { reasons.push("Expected close date passed"); score += 2; }
  if (lead.lastActivityAt && now.getTime() - new Date(lead.lastActivityAt).getTime() > 72 * 60 * 60 * 1000) { reasons.push("No activity in 72h"); score += 2; }
  return { ...lead, reasons, score, severity: score >= 4 ? "critical" : score > 0 ? "watch" : "healthy" } as const;
}
