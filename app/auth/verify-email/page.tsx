import type { Metadata } from "next";
import Link from "next/link";

import { FormFeedback } from "../../../components/ui/form-field";
import {
  readPendingSignupVerification,
} from "../../../lib/auth/signup-verification";
import {
  AUTH_EMAIL_ADDRESS,
  maskEmailAddress,
  signupOtpResendSecondsRemaining,
} from "../../../lib/auth/signup-verification-contract";
import { SignupOtpVerificationForm } from "./otp-verification-form";

export const metadata: Metadata = {
  title: "Verify your email — AIOS",
  description: "Complete AIOS account verification with a single-use code.",
};

const errors: Record<string, string> = {
  configuration:
    "Email verification is temporarily unavailable. Please try again later.",
  invalid:
    "That code is incorrect or expired. Check the code or request a new one.",
  "rate-limit":
    "Too many verification attempts were made. Wait a moment before trying again.",
  resend:
    "Another code could not be sent yet. Wait a moment before trying again.",
  session:
    "This verification session has expired. Start account creation again.",
  validation: "Enter the complete six-digit verification code.",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const [pending, params] = await Promise.all([
    readPendingSignupVerification(),
    searchParams,
  ]);
  const error = params.error
    ? (errors[params.error] ?? "Email verification could not be completed.")
    : null;

  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card auth-otp-card">
        <Link href="/" className="auth-brand">
          <span>A</span> AIOS
        </Link>
        <p className="eyebrow">VERIFY YOUR EMAIL</p>
        <h1>{pending ? "Enter your verification code." : "Verification session expired."}</h1>
        {pending ? (
          <p>
            We sent a six-digit code to <strong>{maskEmailAddress(pending.email)}</strong>.
            Keep this tab open while you check your inbox.
          </p>
        ) : (
          <p>
            For your security, verification details are kept only for a short
            time in the browser where signup started.
          </p>
        )}
        {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
        {pending && params.message === "resent" ? (
          <FormFeedback tone="success">
            A new verification code is on its way.
          </FormFeedback>
        ) : null}
        {pending ? (
          <SignupOtpVerificationForm
            initialResendSeconds={signupOtpResendSecondsRemaining(
              pending.sentAt,
            )}
          />
        ) : (
          <Link className="auth-primary-link" href="/sign-up">
            Start account creation again
          </Link>
        )}
        <div className="auth-otp-trust" role="note">
          <span aria-hidden="true">✓</span>
          <p>
            <strong>AIOS authentication sender</strong>
            <small>{AUTH_EMAIL_ADDRESS} · Never share this code with anyone.</small>
          </p>
        </div>
      </section>
    </main>
  );
}
