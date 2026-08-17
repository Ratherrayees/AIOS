export const INTEGRATION_PROVIDERS = [
  "resend",
  "custom_smtp",
  "stripe",
  "razorpay",
  "whatsapp_cloud",
  "openai",
  "anthropic",
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];
export type IntegrationCategory = "email" | "payment" | "whatsapp" | "ai";
export type IntegrationConnectionStatus =
  | "not_tested"
  | "connected"
  | "failed";
export type IntegrationRuntimeAvailability = "available" | "configuration_only";

export type IntegrationConfigValue = string | number | boolean;
export type IntegrationPublicConfig = Record<string, IntegrationConfigValue>;
export type IntegrationSecrets = Record<string, string>;

export type IntegrationSummary = {
  id: string;
  provider: IntegrationProvider;
  category: IntegrationCategory;
  isEnabled: boolean;
  publicConfig: IntegrationPublicConfig;
  credentialHint: string;
  connectionStatus: IntegrationConnectionStatus;
  lastTestedAt: string | null;
  lastTestMessage: string | null;
  updatedAt: string;
};

export const INTEGRATION_CATALOG: Record<
  IntegrationProvider,
  {
    category: IntegrationCategory;
    label: string;
    description: string;
    capability: string;
    runtimeAvailability: IntegrationRuntimeAvailability;
    availabilityNote: string;
  }
> = {
  resend: {
    category: "email",
    label: "Resend",
    description: "Send and receive agency email through a verified Resend domain.",
    capability: "Inbound and outbound email",
    runtimeAvailability: "available",
    availabilityNote: "Available for governed transactional email.",
  },
  custom_smtp: {
    category: "email",
    label: "Custom email server",
    description: "Use agency-owned SMTP for sending and IMAP for receiving.",
    capability: "SMTP outbound and IMAP inbound",
    runtimeAvailability: "available",
    availabilityNote: "Available for governed transactional email.",
  },
  stripe: {
    category: "payment",
    label: "Stripe",
    description: "Store and verify a Stripe account before live payment support is released.",
    capability: "Online payments",
    runtimeAvailability: "configuration_only",
    availabilityNote: "Credentials can be verified now; live payment execution is not released.",
  },
  razorpay: {
    category: "payment",
    label: "Razorpay",
    description: "Store and verify a Razorpay account before live payment support is released.",
    capability: "Online payments",
    runtimeAvailability: "configuration_only",
    availabilityNote: "Credentials can be verified now; live payment execution is not released.",
  },
  whatsapp_cloud: {
    category: "whatsapp",
    label: "WhatsApp Business",
    description: "Store and verify Meta account details before live messaging is released.",
    capability: "Customer messaging",
    runtimeAvailability: "configuration_only",
    availabilityNote: "Credentials can be verified now; live messaging is not released.",
  },
  openai: {
    category: "ai",
    label: "OpenAI",
    description: "Run governed AIOS work with the agency's OpenAI account.",
    capability: "AIOS model provider",
    runtimeAvailability: "available",
    availabilityNote: "Available for governed AIOS model routing.",
  },
  anthropic: {
    category: "ai",
    label: "Claude",
    description: "Run governed AIOS work with the agency's Anthropic account.",
    capability: "AIOS model provider",
    runtimeAvailability: "available",
    availabilityNote: "Available for governed AIOS model routing.",
  },
};

export function integrationCategoryFor(provider: IntegrationProvider) {
  return INTEGRATION_CATALOG[provider].category;
}

export function isIntegrationRuntimeReady(provider: IntegrationProvider) {
  return INTEGRATION_CATALOG[provider].runtimeAvailability === "available";
}
