import "server-only";

import { Resend } from "resend";
import { z } from "zod";

import { getResendEnv, hasResendEnv } from "../env";

const recipientSchema = z.string().trim().email().max(320);

const messageSchema = z.object({
  to: z.union([recipientSchema, z.array(recipientSchema).min(1).max(50)]),
  subject: z.string().trim().min(1).max(180).refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks."),
  html: z.string().min(1).max(500_000),
  text: z.string().min(1).max(500_000).optional(),
  replyTo: recipientSchema.optional(),
  tags: z.array(z.object({ name: z.string().trim().min(1).max(256), value: z.string().trim().min(1).max(256) })).max(5).optional(),
});

export type TransactionalEmail = z.input<typeof messageSchema>;

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

/** Server-only Resend adapter with bounded, validated message input. */
export async function sendTransactionalEmail(input: TransactionalEmail) {
  const message = messageSchema.parse(input);
  const env = getResendEnv();
  const resend = new Resend(env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    replyTo: message.replyTo ?? env.RESEND_REPLY_TO_EMAIL,
    tags: message.tags,
  });

  if (error || !data?.id) {
    throw new EmailDeliveryError(error?.message || "Resend did not return a delivery identifier.");
  }

  return { id: data.id };
}

export { hasResendEnv };
