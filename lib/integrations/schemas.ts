import { z } from "zod";

import {
  INTEGRATION_PROVIDERS,
  type IntegrationProvider,
  type IntegrationPublicConfig,
  type IntegrationSecrets,
} from "./catalog";

const optionalEmail = z.union([z.literal(""), z.email().max(320)]);
const shortText = z.string().trim().max(180);
const secret = z.string().trim().min(1).max(2_000);
const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
    "Enter a valid public hostname.",
  );

const configSchemas = {
  resend: z
    .strictObject({
      fromName: z.string().trim().min(1).max(120),
      fromEmail: z.email().max(320),
      replyTo: optionalEmail,
      inboundEnabled: z.boolean(),
      inboundAddress: optionalEmail,
      receivingDomain: z.union([z.literal(""), hostname]),
    })
    .superRefine((config, context) => {
      if (!config.inboundEnabled) return;
      if (!config.inboundAddress) {
        context.addIssue({
          code: "custom",
          path: ["inboundAddress"],
          message: "Enter the address that should receive agency email.",
        });
      }
      if (!config.receivingDomain) {
        context.addIssue({
          code: "custom",
          path: ["receivingDomain"],
          message: "Enter the Resend receiving domain.",
        });
      }
      if (
        config.inboundAddress &&
        config.receivingDomain &&
        !config.inboundAddress
          .toLowerCase()
          .endsWith(`@${config.receivingDomain.toLowerCase()}`)
      ) {
        context.addIssue({
          code: "custom",
          path: ["inboundAddress"],
          message: "The inbound address must use the receiving domain.",
        });
      }
    }),
  custom_smtp: z
    .strictObject({
      host: hostname,
      port: z.coerce.number().int().min(1).max(65_535),
      security: z.enum(["tls", "starttls", "none"]),
      username: z.string().trim().min(1).max(320),
      fromName: z.string().trim().min(1).max(120),
      fromEmail: z.email().max(320),
      replyTo: optionalEmail,
      inboundEnabled: z.boolean(),
      inboundAddress: optionalEmail,
      imapHost: z.union([z.literal(""), hostname]),
      imapPort: z.coerce.number().int().min(1).max(65_535),
      imapSecurity: z.enum(["tls", "starttls"]),
      imapUsername: z.string().trim().max(320),
      imapMailbox: z.string().trim().min(1).max(255),
    })
    .superRefine((config, context) => {
      if (!config.inboundEnabled) return;
      for (const [path, value, message] of [
        ["inboundAddress", config.inboundAddress, "Enter the mailbox email address."],
        ["imapHost", config.imapHost, "Enter the IMAP host."],
        ["imapUsername", config.imapUsername, "Enter the IMAP username."],
      ] as const) {
        if (!value) {
          context.addIssue({ code: "custom", path: [path], message });
        }
      }
    }),
  stripe: z.strictObject({
    environment: z.enum(["test", "live"]),
    publishableKey: z
      .string()
      .trim()
      .regex(/^pk_(test|live)_[A-Za-z0-9]+$/, "Enter a valid Stripe publishable key.")
      .max(256),
  }),
  razorpay: z.strictObject({
    environment: z.enum(["test", "live"]),
    keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/).max(256),
  }),
  whatsapp_cloud: z.strictObject({
    phoneNumberId: z.string().trim().regex(/^\d{5,40}$/),
    businessAccountId: z.union([z.literal(""), z.string().trim().regex(/^\d{5,40}$/)]),
    graphApiVersion: z.string().trim().regex(/^v\d{1,2}\.\d{1,2}$/),
    displayPhone: shortText,
  }),
  openai: z.strictObject({
    model: z.string().trim().min(1).max(120),
    projectId: shortText,
  }),
  anthropic: z.strictObject({
    model: z.string().trim().min(1).max(120),
  }),
} satisfies Record<IntegrationProvider, z.ZodType>;

const secretSchemas = {
  resend: z.strictObject({
    apiKey: secret.refine((value) => value.startsWith("re_"), "Enter a Resend API key."),
    webhookSecret: z
      .string()
      .trim()
      .max(2_000)
      .refine(
        (value) => !value || value.startsWith("whsec_"),
        "Enter a valid Resend webhook secret.",
      )
      .default(""),
  }),
  custom_smtp: z.strictObject({
    password: secret,
    imapPassword: z.string().trim().max(2_000).default(""),
  }),
  stripe: z.strictObject({
    secretKey: secret.refine(
      (value) => /^sk_(test|live)_/.test(value),
      "Enter a Stripe secret key.",
    ),
    webhookSecret: z
      .string()
      .trim()
      .max(2_000)
      .refine(
        (value) => !value || value.startsWith("whsec_"),
        "Enter a valid Stripe webhook secret.",
      )
      .default(""),
  }),
  razorpay: z.strictObject({
    keySecret: secret,
    webhookSecret: z.string().trim().max(2_000).default(""),
  }),
  whatsapp_cloud: z.strictObject({
    accessToken: secret,
    verifyToken: secret,
    appSecret: z.string().trim().max(2_000).default(""),
  }),
  openai: z.strictObject({ apiKey: secret }),
  anthropic: z.strictObject({ apiKey: secret }),
} satisfies Record<IntegrationProvider, z.ZodType>;

export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);

export const integrationMutationSchema = z.strictObject({
  organizationId: z.uuid(),
  provider: integrationProviderSchema,
  isEnabled: z.boolean(),
  publicConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  secretUpdates: z.record(z.string(), z.string().max(2_000)),
});

export const integrationReferenceSchema = z.strictObject({
  organizationId: z.uuid(),
  provider: integrationProviderSchema,
});

export function parseIntegrationConfig(
  provider: IntegrationProvider,
  input: IntegrationPublicConfig,
) {
  return configSchemas[provider].parse(input) as IntegrationPublicConfig;
}

export function parseSecretUpdates(
  provider: IntegrationProvider,
  input: IntegrationSecrets,
) {
  const nonEmptyEntries = Object.entries(input).filter(
    ([, value]) => value.trim().length > 0,
  );
  return secretSchemas[provider].partial().parse(
    Object.fromEntries(nonEmptyEntries),
  ) as IntegrationSecrets;
}

export function parseCompleteSecrets(
  provider: IntegrationProvider,
  input: IntegrationSecrets,
) {
  return secretSchemas[provider].parse(input) as IntegrationSecrets;
}

export function credentialHint(
  provider: IntegrationProvider,
  secrets: IntegrationSecrets,
) {
  if (provider === "custom_smtp") return "Credentials saved";
  const primaryKey =
    provider === "resend"
      ? secrets.apiKey
      : provider === "stripe"
        ? secrets.secretKey
        : provider === "razorpay"
          ? secrets.keySecret
          : provider === "whatsapp_cloud"
            ? secrets.accessToken
            : secrets.apiKey;
  return `••••${primaryKey.slice(-4)}`;
}
