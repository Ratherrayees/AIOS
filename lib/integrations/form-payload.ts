import type { IntegrationProvider } from "./catalog";

export function providerFormPayload(provider: IntegrationProvider, form: FormData) {
  const read = (key: string) => String(form.get(key) || "").trim();
  const checked = (key: string) => form.get(key) === "on";
  if (provider === "resend") {
    return {
      publicConfig: {
        fromName: read("fromName"),
        fromEmail: read("fromEmail"),
        replyTo: read("replyTo"),
        inboundEnabled: checked("inboundEnabled"),
        inboundAddress: read("inboundAddress"),
        receivingDomain: read("receivingDomain"),
      },
      secretUpdates: { apiKey: read("apiKey"), webhookSecret: read("webhookSecret") },
    };
  }
  if (provider === "custom_smtp") {
    return {
      publicConfig: {
        host: read("host"),
        port: Number(read("port")),
        security: read("security"),
        username: read("username"),
        fromName: read("fromName"),
        fromEmail: read("fromEmail"),
        replyTo: read("replyTo"),
        inboundEnabled: checked("inboundEnabled"),
        inboundAddress: read("inboundAddress"),
        imapHost: read("imapHost"),
        imapPort: Number(read("imapPort") || "993"),
        imapSecurity: read("imapSecurity") || "tls",
        imapUsername: read("imapUsername"),
        imapMailbox: read("imapMailbox") || "INBOX",
      },
      secretUpdates: {
        password: read("password"),
        imapPassword: read("imapPassword"),
      },
    };
  }
  if (provider === "stripe") {
    return {
      publicConfig: { environment: read("environment"), publishableKey: read("publishableKey") },
      secretUpdates: { secretKey: read("secretKey"), webhookSecret: read("webhookSecret") },
    };
  }
  if (provider === "razorpay") {
    return {
      publicConfig: { environment: read("environment"), keyId: read("keyId") },
      secretUpdates: { keySecret: read("keySecret"), webhookSecret: read("webhookSecret") },
    };
  }
  if (provider === "whatsapp_cloud") {
    return {
      publicConfig: { phoneNumberId: read("phoneNumberId"), businessAccountId: read("businessAccountId"), graphApiVersion: read("graphApiVersion"), displayPhone: read("displayPhone") },
      secretUpdates: { accessToken: read("accessToken"), verifyToken: read("verifyToken"), appSecret: read("appSecret") },
    };
  }
  if (provider === "openai") {
    return {
      publicConfig: { model: read("model"), projectId: read("projectId") },
      secretUpdates: { apiKey: read("apiKey") },
    };
  }
  return {
    publicConfig: { model: read("model") },
    secretUpdates: { apiKey: read("apiKey") },
  };
}
