"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const passwordSchema = z.object({ password: z.string().min(12).max(200) });

export async function updatePassword(formData: FormData) {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/update-password?error=validation");
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) redirect("/sign-in?error=callback");
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) redirect("/update-password?error=update");
  redirect("/sign-in?message=password-updated");
}
