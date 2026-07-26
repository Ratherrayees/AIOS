import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";

import { getResendWebhookEnv, hasResendWebhookEnv } from "../../../../lib/env";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import type { Json } from "../../../../types/database";

export const runtime = "nodejs";

const eventSchema = z.object({
  type: z.string().trim().min(1).max(128),
  created_at: z.string().datetime({ offset: true }),
}).passthrough();

function invalidWebhook() {
  return NextResponse.json({ error: "invalid_webhook" }, { status: 400 });
}

/**
 * Public by design: Resend authenticates each request with Svix headers. The
 * raw body is verified before it is parsed or written to the database.
 */
export async function POST(request: NextRequest) {
  if (!hasResendWebhookEnv()) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const eventId = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  const contentLength = Number(request.headers.get("content-length") || "0");

  if (
    !eventId || eventId.length > 256 ||
    !timestamp || timestamp.length > 128 ||
    !signature || signature.length > 16_384 ||
    !Number.isFinite(contentLength) || contentLength > 1_000_000
  ) {
    return invalidWebhook();
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return invalidWebhook();

    const resend = new Resend();
    const verified = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: eventId, timestamp, signature },
      webhookSecret: getResendWebhookEnv().RESEND_WEBHOOK_SECRET,
    });
    const event = eventSchema.parse(verified);
    const payload = JSON.parse(rawBody) as Json;

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("email_webhook_events").insert({
      provider_event_id: eventId,
      event_type: event.type,
      event_created_at: event.created_at,
      payload,
    });

    if (error?.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (error) throw error;

    return NextResponse.json({ received: true });
  } catch {
    return invalidWebhook();
  }
}
