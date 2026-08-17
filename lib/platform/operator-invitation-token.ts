import "server-only";

import { createHash } from "node:crypto";

export const PLATFORM_OPERATOR_INVITATION_COOKIE = "aios.platform-invite";
export const PLATFORM_OPERATOR_INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const platformOperatorInvitationCookieOptions = {
  httpOnly: true,
  // Email links begin cross-site. Lax permits the top-level GET/303 exchange
  // while still withholding the bearer from cross-site unsafe requests.
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/auth/platform-invite",
  maxAge: 30 * 60,
  priority: "high" as const,
};

export function parsePlatformOperatorInvitationToken(value: unknown) {
  return typeof value === "string" && PLATFORM_OPERATOR_INVITATION_TOKEN_PATTERN.test(value)
    ? value
    : null;
}

export function hashPlatformOperatorInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
