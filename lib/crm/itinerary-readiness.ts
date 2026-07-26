export type ItineraryReadiness = {
  score: number;
  status: "ready" | "needs_attention" | "not_ready";
  signals: string[];
};

/** Deterministic preflight for AIOS itinerary assistance; it never mutates data. */
export function assessItineraryReadiness(input: {
  startDate: string | null;
  endDate: string | null;
  items: Array<{ dayNumber: number; itemType: string }>;
}): ItineraryReadiness {
  const signals: string[] = [];
  if (!input.startDate || !input.endDate) signals.push("Travel dates are incomplete.");
  const expectedDays =
    input.startDate && input.endDate
      ? Math.floor((Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`)) / 86_400_000) + 1
      : null;
  const plannedDays = new Set(input.items.map((item) => item.dayNumber));
  if (input.items.length === 0) signals.push("No itinerary items have been planned.");
  if (expectedDays && plannedDays.size < expectedDays)
    signals.push(`${expectedDays - plannedDays.size} travel day(s) have no planned item.`);
  if (!input.items.some((item) => item.itemType === "stay"))
    signals.push("No accommodation or stay has been captured.");
  const score = Math.max(0, 100 - signals.length * 25);
  return { score, status: score >= 75 ? "ready" : score >= 40 ? "needs_attention" : "not_ready", signals };
}
