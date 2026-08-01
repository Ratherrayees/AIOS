import { z } from "zod";

export const conversationNextStepActionSchema = z.enum([
  "collect_missing_information",
  "create_internal_task",
  "escalate_to_human",
  "review_itinerary",
  "review_quote",
  "send_reply_after_review",
  "wait_for_customer",
]);

export const conversationCopilotDraftSchema = z.object({
  summary: z.string().trim().min(1).max(1_200),
  suggestedNextSteps: z
    .array(
      z.object({
        action: conversationNextStepActionSchema,
        rationale: z.string().trim().min(1).max(320),
      }),
    )
    .min(1)
    .max(5),
  replySubject: z.string().trim().max(300).nullable(),
  replyBody: z.string().trim().min(1).max(6_000),
  missingInformation: z
    .array(z.string().trim().min(1).max(240))
    .max(12),
  confidence: z.number().min(0).max(1),
});

export type ConversationCopilotDraft = z.infer<
  typeof conversationCopilotDraftSchema
>;

export function parseConversationCopilotDraft(input: unknown) {
  return conversationCopilotDraftSchema.parse(input);
}
