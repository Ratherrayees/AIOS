import { z } from "zod";

const browserEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverEnvSchema = browserEnvSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type BrowserEnv = z.infer<typeof browserEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

const resendEnvSchema = z.object({
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().trim().min(3).max(320),
  RESEND_REPLY_TO_EMAIL: z.string().trim().email().optional(),
});

export type ResendEnv = z.infer<typeof resendEnvSchema>;

const resendWebhookEnvSchema = z.object({
  RESEND_WEBHOOK_SECRET: z.string().trim().regex(/^whsec_[A-Za-z0-9_-]+$/, "Invalid Resend webhook secret."),
});

export type ResendWebhookEnv = z.infer<typeof resendWebhookEnvSchema>;

export const MODEL_PROVIDERS = [
  "groq",
  "glm",
  "nvidia",
  "openrouter",
  "openai",
  "gemini",
  "anthropic",
  "qwen",
] as const;
export const modelProviderSchema = z.enum(MODEL_PROVIDERS);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export function parseModelProvider(
  value: unknown,
  fallback: ModelProvider = "groq",
) {
  const parsed = modelProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export function parseOptionalModelProvider(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = modelProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseModelProviders(
  value: unknown,
  fallback: readonly ModelProvider[] = MODEL_PROVIDERS,
) {
  if (!Array.isArray(value)) return [...fallback];
  const providers = value.flatMap((candidate) => {
    const parsed = modelProviderSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
  return providers.length ? [...new Set(providers)] : [...fallback];
}

const aiosModelEnvSchema = z.object({
  AIOS_MODEL_PROVIDER: modelProviderSchema.default("groq"),
  AIOS_MODEL_PROVIDER_PRIORITY: z.string().trim().optional(),
  GROQ_API_KEY: z.string().trim().min(1).optional(),
  GROQ_API_BASE: z.url().default("https://api.groq.com/openai/v1"),
  GROQ_MODEL: z.string().trim().min(1).max(120).default("llama-3.3-70b-versatile"),
  ZHIPU_API_KEY: z.string().trim().min(1).optional(),
  ZHIPU_API_BASE: z.url().default("https://open.bigmodel.cn/api/paas/v4"),
  ZHIPU_MODEL: z.string().trim().min(1).max(120).default("glm-4-flash"),
  NVIDIA_API_KEY: z.string().trim().min(1).optional(),
  NVIDIA_API_BASE: z.url().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_MODEL: z.string().trim().min(1).max(120).default("meta/llama-3.3-70b-instruct"),
  OPENROUTER_API_KEY: z.string().trim().min(1).optional(),
  OPENROUTER_API_BASE: z.url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().trim().min(1).max(120).default("openrouter/free"),
  AIOS_GLM_API_KEY: z.string().trim().min(1).optional(),
  AIOS_GLM_BASE_URL: z.url().optional(),
  AIOS_GLM_MODEL: z.string().trim().min(1).max(120).default("glm-4.7-flash"),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  AIOS_OPENAI_MODEL: z.string().trim().min(1).max(120).default("gpt-5.6-terra"),
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  AIOS_GEMINI_MODEL: z.string().trim().min(1).max(120).default("gemini-3.6-flash"),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  AIOS_ANTHROPIC_MODEL: z.string().trim().min(1).max(120).default("claude-sonnet-4-6"),
  QWEN_API_KEY: z.string().trim().min(1).optional(),
  AIOS_QWEN_BASE_URL: z.url().optional(),
  AIOS_QWEN_MODEL: z.string().trim().min(1).max(120).default("qwen-plus"),
});

export type AiosModelEnv = z.infer<typeof aiosModelEnvSchema>;

const aiosWorkerEnvSchema = z.object({
  AIOS_WORKER_SECRET: z.string().min(32).max(512),
});

const inboundEmailWorkerEnvSchema = z.object({
  EMAIL_INBOUND_WORKER_SECRET: z.string().min(32).max(512),
});

export type AiosWorkerEnv = z.infer<typeof aiosWorkerEnvSchema>;
export type InboundEmailWorkerEnv = z.infer<typeof inboundEmailWorkerEnvSchema>;

/** Allows local UI and static builds to run before deployment credentials exist. */
export function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Environment values are deliberately resolved only when an integration is
 * invoked. This keeps the application buildable before deployment credentials
 * are supplied, while failing closed when a protected server action runs.
 */
export function getBrowserEnv(): BrowserEnv {
  return browserEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
}

/** True only when the server has the credentials required to deliver mail. */
export function hasResendEnv() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

/** Mail credentials are server-only and are never exposed to client code. */
export function getResendEnv(): ResendEnv {
  return resendEnvSchema.parse({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    RESEND_REPLY_TO_EMAIL: process.env.RESEND_REPLY_TO_EMAIL || undefined,
  });
}

export function hasResendWebhookEnv() {
  return Boolean(process.env.RESEND_WEBHOOK_SECRET);
}

export function getResendWebhookEnv(): ResendWebhookEnv {
  return resendWebhookEnvSchema.parse({
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  });
}

/** Model credentials remain server-only. An absent key leaves AIOS fail-closed. */
export function getAiosModelEnv(): AiosModelEnv {
  return aiosModelEnvSchema.parse({
    AIOS_MODEL_PROVIDER: process.env.AIOS_MODEL_PROVIDER || "groq",
    AIOS_MODEL_PROVIDER_PRIORITY: process.env.AIOS_MODEL_PROVIDER_PRIORITY || undefined,
    GROQ_API_KEY: process.env.GROQ_API_KEY || undefined,
    GROQ_API_BASE: process.env.GROQ_API_BASE || undefined,
    GROQ_MODEL: process.env.GROQ_MODEL || undefined,
    ZHIPU_API_KEY: process.env.ZHIPU_API_KEY || undefined,
    ZHIPU_API_BASE: process.env.ZHIPU_API_BASE || undefined,
    ZHIPU_MODEL: process.env.ZHIPU_MODEL || undefined,
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || undefined,
    NVIDIA_API_BASE: process.env.NVIDIA_API_BASE || undefined,
    NVIDIA_MODEL: process.env.NVIDIA_MODEL || undefined,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || undefined,
    OPENROUTER_API_BASE: process.env.OPENROUTER_API_BASE || undefined,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || undefined,
    AIOS_GLM_API_KEY: process.env.AIOS_GLM_API_KEY || undefined,
    AIOS_GLM_BASE_URL: process.env.AIOS_GLM_BASE_URL || undefined,
    AIOS_GLM_MODEL: process.env.AIOS_GLM_MODEL || "glm-4.7-flash",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
    AIOS_OPENAI_MODEL: process.env.AIOS_OPENAI_MODEL || "gpt-5.6-terra",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
    AIOS_GEMINI_MODEL: process.env.AIOS_GEMINI_MODEL || "gemini-3.6-flash",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    AIOS_ANTHROPIC_MODEL: process.env.AIOS_ANTHROPIC_MODEL || "claude-sonnet-4-6",
    QWEN_API_KEY: process.env.QWEN_API_KEY || undefined,
    AIOS_QWEN_BASE_URL: process.env.AIOS_QWEN_BASE_URL || undefined,
    AIOS_QWEN_MODEL: process.env.AIOS_QWEN_MODEL || "qwen-plus",
  });
}

export function getAiosModelProviderPriority(): ModelProvider[] {
  const configured = process.env.AIOS_MODEL_PROVIDER_PRIORITY
    ?.split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  return parseModelProviders(configured, [
    "groq",
    "glm",
    "nvidia",
    "openrouter",
    "openai",
    "anthropic",
    "gemini",
    "qwen",
  ]);
}

export function hasAiosWorkerEnv() {
  return Boolean(process.env.AIOS_WORKER_SECRET);
}

/** Server-to-server credential for the bounded AIOS retry endpoint. */
export function getAiosWorkerEnv(): AiosWorkerEnv {
  return aiosWorkerEnvSchema.parse({
    AIOS_WORKER_SECRET: process.env.AIOS_WORKER_SECRET,
  });
}

export function hasInboundEmailWorkerEnv() {
  return Boolean(process.env.EMAIL_INBOUND_WORKER_SECRET);
}

/** Server-to-server credential for bounded tenant IMAP polling. */
export function getInboundEmailWorkerEnv(): InboundEmailWorkerEnv {
  return inboundEmailWorkerEnvSchema.parse({
    EMAIL_INBOUND_WORKER_SECRET: process.env.EMAIL_INBOUND_WORKER_SECRET,
  });
}
