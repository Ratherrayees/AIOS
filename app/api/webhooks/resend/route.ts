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

function webhookPersistenceFailed() {
  return NextResponse.json(
    { error: "webhook_persistence_failed" },
    { status: 500 },
  );
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

  let event: z.infer<typeof eventSchema>;
  let payload: Json;

  try {
    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return invalidWebhook();

    // Resend's SDK requires an API key at construction time even though webhook
    // verification is local and does not call its API. Keep inbound delivery
    // independent from outbound email configuration.
    const resend = new Resend("webhook-verification");
    const verified = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: eventId, timestamp, signature },
      webhookSecret: getResendWebhookEnv().RESEND_WEBHOOK_SECRET,
    });
    event = eventSchema.parse(verified);
    payload = JSON.parse(rawBody) as Json;
  } catch {
    return invalidWebhook();
  }

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
  if (error) return webhookPersistenceFailed();

  return NextResponse.json({ received: true });
}
