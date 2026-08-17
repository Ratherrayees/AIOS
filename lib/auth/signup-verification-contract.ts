export const AUTH_EMAIL_ADDRESS = "auth@lumierah.in";
export const SIGNUP_OTP_LENGTH = 6;
export const SIGNUP_OTP_EXPIRY_SECONDS = 10 * 60;
export const SIGNUP_OTP_RESEND_SECONDS = 60;

type AuthProviderError = {
  code?: string | null;
  status?: number | null;
};

export type SignupOtpErrorKey = "invalid" | "rate-limit" | "resend";
export type SignupOtpOperation = "verify" | "resend";

const RATE_LIMIT_ERROR_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

export function normalizeSignupOtp(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

export function signupOtpResendSecondsRemaining(
  sentAtMs: number,
  nowMs = Date.now(),
) {
  if (!Number.isFinite(sentAtMs) || !Number.isFinite(nowMs)) {
    return SIGNUP_OTP_RESEND_SECONDS;
  }
  const remaining = Math.ceil(
    (sentAtMs + SIGNUP_OTP_RESEND_SECONDS * 1_000 - nowMs) / 1_000,
  );
  return Math.min(SIGNUP_OTP_RESEND_SECONDS, Math.max(0, remaining));
}

export function mapSignupOtpProviderError(
  error: AuthProviderError | null | undefined,
  operation: SignupOtpOperation,
): SignupOtpErrorKey {
  const code = error?.code?.toLowerCase();
  if (error?.status === 429 || (code && RATE_LIMIT_ERROR_CODES.has(code))) {
    return "rate-limit";
  }
  return operation === "verify" ? "invalid" : "resend";
}

export function maskEmailAddress(email: string) {
  const [localPart, domain, extra] = email.trim().split("@");
  if (!localPart || !domain || extra) return "your email address";
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}${"•".repeat(Math.max(3, localPart.length - visible.length))}@${domain}`;
}
