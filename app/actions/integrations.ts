"use server";

import { randomBytes } from "node:crypto";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

import { recordAuditEvent } from "../../lib/audit";
import { requireOrganizationRole } from "../../lib/authorization";
import {
  INTEGRATION_CATALOG,
  type IntegrationConnectionStatus,
  type IntegrationProvider,
  type IntegrationPublicConfig,
  type IntegrationSecrets,
  type IntegrationSummary,
  integrationCategoryFor,
  isIntegrationRuntimeReady,
} from "../../lib/integrations/catalog";
import {
  assertIntegrationActivationAvailable,
  enabledAfterConnectionTest,
  resolveIntegrationSaveActivation,
} from "../../lib/integrations/activation";
import {
  credentialHint,
  integrationMutationSchema,
  integrationReferenceSchema,
  parseCompleteSecrets,
  parseIntegrationConfig,
  parseSecretUpdates,
} from "../../lib/integrations/schemas";
import {
  decryptIntegrationSecrets,
  encryptIntegrationSecrets,
  isIntegrationVaultConfigured,
} from "../../lib/integrations/vault";
import { resolvePublicHostname } from "../../lib/integrations/network-safety";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const MANAGER_ROLES = ["owner", "admin"] as const;
const CONNECTION_TIMEOUT_MS = 15_000;

type IntegrationRow = {
  id: string;
  provider: string;
  category: string;
  is_enabled: boolean;
  public_config: unknown;
  credential_hint: string;
  connection_status: string;
  last_tested_at: string | null;
  last_test_message: string | null;
  updated_at: string;
};

function toSummary(row: IntegrationRow): IntegrationSummary {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    category: row.category as IntegrationSummary["category"],
    isEnabled: row.is_enabled,
    publicConfig: row.public_config as IntegrationPublicConfig,
    credentialHint: row.credential_hint,
    connectionStatus:
      row.connection_status as IntegrationConnectionStatus,
    lastTestedAt: row.last_tested_at,
    lastTestMessage: row.last_test_message,
    updatedAt: row.updated_at,
  };
}

async function currentUserId() {
  const supabase = await createSupabaseServerClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (error || !userId) throw new Error("Sign in is required.");
  return userId;
}

function assertMatchingEnvironment(
  provider: IntegrationProvider,
  config: IntegrationPublicConfig,
  secrets: IntegrationSecrets,
) {
  if (provider === "stripe") {
    const environment = String(config.environment);
    if (
      !String(config.publishableKey).startsWith(`pk_${environment}_`) ||
      !secrets.secretKey.startsWith(`sk_${environment}_`)
    ) {
      throw new Error("Stripe publishable and secret keys must use the selected environment.");
    }
  }
  if (
    provider === "razorpay" &&
    !String(config.keyId).startsWith(`rzp_${String(config.environment)}_`)
  ) {
    throw new Error("The Razorpay key must use the selected environment.");
  }
}

export async function listOrganizationIntegrations(input: {
  organizationId: string;
}) {
  const reference = integrationReferenceSchema.pick({ organizationId: true }).parse(input);
  await requireOrganizationRole(reference.organizationId, MANAGER_ROLES);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("organization_integrations")
    .select(
      "id, provider, category, is_enabled, public_config, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
    )
    .eq("organization_id", reference.organizationId)
    .order("category")
    .order("provider");
  if (error) throw error;
  return {
    vaultConfigured: isIntegrationVaultConfigured(),
    integrations: (data || []).map((row) => toSummary(row)),
  };
}

