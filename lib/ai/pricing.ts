import "server-only";

import type { ModelProvider } from "../env";
import { createSupabaseAdminClient } from "../supabase/admin";
import { calculateModelCostEstimate } from "./cost";

export async function estimateModelRunCost(input: {
  organizationId: string;
  provider: ModelProvider;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  occurredAt?: Date;
}) {
  if (input.inputTokens === null || input.outputTokens === null) return null;
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  const admin = createSupabaseAdminClient();
  const { data: price, error } = await admin
    .from("ai_model_prices")
    .select(
      "id, currency, input_price_per_million, output_price_per_million",
    )
    .eq("organization_id", input.organizationId)
    .eq("provider", input.provider)
    .eq("model", input.model)
    .lte("effective_from", occurredAt)
    .or(`effective_to.is.null,effective_to.gt.${occurredAt}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!price) return null;
  const amount = calculateModelCostEstimate({
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    inputPricePerMillion: price.input_price_per_million,
    outputPricePerMillion: price.output_price_per_million,
  });
  if (amount === null) return null;
  return {
    amount,
    currency: price.currency,
    modelPriceId: price.id,
  };
}
