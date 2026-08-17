"use server";

import { redirect } from "next/navigation";

import { resolvePostAuthDestination } from "../../../lib/auth/post-auth-destination";
import {
  clearPendingSignupVerification,
  mapSignupOtpProviderError,
  normalizeSignupOtp,
  readPendingSignupVerification,
  signupOtpResendSecondsRemaining,
  writePendingSignupVerification,
} from "../../../lib/auth/signup-verification";
import { hasSupabaseEnv } from "../../../lib/env";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

function verificationPath(key: "error" | "message", value: string) {
  const params = new URLSearchParams({ [key]: value });
  return `/auth/verify-email?${params.toString()}`;
}

export async function verifySignupOtp(formData: FormData) {
  if (!hasSupabaseEnv()) {
    redirect(verificationPath("error", "configuration"));
  }
  const pending = await readPendingSignupVerification();
  if (!pending) redirect(verificationPath("error", "session"));

  const token = normalizeSignupOtp(formData.get("token"));
  if (!token) redirect(verificationPath("error", "validation"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: pending.email,
    token,
    type: "signup",
  });
  if (error || !data.session || !data.user?.email_confirmed_at) {
    redirect(
      verificationPath(
        "error",
        mapSignupOtpProviderError(error, "verify"),
      ),
    );
  }

  await clearPendingSignupVerification();
  const destination = await resolvePostAuthDestination(
    supabase,
    pending.nextPath,
  );
  redirect(destination);
}

export async function resendSignupOtp() {
  if (!hasSupabaseEnv()) {
    redirect(verificationPath("error", "configuration"));
  }
  const pending = await readPendingSignupVerification();
  if (!pending) redirect(verificationPath("error", "session"));
  if (signupOtpResendSecondsRemaining(pending.sentAt) > 0) {
    redirect(verificationPath("error", "rate-limit"));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: pending.email,
  });
  if (error) {
    redirect(
      verificationPath(
        "error",
        mapSignupOtpProviderError(error, "resend"),
      ),
    );
  }
  await writePendingSignupVerification({
    email: pending.email,
    nextPath: pending.nextPath,
  });
  redirect(verificationPath("message", "resent"));
}

export async function restartSignupVerification() {
  const pending = await readPendingSignupVerification();
  await clearPendingSignupVerification();
  if (!pending || pending.nextPath === "/onboarding") redirect("/sign-up");
  const params = new URLSearchParams({ next: pending.nextPath });
  redirect(`/sign-up?${params.toString()}`);
}
