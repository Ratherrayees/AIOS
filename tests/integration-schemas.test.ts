import assert from "node:assert/strict";
import test from "node:test";

import {
  credentialHint,
  parseCompleteSecrets,
  parseIntegrationConfig,
  parseSecretUpdates,
} from "../lib/integrations/schemas";
import { providerFormPayload } from "../lib/integrations/form-payload";

test("tenant integration schemas retain only provider-specific public config", () => {
  assert.deepEqual(
    parseIntegrationConfig("resend", {
      fromName: "StateAI Travel",
      fromEmail: "hello@stateai.in",
      replyTo: "travel@stateai.in",
      inboundEnabled: false,
      inboundAddress: "",
      receivingDomain: "",
    }),
    {
      fromName: "StateAI Travel",
      fromEmail: "hello@stateai.in",
      replyTo: "travel@stateai.in",
      inboundEnabled: false,
      inboundAddress: "",
      receivingDomain: "",
    },
  );
  assert.throws(() =>
    parseIntegrationConfig("resend", {
      fromName: "StateAI Travel",
      fromEmail: "hello@stateai.in",
      replyTo: "",
      inboundEnabled: false,
      inboundAddress: "",
      receivingDomain: "",
      secretKey: "must-not-be-public",
    }),
  );
});

test("blank credential inputs mean keep the existing encrypted value", () => {
  assert.deepEqual(
    parseSecretUpdates("stripe", {
      secretKey: "",
      webhookSecret: "whsec_replacement",
    }),
    { webhookSecret: "whsec_replacement" },
  );
});

test("complete provider credentials enforce required fields", () => {
  assert.deepEqual(parseCompleteSecrets("openai", { apiKey: "sk-agency" }), {
    apiKey: "sk-agency",
  });
  assert.throws(() => parseCompleteSecrets("openai", {}));
  assert.throws(() =>
    parseCompleteSecrets("whatsapp_cloud", {
      accessToken: "token",
      verifyToken: "",
      appSecret: "",
    }),
  );
  assert.deepEqual(parseCompleteSecrets("resend", { apiKey: "re_agency" }), {
    apiKey: "re_agency",
    webhookSecret: "",
  });
});

test("credential hints reveal only a bounded suffix", () => {
  const apiKey = "tenant-api03-this-is-a-long-private-key";
  const hint = credentialHint("anthropic", { apiKey });
  assert.equal(hint, "••••-key");
  assert.equal(hint.includes(apiKey), false);
  assert.equal(
    credentialHint("custom_smtp", { password: "private" }),
    "Credentials saved",
  );
});

test("the redesigned editor preserves provider action payload names", () => {
  const resend = new FormData();
  resend.set("fromName", " StateAI Travel ");
  resend.set("fromEmail", "hello@stateai.in");
  resend.set("replyTo", "");
  resend.set("apiKey", " re_test ");
  resend.set("webhookSecret", "");
  assert.deepEqual(providerFormPayload("resend", resend), {
    publicConfig: {
      fromName: "StateAI Travel",
      fromEmail: "hello@stateai.in",
      replyTo: "",
      inboundEnabled: false,
      inboundAddress: "",
      receivingDomain: "",
    },
    secretUpdates: { apiKey: "re_test", webhookSecret: "" },
  });

  const smtp = new FormData();
  smtp.set("host", "smtp.stateai.in");
  smtp.set("port", "587");
  smtp.set("security", "starttls");
  smtp.set("username", "travel@stateai.in");
  smtp.set("fromName", "StateAI Travel");
  smtp.set("fromEmail", "travel@stateai.in");
  smtp.set("replyTo", "");
  smtp.set("password", "password");
  assert.deepEqual(providerFormPayload("custom_smtp", smtp), {
    publicConfig: {
      host: "smtp.stateai.in",
      port: 587,
      security: "starttls",
      username: "travel@stateai.in",
      fromName: "StateAI Travel",
      fromEmail: "travel@stateai.in",
      replyTo: "",
      inboundEnabled: false,
      inboundAddress: "",
      imapHost: "",
      imapPort: 993,
      imapSecurity: "tls",
      imapUsername: "",
      imapMailbox: "INBOX",
    },
    secretUpdates: { password: "password", imapPassword: "" },
  });

  const stripe = new FormData();
  stripe.set("environment", "test");
  stripe.set("publishableKey", "pk_test_public");
  stripe.set("secretKey", "sk_test_secret");
  stripe.set("webhookSecret", "whsec_test");
  assert.deepEqual(providerFormPayload("stripe", stripe), {
    publicConfig: { environment: "test", publishableKey: "pk_test_public" },
    secretUpdates: { secretKey: "sk_test_secret", webhookSecret: "whsec_test" },
  });

  const razorpay = new FormData();
  razorpay.set("environment", "test");
  razorpay.set("keyId", "rzp_test_public");
  razorpay.set("keySecret", "secret");
  razorpay.set("webhookSecret", "webhook");
  assert.deepEqual(providerFormPayload("razorpay", razorpay), {
    publicConfig: { environment: "test", keyId: "rzp_test_public" },
    secretUpdates: { keySecret: "secret", webhookSecret: "webhook" },
  });

  const whatsapp = new FormData();
  whatsapp.set("phoneNumberId", "123456789");
  whatsapp.set("businessAccountId", "987654321");
  whatsapp.set("graphApiVersion", "v25.0");
  whatsapp.set("displayPhone", "+91 90000 00000");
  whatsapp.set("accessToken", "access");
  whatsapp.set("verifyToken", "verify");
  whatsapp.set("appSecret", "app");
  assert.deepEqual(providerFormPayload("whatsapp_cloud", whatsapp), {
    publicConfig: {
      phoneNumberId: "123456789",
      businessAccountId: "987654321",
      graphApiVersion: "v25.0",
      displayPhone: "+91 90000 00000",
    },
    secretUpdates: {
      accessToken: "access",
      verifyToken: "verify",
      appSecret: "app",
    },
  });

  const openai = new FormData();
  openai.set("model", "model-id");
  openai.set("projectId", "project-id");
  openai.set("apiKey", "key");
  assert.deepEqual(providerFormPayload("openai", openai), {
    publicConfig: { model: "model-id", projectId: "project-id" },
    secretUpdates: { apiKey: "key" },
  });

  const anthropic = new FormData();
  anthropic.set("model", "claude-model");
  anthropic.set("apiKey", "key");
  assert.deepEqual(providerFormPayload("anthropic", anthropic), {
    publicConfig: { model: "claude-model" },
    secretUpdates: { apiKey: "key" },
  });
});

test("inbound email configuration requires a real tenant receiving path", () => {
  assert.deepEqual(
    parseIntegrationConfig("resend", {
      fromName: "Agency Travel",
      fromEmail: "hello@agency.example",
      replyTo: "",
      inboundEnabled: true,
      inboundAddress: "inbox@reply.agency.example",
      receivingDomain: "reply.agency.example",
    }),
    {
      fromName: "Agency Travel",
      fromEmail: "hello@agency.example",
      replyTo: "",
      inboundEnabled: true,
      inboundAddress: "inbox@reply.agency.example",
      receivingDomain: "reply.agency.example",
    },
  );
  assert.throws(() =>
    parseIntegrationConfig("resend", {
      fromName: "Agency Travel",
      fromEmail: "hello@agency.example",
      replyTo: "",
      inboundEnabled: true,
      inboundAddress: "inbox@another.example",
      receivingDomain: "reply.agency.example",
    }),
  );
});
