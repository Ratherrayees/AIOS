import { type NextRequest, NextResponse } from "next/server";

import { getAiosProviderStatus } from "../../../../lib/ai/openai-provider";
import { modelProviderSchema } from "../../../../lib/env";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns operational AIOS metadata only; credentials are never included. */
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const requestedProvider = request.nextUrl.searchParams.get("provider");
  const parsedProvider = requestedProvider
    ? modelProviderSchema.safeParse(requestedProvider)
    : null;
  if (parsedProvider && !parsedProvider.success)
    return NextResponse.json(
      { error: "unknown_provider" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  const status = getAiosProviderStatus(parsedProvider?.data);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
