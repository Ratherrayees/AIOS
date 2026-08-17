import "server-only";

import { cookies } from "next/headers";

export const AUTHORITY_CONTEXT_COOKIE = "aios.authority-context";
export type AuthorityContext = "agency" | "platform";

export async function readPreferredAuthorityContext(): Promise<AuthorityContext | null> {
  const value = (await cookies()).get(AUTHORITY_CONTEXT_COOKIE)?.value;
  return value === "agency" || value === "platform" ? value : null;
}

export async function writePreferredAuthorityContext(value: AuthorityContext) {
  (await cookies()).set(AUTHORITY_CONTEXT_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 180 * 24 * 60 * 60,
  });
}
