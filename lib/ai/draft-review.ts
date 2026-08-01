import { z } from "zod";

export const conversationDraftReviewInputSchema = z
  .object({
    organizationId: z.uuid(),
    draftId: z.uuid(),
    decision: z.enum(["approved", "changes_requested", "rejected"]),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.decision !== "approved" &&
      (!value.note || value.note.length < 6)
    ) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: "Record at least six characters of useful feedback.",
      });
    }
    if (value.decision === "approved" && value.note) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: "Approval does not require a feedback note.",
      });
    }
  });

export type ConversationDraftReviewInput = z.infer<
  typeof conversationDraftReviewInputSchema
>;
