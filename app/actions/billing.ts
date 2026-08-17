"use server";

import { z } from "zod";

import { createSupabaseServerClient } from "../../lib/supabase/server";

const billingSummarySchema = z.strictObject({ organizationId: z.uuid() });

export async function getCurrentAgencyBillingSummary(input: z.input<typeof billingSummarySchema>) {
  const parsed = billingSummarySchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_current_billing_summary", {
    target_organization_id: parsed.organizationId,
  });
  if (error) throw new Error(error.message);
  return data[0] ?? null;
}