export async function saveOrganizationIntegration(input: unknown) {
  const parsed = integrationMutationSchema.parse(input);
  await requireOrganizationRole(parsed.organizationId, MANAGER_ROLES);
  const userId = await currentUserId();
  const provider = parsed.provider;
  assertIntegrationActivationAvailable(provider, parsed.isEnabled);
  let publicConfig = parseIntegrationConfig(provider, parsed.publicConfig);
  const secretUpdates = parseSecretUpdates(provider, parsed.secretUpdates);
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("organization_integrations")
    .select(
      "id, public_config, encrypted_secrets, created_by, connection_status, last_tested_at, last_test_message",
    )
    .eq("organization_id", parsed.organizationId)
    .eq("provider", provider)
    .maybeSingle();
  if (existingError) throw existingError;

  if (provider === "resend") {
    const existingConfig =
      existing?.public_config &&
      typeof existing.public_config === "object" &&
      !Array.isArray(existing.public_config)
        ? (existing.public_config as Record<string, unknown>)
        : {};
    const inboundRouteKey =
      typeof existingConfig.inboundRouteKey === "string" &&
      existingConfig.inboundRouteKey.length >= 20
        ? existingConfig.inboundRouteKey
        : randomBytes(24).toString("base64url");
    publicConfig = { ...publicConfig, inboundRouteKey };
  }

  let existingSecrets: IntegrationSecrets = {};
  if (existing) {
    existingSecrets = decryptIntegrationSecrets(existing.encrypted_secrets);
  }
  let secrets: IntegrationSecrets;
  try {
    secrets = parseCompleteSecrets(provider, {
      ...existingSecrets,
      ...secretUpdates,
    });
  } catch {
    throw new Error(
      `Enter every required ${INTEGRATION_CATALOG[provider].label} credential before saving.`,
    );
  }
  if (
    provider === "resend" &&
    publicConfig.inboundEnabled === true &&
    !secrets.webhookSecret
  ) {
    throw new Error(
      "Add the Resend webhook signing secret before enabling inbound email.",
    );
  }
  if (
    provider === "custom_smtp" &&
    publicConfig.inboundEnabled === true &&
    !secrets.imapPassword
  ) {
    throw new Error(
      "Add the IMAP password before enabling inbound email.",
    );
  }
  assertMatchingEnvironment(provider, publicConfig, secrets);

  const normalizeConfig = (config: unknown) => {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return JSON.stringify(config);
    }
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(config).sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
  };
  const configurationChanged =
    !existing || normalizeConfig(existing.public_config) !== normalizeConfig(publicConfig);
  const credentialsChanged = Object.keys(secretUpdates).length > 0;
  const materialChanged = configurationChanged || credentialsChanged;
  const activation = resolveIntegrationSaveActivation({
    requestedEnabled: parsed.isEnabled,
    materialChanged,
    existingStatus:
      (existing?.connection_status as IntegrationConnectionStatus | undefined) ?? null,
    lastTestedAt: existing?.last_tested_at,
    lastTestMessage: existing?.last_test_message,
  });

  const payload = {
    organization_id: parsed.organizationId,
    category: integrationCategoryFor(provider),
    provider,
    is_enabled: activation.isEnabled,
    public_config: publicConfig,
    encrypted_secrets: encryptIntegrationSecrets(secrets),
    credential_hint: credentialHint(provider, secrets),
    encryption_version: 1,
    connection_status: activation.connectionStatus,
    last_tested_at: activation.lastTestedAt,
    last_test_message: activation.lastTestMessage,
    created_by: existing?.created_by ?? userId,
    updated_by: userId,
  } as const;
  if (integrationCategoryFor(provider) === "email" && activation.isEnabled) {
    const { error: disableError } = await admin
      .from("organization_integrations")
      .update({ is_enabled: false, updated_by: userId })
      .eq("organization_id", parsed.organizationId)
      .eq("category", "email")
      .neq("provider", provider);
    if (disableError) throw disableError;
  }
  const { data: saved, error } = await admin
    .from("organization_integrations")
    .upsert(payload, { onConflict: "organization_id,provider" })
    .select(
      "id, provider, category, is_enabled, public_config, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
    )
    .single();
  if (error) throw error;

  await recordAuditEvent({
    organizationId: parsed.organizationId,
    eventType: existing ? "record.updated" : "record.created",
    entityType: "organization_integration",
    entityId: saved.id,
    metadata: {
      event: existing ? "integration.configuration_updated" : "integration.configuration_created",
      provider,
      category: integrationCategoryFor(provider),
      enabled: activation.isEnabled,
      activation_deferred_until_test: parsed.isEnabled && !activation.isEnabled,
      credentials_returned_to_client: false,
    },
  });
  return toSummary(saved);
}

export async function removeOrganizationIntegration(input: unknown) {
  const parsed = integrationReferenceSchema.parse(input);
  await requireOrganizationRole(parsed.organizationId, MANAGER_ROLES);
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("organization_integrations")
    .select("id, category")
    .eq("organization_id", parsed.organizationId)
    .eq("provider", parsed.provider)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) return { removed: false };
  const { error } = await admin
    .from("organization_integrations")
    .delete()
    .eq("id", existing.id)
    .eq("organization_id", parsed.organizationId);
  if (error) throw error;
  await recordAuditEvent({
    organizationId: parsed.organizationId,
    eventType: "record.updated",
    entityType: "organization_integration",
    entityId: existing.id,
    metadata: {
      event: "integration.configuration_removed",
      provider: parsed.provider,
      category: existing.category,
    },
  });
  return { removed: true };
}

async function fetchConnection(url: string, init: RequestInit) {
  return fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
  });
}

