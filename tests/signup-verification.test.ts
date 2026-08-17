import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  AUTH_EMAIL_ADDRESS,
  mapSignupOtpProviderError,
  maskEmailAddress,
  normalizeSignupOtp,
  SIGNUP_OTP_EXPIRY_SECONDS,
  SIGNUP_OTP_LENGTH,
  SIGNUP_OTP_RESEND_SECONDS,
  signupOtpResendSecondsRemaining,
} from "../lib/auth/signup-verification-contract";

test("signup OTP policy matches the ten-minute, six-digit contract", () => {
  assert.equal(AUTH_EMAIL_ADDRESS, "auth@lumierah.in");
  assert.equal(SIGNUP_OTP_LENGTH, 6);
  assert.equal(SIGNUP_OTP_EXPIRY_SECONDS, 600);
  assert.equal(SIGNUP_OTP_RESEND_SECONDS, 60);
});

test("signup OTP normalization accepts only six ASCII digits", () => {
  assert.equal(normalizeSignupOtp("012345"), "012345");
  assert.equal(normalizeSignupOtp(" 123456 "), "123456");
  assert.equal(normalizeSignupOtp("12345"), null);
  assert.equal(normalizeSignupOtp("1234567"), null);
  assert.equal(normalizeSignupOtp("123 456"), null);
  assert.equal(normalizeSignupOtp("12345a"), null);
  assert.equal(normalizeSignupOtp(123456), null);
});

test("masked signup email discloses only a small local-part prefix", () => {
  assert.equal(maskEmailAddress("rayees@lumierah.in"), "ra••••@lumierah.in");
  assert.equal(maskEmailAddress("ra@lumierah.in"), "ra•••@lumierah.in");
  assert.equal(maskEmailAddress("r@lumierah.in"), "r•••@lumierah.in");
  assert.equal(maskEmailAddress("not-an-email"), "your email address");
  assert.equal(maskEmailAddress("a@b@example.com"), "your email address");
});

test("resend countdown is derived from the server-issued timestamp", () => {
  const sentAt = 1_000_000;
  assert.equal(signupOtpResendSecondsRemaining(sentAt, sentAt), 60);
  assert.equal(signupOtpResendSecondsRemaining(sentAt, sentAt + 30_001), 30);
  assert.equal(signupOtpResendSecondsRemaining(sentAt, sentAt + 60_000), 0);
  assert.equal(signupOtpResendSecondsRemaining(sentAt, sentAt - 10_000), 60);
  assert.equal(signupOtpResendSecondsRemaining(Number.NaN, sentAt), 60);
});

test("provider failures map to bounded, non-sensitive UI states", () => {
  assert.equal(
    mapSignupOtpProviderError({ code: "otp_expired", status: 403 }, "verify"),
    "invalid",
  );
  assert.equal(
    mapSignupOtpProviderError(
      { code: "over_email_send_rate_limit", status: 429 },
      "resend",
    ),
    "rate-limit",
  );
  assert.equal(
    mapSignupOtpProviderError({ code: "unexpected_provider_detail" }, "resend"),
    "resend",
  );
});

test("local Supabase signup email is code-only and uses the auth sender", () => {
  const config = readFileSync(resolve("supabase/config.toml"), "utf8");
  const template = readFileSync(
    resolve("supabase/templates/confirm-signup.html"),
    "utf8",
  );

  assert.match(config, /admin_email = "auth@lumierah\.in"/);
  assert.match(config, /otp_length = 6/);
  assert.match(config, /otp_expiry = 600/);
  assert.match(config, /max_frequency = "60s"/);
  assert.match(config, /content_path = "\.\/supabase\/templates\/confirm-signup\.html"/);
  assert.ok(template.includes("{{ .Token }}"));
  assert.ok(!template.includes("{{ .ConfirmationURL }}"));
  assert.ok(!template.includes("{{ .TokenHash }}"));
});
