import { NextResponse, type NextRequest } from "next/server";
import { safeInternalPath } from "../../../lib/auth/safe-next";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { hasSupabaseEnv } from "../../../lib/env";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  const destination = safeInternalPath(next);

  if (!hasSupabaseEnv()) return NextResponse.redirect(new URL("/sign-in?error=configuration", origin));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destination, origin));
  }

  return NextResponse.redirect(new URL("/sign-in?error=callback", origin));
}