async function verifyProviderConnection(
  provider: IntegrationProvider,
  config: IntegrationPublicConfig,
  secrets: IntegrationSecrets,
) {
  if (provider === "custom_smtp") {
    const originalHost = String(config.host);
    const resolvedHost = await resolvePublicHostname(originalHost);
    const transport = nodemailer.createTransport({
      host: resolvedHost,
      port: Number(config.port),
      secure: config.security === "tls",
      requireTLS: config.security === "starttls",
      ignoreTLS: config.security === "none",
      auth: { user: String(config.username), pass: secrets.password },
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: CONNECTION_TIMEOUT_MS,
      socketTimeout: CONNECTION_TIMEOUT_MS,
      tls: { servername: originalHost, rejectUnauthorized: true },
    });
    await transport.verify();
    transport.close();
    if (config.inboundEnabled === true) {
      const originalImapHost = String(config.imapHost);
      const resolvedImapHost = await resolvePublicHostname(originalImapHost);
      const imap = new ImapFlow({
        host: resolvedImapHost,
        servername: originalImapHost,
        port: Number(config.imapPort),
        secure: config.imapSecurity === "tls",
        doSTARTTLS: config.imapSecurity === "starttls",
        auth: {
          user: String(config.imapUsername),
          pass: secrets.imapPassword,
        },
        verifyOnly: true,
        logger: false,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: CONNECTION_TIMEOUT_MS,
        socketTimeout: CONNECTION_TIMEOUT_MS,
        maxLineLength: 1_000_000,
        maxLiteralSize: 1_000_000,
        maxResponseSize: 2_000_000,
        tls: { servername: originalImapHost, rejectUnauthorized: true },
      });
      try {
        await imap.connect();
      } finally {
        if (imap.usable) await imap.logout().catch(() => undefined);
      }
    }
    return;
  }

  let response: Response;
  if (provider === "resend") {
    response = await fetchConnection("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${secrets.apiKey}` },
    });
  } else if (provider === "stripe") {
    response = await fetchConnection("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${secrets.secretKey}` },
    });
  } else if (provider === "razorpay") {
    const authorization = Buffer.from(
      `${String(config.keyId)}:${secrets.keySecret}`,
    ).toString("base64");
    response = await fetchConnection("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${authorization}` },
    });
  } else if (provider === "whatsapp_cloud") {
    response = await fetchConnection(
      `https://graph.facebook.com/${String(config.graphApiVersion)}/${String(config.phoneNumberId)}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${secrets.accessToken}` } },
    );
  } else if (provider === "openai") {
    response = await fetchConnection(
      `https://api.openai.com/v1/models/${encodeURIComponent(String(config.model))}`,
      {
        headers: {
          Authorization: `Bearer ${secrets.apiKey}`,
          ...(config.projectId
            ? { "OpenAI-Project": String(config.projectId) }
            : {}),
        },
      },
    );
  } else {
    response = await fetchConnection("https://api.anthropic.com/v1/models?limit=1", {
      headers: {
        "x-api-key": secrets.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
  }
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "authentication_failed"
        : `provider_http_${response.status}`,
    );
  }
}

function safeFailureMessage(error: unknown) {
  if (error instanceof Error && error.message === "authentication_failed") {
    return "Authentication was rejected. Check the saved credentials.";
  }
  if (error instanceof Error && error.message.startsWith("provider_http_")) {
    return "The provider responded, but the requested account resource was unavailable.";
  }
  if (error instanceof Error && error.message.includes("Private network")) {
    return error.message;
  }
  return "The provider could not be reached or verified.";
}

export async function testOrganizationIntegration(input: unknown) {
  const parsed = integrationReferenceSchema.parse(input);
  await requireOrganizationRole(parsed.organizationId, MANAGER_ROLES);
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("organization_integrations")
    .select(
      "id, provider, category, is_enabled, public_config, encrypted_secrets, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
    )
    .eq("organization_id", parsed.organizationId)
    .eq("provider", parsed.provider)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new Error("Save this integration before testing it.");

  const testedAt = new Date().toISOString();
  let connectionStatus: IntegrationConnectionStatus = "connected";
  let message = "Connection verified. No message, payment, or AI request was created.";
  try {
    await verifyProviderConnection(
      parsed.provider,
      existing.public_config as IntegrationPublicConfig,
      decryptIntegrationSecrets(existing.encrypted_secrets),
    );
  } catch (error) {
    connectionStatus = "failed";
    message = safeFailureMessage(error);
  }

  const { data: updated, error } = await admin
    .from("organization_integrations")
    .update({
      is_enabled: isIntegrationRuntimeReady(parsed.provider)
        ? enabledAfterConnectionTest(existing.is_enabled, connectionStatus)
        : false,
      connection_status: connectionStatus,
      last_tested_at: testedAt,
      last_test_message: message,
    })
    .eq("id", existing.id)
    .eq("organization_id", parsed.organizationId)
    .select(
      "id, provider, category, is_enabled, public_config, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
    )
    .single();
  if (error) throw error;
  await recordAuditEvent({
    organizationId: parsed.organizationId,
    eventType: "record.updated",
    entityType: "organization_integration",
    entityId: existing.id,
    metadata: {
      event: "integration.connection_tested",
      provider: parsed.provider,
      category: INTEGRATION_CATALOG[parsed.provider].category,
      result: connectionStatus,
      external_action_performed: false,
    },
  });
  return toSummary(updated);
}
