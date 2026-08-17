import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getAiosProviderStatus,
  getAiosProviderStatusForOrganization,
} from "../../../../lib/ai/openai-provider";
import { requireActiveMembership } from "../../../../lib/authorization";
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
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  const parsedProvider = requestedProvider
    ? modelProviderSchema.safeParse(requestedProvider)
    : null;
  if (parsedProvider && !parsedProvider.success)
    return NextResponse.json(
      { error: "unknown_provider" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  let status;
  if (organizationId) {
    const parsedOrganizationId = z.uuid().safeParse(organizationId);
    if (!parsedOrganizationId.success || !parsedProvider?.success) {
      return NextResponse.json(
        { error: "invalid_tenant_provider_request" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      await requireActiveMembership(parsedOrganizationId.data);
    } catch {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    status = await getAiosProviderStatusForOrganization(
      parsedOrganizationId.data,
      parsedProvider.data,
    );
  } else {
    status = getAiosProviderStatus(parsedProvider?.data);
  }
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
