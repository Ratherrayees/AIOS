"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "../../../components/ui/button";
import { FormField } from "../../../components/ui/form-field";
import {
  SIGNUP_OTP_LENGTH,
} from "../../../lib/auth/signup-verification-contract";
import {
  resendSignupOtp,
  restartSignupVerification,
  verifySignupOtp,
} from "./actions";

function VerifyButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending}>
      {pending ? "Verifying…" : "Verify email and continue"}
    </Button>
  );
}

function ResendButton({ seconds }: { seconds: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending || seconds > 0}>
      {pending
        ? "Sending…"
        : seconds > 0
          ? `Send another code in ${seconds}s`
          : "Send another code"}
    </Button>
  );
}

export function SignupOtpVerificationForm({
  initialResendSeconds,
}: {
  initialResendSeconds: number;
}) {
  const [token, setToken] = useState("");
  const [seconds, setSeconds] = useState(initialResendSeconds);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(
      () => setSeconds((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [seconds]);

  return (
    <>
      <form action={verifySignupOtp} className="auth-otp-form">
        <FormField label="Six-digit verification code">
          <input
            className="auth-otp-input"
            name="token"
            value={token}
            onChange={(event) =>
              setToken(
                event.target.value.replace(/\D/g, "").slice(0, SIGNUP_OTP_LENGTH),
              )
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={SIGNUP_OTP_LENGTH}
            maxLength={SIGNUP_OTP_LENGTH}
            placeholder="000000"
            aria-describedby="signup-otp-help"
            autoFocus
            required
          />
        </FormField>
        <p className="auth-field-hint" id="signup-otp-help">
          The code is single-use and expires after 10 minutes. You can paste it
          directly from your email.
        </p>
        <VerifyButton />
      </form>
      <div className="auth-otp-secondary">
        <form action={resendSignupOtp}>
          <ResendButton seconds={seconds} />
        </form>
        <form action={restartSignupVerification}>
          <Button type="submit" variant="ghost">
            Use a different email
          </Button>
        </form>
      </div>
    </>
  );
}
