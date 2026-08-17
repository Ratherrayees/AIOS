import "server-only";

import { createSupabaseAdminClient } from "../supabase/admin";
import type {
  IntegrationProvider,
  IntegrationPublicConfig,
} from "./catalog";
import { decryptIntegrationSecrets } from "./vault";

/**
 * Trusted server-only lookup for code that has already established its tenant
 * boundary. Never call this with an organization id taken from an unauthenticated
 * request.
 */
export async function loadEnabledTenantIntegration(
  organizationId: string,
  provider: IntegrationProvider,
) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("organization_integrations")
    .select("provider, public_config, encrypted_secrets")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .eq("is_enabled", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    provider,
    publicConfig: data.public_config as IntegrationPublicConfig,
    secrets: decryptIntegrationSecrets(data.encrypted_secrets),
  };
}

/**
 * Resolves an opaque Resend webhook route to one active tenant integration.
 * The route key only selects candidate credentials; the webhook signature is
 * still mandatory before any event data is trusted.
 */
export async function loadTenantResendInboundRoute(routeKey: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("organization_integrations")
    .select("organization_id, public_config, encrypted_secrets")
    .eq("provider", "resend")
    .eq("is_enabled", true)
    .contains("public_config", { inboundRouteKey: routeKey })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const publicConfig = data.public_config as IntegrationPublicConfig;
  if (publicConfig.inboundEnabled !== true) return null;
  return {
    organizationId: data.organization_id,
    publicConfig,
    secrets: decryptIntegrationSecrets(data.encrypted_secrets),
  };
}

export async function loadEnabledPlatformEmailIntegration() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("platform_integrations")
    .select("provider, public_config, encrypted_secrets")
    .eq("is_enabled", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    provider: data.provider as Extract<IntegrationProvider, "resend" | "custom_smtp">,
    publicConfig: data.public_config as IntegrationPublicConfig,
    secrets: decryptIntegrationSecrets(data.encrypted_secrets),
  };
}
