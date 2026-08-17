"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeInternalPath } from "../../lib/auth/safe-next";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const passwordSchema = z.object({
  password: z
    .string()
    .min(12)
    .max(200)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
});

export async function updatePassword(formData: FormData) {
  const nextPath = safeInternalPath(formData.get("next"));
  const required = formData.get("required") === "1";
  const retryPath = (error: string) => {
    const params = new URLSearchParams({ error });
    if (required) params.set("required", "1");
    if (nextPath !== "/") params.set("next", nextPath);
    return `/update-password?${params.toString()}`;
  };
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) redirect(retryPath("validation"));
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    const params = new URLSearchParams({ error: "callback" });
    if (nextPath !== "/") params.set("next", nextPath);
    redirect(`/sign-in?${params.toString()}`);
  }
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) redirect(retryPath("update"));
  const admin = createSupabaseAdminClient();
  const { error: completionError } = await admin.rpc(
    "complete_required_password_reset_service",
    { target_user_id: userData.user.id },
  );
  if (completionError) redirect(retryPath("update"));
  const signInParams = new URLSearchParams({ message: "password-updated" });
  if (nextPath !== "/") signInParams.set("next", nextPath);
  redirect(`/sign-in?${signInParams.toString()}`);
}
