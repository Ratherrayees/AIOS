import "server-only";

import { Resend } from "resend";
import nodemailer from "nodemailer";
import { z } from "zod";

import { getResendEnv, hasResendEnv } from "../env";
import {
  loadEnabledPlatformEmailIntegration,
  loadEnabledTenantIntegration,
} from "../integrations/tenant-config";
import { resolvePublicHostname } from "../integrations/network-safety";

const recipientSchema = z.string().trim().email().max(320);
const PLATFORM_TRANSACTIONAL_EMAIL_ADDRESS = "travel@lumierah.in";

function requirePlatformTransactionalSender(value: unknown) {
  if (typeof value !== "string") {
    throw new EmailDeliveryError("The platform sender identity is invalid.");
  }
  const trimmed = value.trim();
  const bracketedAddress = trimmed.match(/<([^<>]+)>$/)?.[1];
  const address = (bracketedAddress || trimmed).trim().toLowerCase();
  if (address !== PLATFORM_TRANSACTIONAL_EMAIL_ADDRESS) {
    throw new EmailDeliveryError(
      `Platform transactional email must use ${PLATFORM_TRANSACTIONAL_EMAIL_ADDRESS}.`,
    );
  }
  return address;
}

const messageSchema = z.object({
  organizationId: z.uuid().optional(),
  to: z.union([recipientSchema, z.array(recipientSchema).min(1).max(50)]),
  subject: z.string().trim().min(1).max(180).refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks."),
  html: z.string().min(1).max(500_000),
  text: z.string().min(1).max(500_000).optional(),
  replyTo: recipientSchema.optional(),
  tags: z.array(z.object({ name: z.string().trim().min(1).max(256), value: z.string().trim().min(1).max(256) })).max(5).optional(),
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
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
  if (message.organizationId) {
    const tenantResend = await loadEnabledTenantIntegration(
      message.organizationId,
      "resend",
    );
    if (tenantResend) {
      const resend = new Resend(tenantResend.secrets.apiKey);
      const fromName = String(tenantResend.publicConfig.fromName);
      const fromEmail = String(tenantResend.publicConfig.fromEmail);
      const { data, error } = await resend.emails.send(
        {
          from: `${fromName} <${fromEmail}>`,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          replyTo:
            message.replyTo ||
            String(tenantResend.publicConfig.replyTo || "") ||
            undefined,
          tags: message.tags,
        },
        message.idempotencyKey
          ? { idempotencyKey: message.idempotencyKey }
          : undefined,
      );
      if (error || !data?.id) {
        throw new EmailDeliveryError(
          error?.message || "Resend did not return a delivery identifier.",
        );
      }
      return { id: data.id, provider: "resend" as const };
    }

    const tenantSmtp = await loadEnabledTenantIntegration(
      message.organizationId,
      "custom_smtp",
    );
    if (tenantSmtp) {
      const security = String(tenantSmtp.publicConfig.security);
      const originalHost = String(tenantSmtp.publicConfig.host);
      const resolvedHost = await resolvePublicHostname(originalHost);
      const transport = nodemailer.createTransport({
        host: resolvedHost,
        port: Number(tenantSmtp.publicConfig.port),
        secure: security === "tls",
        requireTLS: security === "starttls",
        ignoreTLS: security === "none",
        auth: {
          user: String(tenantSmtp.publicConfig.username),
          pass: tenantSmtp.secrets.password,
        },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        tls: { servername: originalHost, rejectUnauthorized: true },
      });
      const delivery = await transport.sendMail({
        from: {
          name: String(tenantSmtp.publicConfig.fromName),
          address: String(tenantSmtp.publicConfig.fromEmail),
        },
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo:
          message.replyTo ||
          String(tenantSmtp.publicConfig.replyTo || "") ||
          undefined,
        messageId: message.idempotencyKey
          ? `<${message.idempotencyKey}@${String(tenantSmtp.publicConfig.fromEmail).split("@")[1]}>`
          : undefined,
      });
      transport.close();
      if (!delivery.messageId) {
        throw new EmailDeliveryError(
          "The SMTP relay did not return a delivery identifier.",
        );
      }
      return { id: delivery.messageId, provider: "custom_smtp" as const };
    }

    // Tenant communication must never silently fall back to platform-owned
    // credentials. Each agency controls its own sender identity, reputation,
    // data boundary, and delivery configuration.
    throw new EmailDeliveryError(
      "No enabled tenant email provider is configured for this agency.",
    );
  }

  const platformEmail = await loadEnabledPlatformEmailIntegration();
  if (platformEmail?.provider === "resend") {
    const fromName = String(platformEmail.publicConfig.fromName);
    const fromEmail = requirePlatformTransactionalSender(
      platformEmail.publicConfig.fromEmail,
    );
    const resend = new Resend(platformEmail.secrets.apiKey);
    const { data, error } = await resend.emails.send(
      {
        from: `${fromName} <${fromEmail}>`,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo:
          message.replyTo ||
          String(platformEmail.publicConfig.replyTo || "") ||
          undefined,
        tags: message.tags,
      },
      message.idempotencyKey
        ? { idempotencyKey: message.idempotencyKey }
        : undefined,
    );
    if (error || !data?.id) {
      throw new EmailDeliveryError(
        error?.message || "Resend did not return a delivery identifier.",
      );
    }
    return { id: data.id, provider: "resend" as const };
  }
  if (platformEmail?.provider === "custom_smtp") {
    const fromEmail = requirePlatformTransactionalSender(
      platformEmail.publicConfig.fromEmail,
    );
    const security = String(platformEmail.publicConfig.security);
    const originalHost = String(platformEmail.publicConfig.host);
    const resolvedHost = await resolvePublicHostname(originalHost);
    const transport = nodemailer.createTransport({
      host: resolvedHost,
      port: Number(platformEmail.publicConfig.port),
      secure: security === "tls",
      requireTLS: security === "starttls",
      ignoreTLS: security === "none",
      auth: {
        user: String(platformEmail.publicConfig.username),
        pass: platformEmail.secrets.password,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      tls: { servername: originalHost, rejectUnauthorized: true },
    });
    const delivery = await transport.sendMail({
      from: {
        name: String(platformEmail.publicConfig.fromName),
        address: fromEmail,
      },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo:
        message.replyTo ||
        String(platformEmail.publicConfig.replyTo || "") ||
        undefined,
      messageId: message.idempotencyKey
        ? `<${message.idempotencyKey}@${fromEmail.split("@")[1]}>`
        : undefined,
    });
    transport.close();
    if (!delivery.messageId) {
      throw new EmailDeliveryError(
        "The platform SMTP relay did not return a delivery identifier.",
      );
    }
    return { id: delivery.messageId, provider: "custom_smtp" as const };
  }

  if (!hasResendEnv()) {
    throw new EmailDeliveryError(
      "No enabled tenant email provider or deployment email provider is configured.",
    );
  }
  const env = getResendEnv();
  requirePlatformTransactionalSender(env.RESEND_FROM_EMAIL);
  const resend = new Resend(env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send(
    {
      from: env.RESEND_FROM_EMAIL,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo ?? env.RESEND_REPLY_TO_EMAIL,
      tags: message.tags,
    },
    message.idempotencyKey
      ? { idempotencyKey: message.idempotencyKey }
      : undefined,
  );

  if (error || !data?.id) {
    throw new EmailDeliveryError(error?.message || "Resend did not return a delivery identifier.");
  }

  return { id: data.id, provider: "resend" as const };
}

export { hasResendEnv };
