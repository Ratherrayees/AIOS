import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getBrowserEnv, hasSupabaseEnv } from "../env";
import type { Database } from "../../types/app-database";

/** Refreshes auth cookies when Supabase is configured. It intentionally becomes
 * a no-op during the pre-credential foundation phase. */
export async function updateSupabaseSession(request: NextRequest) {
  if (!hasSupabaseEnv()) return NextResponse.next({ request });

  const env = getBrowserEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const pathname = request.nextUrl.pathname;
  const isPublicRoute =
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/lead/") ||
    pathname.startsWith("/portal/") ||
    pathname.startsWith("/proposal/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/");
  const isAuthenticationFormRoute =
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/forgot-password" ||
    pathname === "/auth/verify-email";

  // Authentication forms do not need to refresh an existing session. This
  // also lets a stale or revoked refresh token recover cleanly at sign-in.
  if (isAuthenticationFormRoute) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  }

  const { data: claims } = await supabase.auth.getClaims();
  let passwordResetRequired = false;

  if (claims?.claims.sub) {
    const { data: securityControl, error: securityControlError } = await supabase
      .rpc("get_current_identity_security_control")
      .maybeSingle();
    const issuedAt = typeof claims.claims.iat === "number" ? claims.claims.iat * 1_000 : 0;
    const sessionsValidAfter = securityControl?.sessions_valid_after
      ? Date.parse(securityControl.sessions_valid_after)
      : Number.NaN;
    const accountSuspended = securityControl?.status === "suspended";
    passwordResetRequired = securityControl?.password_reset_required || false;
    const sessionRevoked =
      Number.isFinite(sessionsValidAfter) && issuedAt <= sessionsValidAfter;
    if (securityControlError || !securityControl || accountSuspended || sessionRevoked) {
      const signInUrl = new URL("/sign-in", request.url);
      signInUrl.searchParams.set(
        "error",
        accountSuspended ? "account-suspended" : "session-revoked",
      );
      const securityResponse = NextResponse.redirect(signInUrl);
      securityResponse.headers.set("Cache-Control", "private, no-store, max-age=0");
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith("sb-")) {
          securityResponse.cookies.set(cookie.name, "", { maxAge: 0, path: "/" });
        }
      }
      return securityResponse;
    }
  }

  if (!isPublicRoute && !claims?.claims.sub) {
    const signInUrl = new URL("/sign-in", request.url);
    if (pathname.startsWith("/platform")) {
      signInUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    }
    const redirectResponse = NextResponse.redirect(signInUrl);
    redirectResponse.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0",
    );
    return redirectResponse;
  }

  // Platform authority is both separate from agency membership and always
  // protected at AAL2. Enrolled operators complete the normal challenge;
  // operators without a factor are routed to a context-neutral enrollment
  // surface so the policy cannot dead-end first-time access.
  if (claims?.claims.sub && pathname.startsWith("/platform")) {
    const { data: platformAccess, error: platformAccessError } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", claims.claims.sub)
      .eq("status", "active")
      .maybeSingle();

    if (!platformAccessError && !platformAccess) {
      const deniedResponse = NextResponse.redirect(
        new URL("/access-denied/platform", request.url),
      );
      deniedResponse.headers.set("Cache-Control", "private, no-store, max-age=0");
      return deniedResponse;
    }

    if (
      !platformAccessError &&
      platformAccess &&
      claims.claims.aal !== "aal2"
    ) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const hasVerifiedTotp = Boolean(
        factors?.totp.some((factor) => factor.status === "verified"),
      );
      const nextPath = `${pathname}${request.nextUrl.search}`;
      const destination = hasVerifiedTotp ? "/auth/mfa" : "/account/security";
      const mfaUrl = new URL(destination, request.url);
      mfaUrl.searchParams.set("next", nextPath);
      if (!hasVerifiedTotp) mfaUrl.searchParams.set("reason", "platform-mfa");
      const mfaResponse = NextResponse.redirect(mfaUrl);
      mfaResponse.headers.set("Cache-Control", "private, no-store, max-age=0");
      return mfaResponse;
    }
  }

  const isMfaExemptRoute =
    pathname === "/auth/mfa" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/platform-invite/redeem" ||
    pathname.startsWith("/access-denied/") ||
    pathname.startsWith("/lead/") ||
    pathname.startsWith("/portal/") ||
    pathname.startsWith("/proposal/") ||
    pathname === "/api/health" ||
    pathname === "/api/webhooks/resend";
  if (claims?.claims.sub && !isMfaExemptRoute) {
    const { data: meetsMfaRequirement, error: mfaError } = await supabase.rpc(
      "meets_mfa_requirement",
    );
    if (mfaError || !meetsMfaRequirement) {
      const nextPath = `${pathname}${request.nextUrl.search}`;
      const challengeUrl = new URL("/auth/mfa", request.url);
      challengeUrl.searchParams.set("next", nextPath);
      const challengeResponse = NextResponse.redirect(challengeUrl);
      challengeResponse.headers.set(
        "Cache-Control",
        "private, no-store, max-age=0",
      );
      return challengeResponse;
    }
  }

  const isPasswordResetFlowRoute =
    pathname === "/update-password" ||
    pathname === "/auth/mfa" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/platform-invite/redeem";
  if (claims?.claims.sub && passwordResetRequired && !isPasswordResetFlowRoute) {
    const resetUrl = new URL("/update-password", request.url);
    resetUrl.searchParams.set("required", "1");
    if (pathname === "/auth/platform-invite") {
      resetUrl.searchParams.set("next", "/auth/platform-invite");
    }
    return NextResponse.redirect(resetUrl);
  }

  if (pathname === "/" && claims?.claims.sub) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", claims.claims.sub)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!membership) {
      const { data: platformAccess } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", claims.claims.sub)
        .eq("status", "active")
        .maybeSingle();
      return NextResponse.redirect(
        new URL(platformAccess ? "/platform" : "/onboarding", request.url),
      );
    }
  }

  if (!isPublicRoute) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  if (
    pathname.startsWith("/auth/invite") ||
    pathname.startsWith("/auth/platform-invite") ||
    pathname.startsWith("/auth/mfa") ||
    pathname.startsWith("/auth/verify-email")
  ) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  if (
    pathname.startsWith("/auth/invite") ||
    pathname.startsWith("/auth/platform-invite")
  ) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  if (
    pathname.startsWith("/lead/") ||
    pathname.startsWith("/portal/") ||
    pathname.startsWith("/proposal/")
  ) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
  }

  return response;
}
