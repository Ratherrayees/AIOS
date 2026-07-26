"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getApplicationOrigin } from "../../lib/auth/application-origin";
import { hasSupabaseEnv } from "../../lib/env";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const emailSchema = z.object({ email: z.email() });

export async function requestPasswordReset(formData: FormData) {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success || !hasSupabaseEnv()) redirect("/forgot-password?sent=1");
  const origin = await getApplicationOrigin();
  if (!origin) redirect("/forgot-password?sent=1");
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/update-password`,
  });
  redirect("/forgot-password?sent=1");
}
