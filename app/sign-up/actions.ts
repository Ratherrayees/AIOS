"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeInternalPath } from "../../lib/auth/safe-next";
import {
  clearPendingSignupVerification,
  writePendingSignupVerification,
} from "../../lib/auth/signup-verification";
import { hasSupabaseEnv } from "../../lib/env";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const signUpSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email(),
  password: z
    .string()
    .min(12)
    .max(200)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
});

export async function signUp(formData: FormData) {
  const nextPath = safeInternalPath(formData.get("next"));
  if (!hasSupabaseEnv()) redirect("/sign-up?error=configuration");
  await clearPendingSignupVerification();
  const retryParams = new URLSearchParams({ error: "validation" });
  if (nextPath !== "/") retryParams.set("next", nextPath);
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect(`/sign-up?${retryParams.toString()}`);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
    },
  });

  if (error) {
    const errorParams = new URLSearchParams({ error: "signup" });
    if (nextPath !== "/") errorParams.set("next", nextPath);
    redirect(`/sign-up?${errorParams.toString()}`);
  }

  // Confirmation must remain enabled in Supabase. If a deployment disables it,
  // fail closed instead of silently creating an authenticated, unverified flow.
  if (data.session) {
    await supabase.auth.signOut();
    const configurationParams = new URLSearchParams({
      error: "confirmation-disabled",
    });
    if (nextPath !== "/") configurationParams.set("next", nextPath);
    redirect(`/sign-up?${configurationParams.toString()}`);
  }

  await writePendingSignupVerification({
    email: parsed.data.email,
    nextPath: nextPath === "/" ? "/onboarding" : nextPath,
  });
  redirect("/auth/verify-email");
}
