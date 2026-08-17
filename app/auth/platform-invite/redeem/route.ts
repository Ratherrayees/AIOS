import { NextResponse, type NextRequest } from "next/server";

import {
  PLATFORM_OPERATOR_INVITATION_COOKIE,
  hashPlatformOperatorInvitationToken,
  parsePlatformOperatorInvitationToken,
  platformOperatorInvitationCookieOptions,
} from "../../../../lib/platform/operator-invitation-token";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = parsePlatformOperatorInvitationToken(
    request.nextUrl.searchParams.get("token"),
  );
  const destination = new URL("/auth/platform-invite", request.url);
  let valid = false;

  if (token) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("platform_operator_invitations")
        .select("id")
        .eq("token_hash", hashPlatformOperatorInvitationToken(token))
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      valid = !error && Boolean(data);
    } catch {
      valid = false;
    }
  }

  if (!valid) destination.searchParams.set("error", "invalid");
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (valid && token) {
    response.cookies.set(
      PLATFORM_OPERATOR_INVITATION_COOKIE,
      token,
      platformOperatorInvitationCookieOptions,
    );
  } else {
    response.cookies.set(PLATFORM_OPERATOR_INVITATION_COOKIE, "", {
      ...platformOperatorInvitationCookieOptions,
      maxAge: 0,
    });
  }
  return response;
}
