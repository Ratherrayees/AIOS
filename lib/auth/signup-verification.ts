import "server-only";

import { Buffer } from "node:buffer";
import { cookies } from "next/headers";
import { z } from "zod";

import { safeInternalPath } from "./safe-next";
import {
  SIGNUP_OTP_EXPIRY_SECONDS,
  type SignupOtpErrorKey,
  type SignupOtpOperation,
  AUTH_EMAIL_ADDRESS,
  mapSignupOtpProviderError,
  maskEmailAddress,
  normalizeSignupOtp,
  SIGNUP_OTP_LENGTH,
  SIGNUP_OTP_RESEND_SECONDS,
  signupOtpResendSecondsRemaining,
} from "./signup-verification-contract";

export {
  AUTH_EMAIL_ADDRESS,
  mapSignupOtpProviderError,
  maskEmailAddress,
  normalizeSignupOtp,
  SIGNUP_OTP_EXPIRY_SECONDS,
  SIGNUP_OTP_LENGTH,
  SIGNUP_OTP_RESEND_SECONDS,
  signupOtpResendSecondsRemaining,
};
export type { SignupOtpErrorKey, SignupOtpOperation };

const PENDING_SIGNUP_COOKIE = "aios.pending-signup";

const pendingSignupSchema = z.strictObject({
  email: z.email(),
  nextPath: z.string().max(2_048),
  sentAt: z.number().int().nonnegative(),
});

export type PendingSignupVerification = z.infer<typeof pendingSignupSchema>;
export type PendingSignupVerificationInput = Omit<
  PendingSignupVerification,
  "sentAt"
>;

function encodePendingSignup(value: PendingSignupVerification) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodePendingSignup(value: string | undefined) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const parsed = pendingSignupSchema.safeParse(decoded);
    if (!parsed.success) return null;
    return {
      email: parsed.data.email.trim().toLowerCase(),
      nextPath: safeInternalPath(parsed.data.nextPath),
      sentAt: parsed.data.sentAt,
    } satisfies PendingSignupVerification;
  } catch {
    return null;
  }
}

export async function writePendingSignupVerification(
  value: PendingSignupVerificationInput,
) {
  const pending = pendingSignupSchema.parse({
    email: value.email.trim().toLowerCase(),
    nextPath: safeInternalPath(value.nextPath),
    sentAt: Date.now(),
  });
  (await cookies()).set(PENDING_SIGNUP_COOKIE, encodePendingSignup(pending), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SIGNUP_OTP_EXPIRY_SECONDS,
    priority: "high",
  });
}

export async function readPendingSignupVerification() {
  return decodePendingSignup(
    (await cookies()).get(PENDING_SIGNUP_COOKIE)?.value,
  );
}

export async function clearPendingSignupVerification() {
  (await cookies()).set(PENDING_SIGNUP_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
