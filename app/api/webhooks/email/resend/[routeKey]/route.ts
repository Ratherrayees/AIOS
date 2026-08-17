import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";

import {
  ingestInboundEmail,
  parseMailboxAddress,
  plainTextFromEmail,
} from "../../../../../../lib/email/inbound";
import { loadTenantResendInboundRoute } from "../../../../../../lib/integrations/tenant-config";

export const runtime = "nodejs";

const routeKeySchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const receivedEventSchema = z.object({
  type: z.literal("email.received"),
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({
    email_id: z.uuid(),
    created_at: z.iso.datetime({ offset: true }),
    from: z.string().trim().min(3).max(640),
    to: z.array(z.email().max(320)).min(1).max(100),
    bcc: z.array(z.email().max(320)).max(100).default([]),
    cc: z.array(z.email().max(320)).max(100).default([]),
    received_for: z.array(z.email().max(320)).max(100).default([]),
    message_id: z.string().trim().min(1).max(998),
    subject: z.string().trim().max(500).default(""),
    attachments: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(256),
          filename: z.string().max(500).nullable(),
          content_type: z.string().trim().min(1).max(255),
          content_disposition: z.string().max(120).nullable(),
          content_id: z.string().max(998).nullable(),
        }),
      )
      .max(100)
      .default([]),
  }),
});

function invalidWebhook() {
  return NextResponse.json({ error: "invalid_webhook" }, { status: 400 });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/webhooks/email/resend/[routeKey]">,
) {
  const { routeKey: rawRouteKey } = await context.params;
  const routeKey = routeKeySchema.safeParse(rawRouteKey);
  if (!routeKey.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const integration = await loadTenantResendInboundRoute(routeKey.data);
  if (!integration?.secrets.webhookSecret || !integration.secrets.apiKey) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const eventId = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (
    !eventId ||
    eventId.length > 512 ||
    !timestamp ||
    timestamp.length > 128 ||
    !signature ||
    signature.length > 16_384 ||
    !Number.isFinite(contentLength) ||
    contentLength > 1_000_000
  ) {
    return invalidWebhook();
  }

  let event: z.infer<typeof receivedEventSchema>;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return invalidWebhook();
    const verifier = new Resend("webhook-verification");
    const verified = verifier.webhooks.verify({
      payload: rawBody,
      headers: { id: eventId, timestamp, signature },
      webhookSecret: integration.secrets.webhookSecret,
    });
    event = receivedEventSchema.parse(verified);
  } catch {
    return invalidWebhook();
  }

  const configuredAddress = String(integration.publicConfig.inboundAddress)
    .trim()
    .toLowerCase();
  const allRecipients = [...event.data.to, ...event.data.received_for].map((item) =>
    item.toLowerCase(),
  );
  if (!allRecipients.includes(configuredAddress)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const resend = new Resend(integration.secrets.apiKey);
  const { data: receivedEmail, error } = await resend.emails.receiving.get(
    event.data.email_id,
    { html_format: "cid" },
  );
  if (error || !receivedEmail) {
    return NextResponse.json(
      { error: "received_email_unavailable" },
      { status: 502 },
    );
  }

  try {
    const sender = parseMailboxAddress(receivedEmail.from || event.data.from);
    const ingested = await ingestInboundEmail({
      organizationId: integration.organizationId,
      provider: "resend",
      providerEventId: eventId,
      externalMessageId: receivedEmail.message_id || event.data.message_id,
      senderEmail: sender.email,
      senderName: sender.name,
      recipientEmail: configuredAddress,
      subject: receivedEmail.subject || event.data.subject,
      body: plainTextFromEmail(receivedEmail.text, receivedEmail.html),
      receivedAt: receivedEmail.created_at || event.data.created_at,
      payload: {
        resend_email_id: event.data.email_id,
        to: event.data.to,
        cc: event.data.cc,
        received_for: event.data.received_for,
      },
      metadata: {
        reply_to: receivedEmail.reply_to ?? [],
        attachment_count: receivedEmail.attachments.length,
        attachments: receivedEmail.attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          size: attachment.size,
          content_type: attachment.content_type,
          content_disposition: attachment.content_disposition,
        })),
      },
    });
    return NextResponse.json({
      received: true,
      duplicate: ingested.duplicate,
    });
  } catch {
    return NextResponse.json({ error: "email_ingestion_failed" }, { status: 500 });
  }
}
