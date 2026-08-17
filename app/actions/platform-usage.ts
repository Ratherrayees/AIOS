"use server";

import { z } from "zod";

import { requirePlatformCapability } from "../../lib/platform/authorization";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

const usageWindowSchema = z.strictObject({ days: z.union([z.literal(30), z.literal(90), z.literal(365)]) });

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getPlatformUsageOverview(input: z.input<typeof usageWindowSchema>) {
  const parsed = usageWindowSchema.parse(input);
  const access = await requirePlatformCapability("platform.usage.read");
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - parsed.days * 24 * 60 * 60 * 1_000).toISOString();
  const [usage, organizations, lifecycles, subscriptions, snapshots, plans] = await Promise.all([
    admin.rpc("get_platform_usage_snapshot_service", { actor_id: access.user_id, target_since: since }),
    admin.from("organizations").select("id, name, slug").order("name"),
    admin.from("organization_lifecycle").select("organization_id, status"),
    admin.from("organization_subscriptions").select("id, organization_id, plan_id, status, version"),
    admin.from("organization_entitlement_snapshots").select("subscription_id, subscription_version, entitlements"),
    admin.from("platform_plans").select("id, name, version"),
  ]);
  const error = [usage.error, organizations.error, lifecycles.error, subscriptions.error, snapshots.error, plans.error].find(Boolean);
  if (error) throw new Error(error.message);

  const usageByOrganization = new Map((usage.data ?? []).map((row) => [row.organization_id, row]));
  const lifecycleByOrganization = new Map((lifecycles.data ?? []).map((row) => [row.organization_id, row.status]));
  const subscriptionByOrganization = new Map((subscriptions.data ?? []).map((row) => [row.organization_id, row]));
  const snapshotByVersion = new Map((snapshots.data ?? []).map((row) => [`${row.subscription_id}:${row.subscription_version}`, row]));
  const planById = new Map((plans.data ?? []).map((row) => [row.id, row]));

  const agencies = (organizations.data ?? []).map((organization) => {
    const metrics = usageByOrganization.get(organization.id);
    const subscription = subscriptionByOrganization.get(organization.id);
    const snapshot = subscription ? snapshotByVersion.get(`${subscription.id}:${subscription.version}`) : null;
    const plan = subscription ? planById.get(subscription.plan_id) : null;
    const entitlement = objectValue(snapshot?.entitlements);
    const userLimit = typeof entitlement["users.max"] === "number" ? entitlement["users.max"] : null;
    const aiRunLimit = typeof entitlement["ai.runs.monthly"] === "number" ? entitlement["ai.runs.monthly"] : null;
    const storageLimitGb = typeof entitlement["storage.gb"] === "number" ? entitlement["storage.gb"] : null;
    const activeUsers = metrics?.active_users ?? 0;
    const aiRuns = metrics?.ai_runs ?? 0;
    const storageBytes = metrics?.storage_bytes ?? 0;
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      lifecycleStatus: lifecycleByOrganization.get(organization.id) ?? "active",
      plan: plan ? `${plan.name} v${plan.version}` : null,
      subscriptionStatus: subscription?.status ?? null,
      activeUsers,
      aiRuns,
      inputTokens: metrics?.input_tokens ?? 0,
      outputTokens: metrics?.output_tokens ?? 0,
      aiCosts: objectValue(metrics?.ai_costs) as Record<string, number>,
      storageBytes,
      outboundEmails: metrics?.outbound_emails ?? 0,
      inboundEmails: metrics?.inbound_emails ?? 0,
      queuedAiJobs: metrics?.queued_ai_jobs ?? 0,
      failedAiJobs: metrics?.failed_ai_jobs ?? 0,
      managementReports: metrics?.management_reports ?? 0,
      limits: { users: userLimit, monthlyAiRuns: aiRunLimit, storageGb: storageLimitGb },
      attention: {
        users: userLimit !== null && activeUsers > userLimit,
        aiRuns: parsed.days === 30 && aiRunLimit !== null && aiRuns > aiRunLimit,
        storage: storageLimitGb !== null && storageBytes > storageLimitGb * 1024 * 1024 * 1024,
        failedJobs: (metrics?.failed_ai_jobs ?? 0) > 0,
      },
    };
  });
  return {
    days: parsed.days,
    generatedAt: new Date().toISOString(),
    agencies,
    totals: {
      agencies: agencies.length,
      activeUsers: agencies.reduce((sum, agency) => sum + agency.activeUsers, 0),
      aiRuns: agencies.reduce((sum, agency) => sum + agency.aiRuns, 0),
      storageBytes: agencies.reduce((sum, agency) => sum + agency.storageBytes, 0),
      failedAiJobs: agencies.reduce((sum, agency) => sum + agency.failedAiJobs, 0),
      attentionAgencies: agencies.filter((agency) => Object.values(agency.attention).some(Boolean)).length,
    },
  };
}
