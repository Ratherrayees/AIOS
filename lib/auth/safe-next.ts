const INTERNAL_ORIGIN = "https://aios.local";

export function safeInternalPath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "/";

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return "/";
    // Platform invite bearers are captured into an HttpOnly cookie before any
    // authentication hop. Never propagate a raw or hash-shaped token through
    // sign-in, signup, OTP, or MFA return URLs.
    if (url.pathname.startsWith("/auth/platform-invite")) {
      return "/auth/platform-invite";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
