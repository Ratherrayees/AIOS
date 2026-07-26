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

  const { data: claims } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const isPublicRoute =
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/");

  if (!isPublicRoute && !claims?.claims.sub) {
    const redirectResponse = NextResponse.redirect(
      new URL("/sign-in", request.url),
    );
    redirectResponse.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0",
    );
    return redirectResponse;
  }

  const isMfaExemptRoute =
    pathname === "/auth/mfa" ||
    pathname === "/auth/callback" ||
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

  if (pathname === "/" && claims?.claims.sub) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", claims.claims.sub)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!membership)
      return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  if (!isPublicRoute) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  if (
    pathname.startsWith("/auth/invite") ||
    pathname.startsWith("/auth/mfa")
  ) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }

  return response;
}
