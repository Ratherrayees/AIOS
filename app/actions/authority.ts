"use server";

import { z } from "zod";

import { writePreferredAuthorityContext } from "../../lib/auth/authority-context";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const authorityChoiceSchema = z.discriminatedUnion("authority", [
  z.strictObject({ authority: z.literal("platform") }),
  z.strictObject({ authority: z.literal("agency"), organizationId: z.uuid() }),
]);

export async function saveAuthorizedAuthorityContext(input: unknown) {
  const parsed = authorityChoiceSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims.sub) throw new Error("Sign in is required.");

  if (parsed.authority === "platform") {
    const { data, error } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", claims.claims.sub)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Active platform authority is required.");
  } else {
    const { data, error } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", claims.claims.sub)
      .eq("organization_id", parsed.organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Active agency membership is required.");
  }

  await writePreferredAuthorityContext(parsed.authority);
  return { success: true };
}
