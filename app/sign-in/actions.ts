"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeInternalPath } from "../../lib/auth/safe-next";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { hasSupabaseEnv } from "../../lib/env";

const signInSchema = z.object({ email: z.email(), password: z.string().min(8).max(200) });

function signInFailurePath(error: string, nextPath: string) {
  const params = new URLSearchParams({ error });
  if (nextPath !== "/") params.set("next", nextPath);
  return `/sign-in?${params.toString()}`;
}

export async function signIn(formData: FormData) {
  const nextPath = safeInternalPath(formData.get("next"));
  if (!hasSupabaseEnv())
    redirect(signInFailurePath("configuration", nextPath));
  const result = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!result.success) redirect(signInFailurePath("validation", nextPath));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(result.data);
  if (error) redirect(signInFailurePath("credentials", nextPath));
  redirect(nextPath);
}
