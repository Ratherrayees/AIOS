import { z } from "zod";

import { modelProviderSchema } from "../env";

export const modelJobPayloadSchema = z.discriminatedUnion("workflow", [
  z
    .object({
      workflow: z.literal("lead_intake"),
      deal_id: z.uuid(),
      prompt_version: z.string().trim().min(3).max(120),
      provider: modelProviderSchema,
      fallback_provider: modelProviderSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      workflow: z.literal("itinerary_draft"),
      trip_id: z.uuid(),
      prompt_version: z.string().trim().min(3).max(120),
      provider: modelProviderSchema,
      fallback_provider: modelProviderSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      workflow: z.literal("knowledge_answer"),
      prompt_version: z.string().trim().min(3).max(120),
      provider: modelProviderSchema,
      fallback_provider: modelProviderSchema.nullable().optional(),
    })
    .strict(),
]);

export type ModelJobPayload = z.infer<typeof modelJobPayloadSchema>;
