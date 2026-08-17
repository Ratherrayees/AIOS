import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const blockers = [];
const externalActions = [
  "Configure Supabase Auth SMTP and production redirect allow-lists.",
  "Verify lumierah.in for the platform sender travel@lumierah.in.",
  "Register each tenant Resend inbound webhook or schedule the IMAP worker.",
  "Schedule the protected AIOS, approval, Operations Radar, analytics, and inbound-email workers.",
  "Configure monitoring, backup/PITR, rollback, and alert ownership in the deployment platform.",
  "Rotate every credential previously shared in chat before production traffic.",
];

function requireValue(name) {
  if (!process.env[name]?.trim()) blockers.push(`${name} is required.`);
}

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
]) {
  requireValue(name);
}

const appBaseUrl = process.env.APP_BASE_URL?.trim();
if (!appBaseUrl) {
  blockers.push("APP_BASE_URL is required for production callbacks.");
} else {
  try {
    const url = new URL(appBaseUrl);
    if (
      url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      blockers.push("APP_BASE_URL must be one canonical HTTPS origin with no path, credentials, query, or fragment.");
    }
  } catch {
    blockers.push("APP_BASE_URL is not a valid URL.");
  }
}

const vaultValue = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY?.trim();
if (!vaultValue) {
  blockers.push("TENANT_INTEGRATION_ENCRYPTION_KEY is required for tenant and platform integration credentials.");
} else {
  const vaultKey = /^[0-9a-f]{64}$/i.test(vaultValue)
    ? Buffer.from(vaultValue, "hex")
    : Buffer.from(vaultValue, "base64url");
  if (vaultKey.length !== 32) {
    blockers.push("TENANT_INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
}

for (const name of ["AIOS_WORKER_SECRET", "EMAIL_INBOUND_WORKER_SECRET"]) {
  const value = process.env[name]?.trim();
  if (!value || value.length < 32 || value.length > 512) {
    blockers.push(`${name} must contain 32 to 512 characters.`);
  }
}

const modelKeys = [
  "GROQ_API_KEY",
  "ZHIPU_API_KEY",
  "NVIDIA_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "QWEN_API_KEY",
  "AIOS_GLM_API_KEY",
];
if (!modelKeys.some((name) => process.env[name]?.trim())) {
  blockers.push("At least one server-only AI model provider credential is required.");
}

if (process.env.PAYMENT_SANDBOX_ENABLED === "true") {
  blockers.push("PAYMENT_SANDBOX_ENABLED must not be true in production.");
}

const result = {
  ready: blockers.length === 0,
  blockers,
  externalActions,
};

console.log(JSON.stringify(result, null, 2));
if (blockers.length) process.exitCode = 1;
