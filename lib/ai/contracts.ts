import { z } from "zod";

export const agentCitationSchema = z.object({
  sourceType: z.enum(["message", "document", "contact", "deal", "trip", "knowledge"]),
  sourceId: z.string().uuid(),
  label: z.string().trim().min(1).max(300),
});

function hasDuplicateText(values: string[]) {
  return new Set(values.map((value) => value.trim().toLowerCase())).size !== values.length;
}

export const leadExtractionSchema = z
  .object({
    travellerName: z.string().trim().min(1).max(160).nullable(),
    destination: z.string().trim().min(1).max(160).nullable(),
    travelStart: z.iso.date().nullable(),
    travelEnd: z.iso.date().nullable(),
    travellerCount: z.int().min(1).max(500).nullable(),
    budget: z.string().trim().min(1).max(80).nullable(),
    preferences: z.array(z.string().trim().min(1).max(160)).max(20),
    missingInformation: z.array(z.string().trim().min(1).max(240)).max(20),
    confidence: z.number().min(0).max(1),
    citations: z.array(agentCitationSchema).max(30),
  })
  .superRefine((value, context) => {
    if (
      value.travelStart &&
      value.travelEnd &&
      value.travelEnd < value.travelStart
    )
      context.addIssue({
        code: "custom",
        path: ["travelEnd"],
        message: "Travel end date cannot be before the travel start date.",
      });
    if (hasDuplicateText(value.preferences))
      context.addIssue({
        code: "custom",
        path: ["preferences"],
        message: "Preferences must not repeat the same item.",
      });
    if (hasDuplicateText(value.missingInformation))
      context.addIssue({
        code: "custom",
        path: ["missingInformation"],
        message: "Missing-information items must not repeat.",
      });
  });

export type LeadExtraction = z.infer<typeof leadExtractionSchema>;

export const itineraryDraftSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_200),
    suggestedItems: z
      .array(
        z.object({
          dayNumber: z.int().min(1).max(365),
          itemType: z.enum(["flight", "stay", "transfer", "activity", "meal", "free_time", "note"]),
          title: z.string().trim().min(1).max(300),
          rationale: z.string().trim().min(1).max(600),
        }),
      )
      .min(1)
      .max(60),
    openQuestions: z.array(z.string().trim().min(1).max(240)).max(20),
    confidence: z.number().min(0).max(1),
    citations: z.array(agentCitationSchema).min(1).max(30),
  })
  .superRefine((value, context) => {
    const occupied = new Set<string>();
    value.suggestedItems.forEach((item, index) => {
      const key = `${item.dayNumber}:${item.itemType}:${item.title.toLowerCase()}`;
      if (occupied.has(key)) context.addIssue({ code: "custom", path: ["suggestedItems", index], message: "Suggested itinerary items must not repeat." });
      occupied.add(key);
    });
    if (hasDuplicateText(value.openQuestions)) context.addIssue({ code: "custom", path: ["openQuestions"], message: "Open questions must not repeat." });
  });

export type ItineraryDraft = z.infer<typeof itineraryDraftSchema>;

type ItineraryDraftContext = {
  startDate: string | null;
  endDate: string | null;
  items: Array<{ dayNumber: number; itemType: string; title: string }>;
};

export const aiToolCallSchema = z.object({
  toolName: z.string().min(1).max(120),
  action: z.string().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()),
});

/** Model outputs must be parsed through a schema before they affect CRM data. */
export function parseLeadExtraction(value: unknown): LeadExtraction {
  return leadExtractionSchema.parse(value);
}

/** All model itinerary drafts are parsed before a human can review them. */
export function parseItineraryDraft(value: unknown): ItineraryDraft {
  return itineraryDraftSchema.parse(value);
}

/** Reject suggestions that repeat the trip or fall outside its known duration. */
export function validateItineraryDraftForTrip(
  draft: ItineraryDraft,
  context: ItineraryDraftContext,
) {
  const existingItems = new Set(
    context.items.map(
      (item) =>
        `${item.dayNumber}:${item.itemType}:${item.title.trim().toLowerCase()}`,
    ),
  );
  if (
    draft.suggestedItems.some((item) =>
      existingItems.has(
        `${item.dayNumber}:${item.itemType}:${item.title.trim().toLowerCase()}`,
      ),
    )
  )
    throw new Error("The model repeated an existing itinerary item.");
  if (context.startDate && context.endDate) {
    const durationDays =
      Math.floor(
        (Date.parse(`${context.endDate}T00:00:00Z`) -
          Date.parse(`${context.startDate}T00:00:00Z`)) /
          86_400_000,
      ) + 1;
    if (draft.suggestedItems.some((item) => item.dayNumber > durationDays))
      throw new Error("The model proposed an item outside the trip duration.");
  }
  return draft;
}
