import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  isPlausibleLeadCaptureTiming,
  leadDedupeKey,
  leadRequestFingerprint,
  publicLeadCaptureSchema,
} from "../../../../../lib/crm/lead-capture";
import { getServerEnv } from "../../../../../lib/env";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const runtime = "nodejs";

const tokenSchema = z.uuid();
const MAX_BODY_BYTES = 16_384;

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requesterAddress(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function referrerHost(request: NextRequest) {
  const referrer = request.headers.get("referer");
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.slice(0, 255);
  } catch {
    return null;
  }
}

function requestOriginIsAllowed(request: NextRequest, origin: string) {
  try {
    const candidate = new URL(origin);
    const forwardedProtocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      request.nextUrl.protocol.replace(":", "");
    const requestHost =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      request.headers.get("host");
    const allowedOrigins = new Set([request.nextUrl.origin]);
    if (requestHost)
      allowedOrigins.add(`${forwardedProtocol}://${requestHost}`);
    if (process.env.APP_BASE_URL)
      allowedOrigins.add(new URL(process.env.APP_BASE_URL).origin);
    return allowedOrigins.has(candidate.origin);
  } catch {
    return false;
  }
}

/** Public by design; validation, bot friction, throttling and writes stay server-side. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_BODY_BYTES
  )
    return response({ error: "invalid_submission" }, 400);

  const origin = request.headers.get("origin");
  if (origin && !requestOriginIsAllowed(request, origin))
    return response({ error: "origin_not_allowed" }, 403);

  try {
    const { token } = await context.params;
    const formToken = tokenSchema.parse(token);
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES)
      return response({ error: "invalid_submission" }, 400);
    const lead = publicLeadCaptureSchema.parse(JSON.parse(rawBody));
    if (
      lead.website ||
      !isPlausibleLeadCaptureTiming(lead.startedAt)
    )
      return response({ received: true }, 202);

    const serverEnv = getServerEnv();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .rpc("capture_public_lead", {
        target_form_token: formToken,
        target_full_name: lead.fullName,
        target_email: lead.email,
        target_phone: lead.phone,
        target_destination: lead.destination,
        target_budget_amount: lead.budgetAmount,
        target_currency: lead.currency,
        target_notes: lead.notes,
        target_communication_consent: lead.communicationConsent,
        target_utm_source: lead.utmSource,
        target_utm_medium: lead.utmMedium,
        target_utm_campaign: lead.utmCampaign,
        target_landing_path: lead.landingPath,
        target_referrer_host: referrerHost(request),
        target_dedupe_key: leadDedupeKey(formToken, lead),
        target_request_fingerprint: leadRequestFingerprint(
          serverEnv.SUPABASE_SECRET_KEY,
          requesterAddress(request),
        ),
      })
      .single();

    if (error?.code === "P0002")
      return response({ error: "form_unavailable" }, 404);
    if (error?.code === "P0001")
      return response({ error: "rate_limited" }, 429);
    if (error || !data)
      return response({ error: "capture_unavailable" }, 503);
    return response(
      { received: true, duplicate: data.duplicate },
      data.duplicate ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return response({ error: "invalid_submission" }, 400);
    return response({ error: "capture_unavailable" }, 503);
  }
}
