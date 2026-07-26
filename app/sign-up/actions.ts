"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getApplicationOrigin } from "../../lib/auth/application-origin";
import { safeInternalPath } from "../../lib/auth/safe-next";
import { hasSupabaseEnv } from "../../lib/env";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const signUpSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email(),
  password: z.string().min(12).max(200),
});

export async function signUp(formData: FormData) {
  const nextPath = safeInternalPath(formData.get("next"));
  if (!hasSupabaseEnv()) redirect("/sign-up?error=configuration");
  const retryParams = new URLSearchParams({ error: "validation" });
  if (nextPath !== "/") retryParams.set("next", nextPath);
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect(`/sign-up?${retryParams.toString()}`);

  const origin = await getApplicationOrigin();
  if (!origin) redirect("/sign-up?error=configuration");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
        nextPath === "/" ? "/onboarding" : nextPath,
      )}`,
    },
  });

  if (error) {
    const errorParams = new URLSearchParams({ error: "signup" });
    if (nextPath !== "/") errorParams.set("next", nextPath);
    redirect(`/sign-up?${errorParams.toString()}`);
  }
  const signInParams = new URLSearchParams({ message: "check-email" });
  if (nextPath !== "/") signInParams.set("next", nextPath);
  redirect(`/sign-in?${signInParams.toString()}`);
}
