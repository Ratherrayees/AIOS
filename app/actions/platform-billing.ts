"use server";

import { z } from "zod";

import { requirePlatformCapability } from "../../lib/platform/authorization";
import { platformRoleHasCapability } from "../../lib/platform/contracts";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

const createPlanSchema = z.strictObject({
  planCode: z.string().trim().toLowerCase().min(2).max(60).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(12).max(500),
  currency: z.string().trim().toUpperCase().length(3).regex(/^[A-Z]{3}$/),
  interval: z.enum(["month", "year"]),
  amountMinor: z.number().int().nonnegative().max(1_000_000_000),
  userLimit: z.number().int().positive().max(1_000_000),
  monthlyAiRuns: z.number().int().nonnegative().max(1_000_000_000),
  storageGb: z.number().int().nonnegative().max(1_000_000),
  assistedAi: z.boolean(),
  autopilotAi: z.boolean(),
  emailAutomation: z.boolean(),
  whatsappAutomation: z.boolean(),
  analyticsExports: z.boolean(),
  reason: z.string().trim().min(12).max(500),
});

const planStatusSchema = z.strictObject({
  planId: z.uuid(),
  status: z.enum(["active", "retired"]),
  confirmation: z.string().trim().min(3).max(100),
  expectedConfirmation: z.string().trim().min(3).max(100),
  reason: z.string().trim().min(12).max(500),
});

const subscriptionSchema = z.strictObject({
  organizationId: z.uuid(),
  planId: z.uuid(),
  status: z.enum(["trialing", "active", "past_due", "grace", "canceled"]),
  trialEndsAt: z.string().trim().nullable(),
  periodStart: z.string().trim().nullable(),
  periodEnd: z.string().trim().nullable(),
  graceEndsAt: z.string().trim().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  expectedVersion: z.number().int().positive().nullable(),
  confirmation: z.string().trim().min(2).max(120),
  reason: z.string().trim().min(12).max(500),
});

function isoOrNull(value: string | null, label: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a valid date.`);
  return parsed.toISOString();
}

function throwOnErrors(errors: Array<{ message: string } | null>) {
  const error = errors.find(Boolean);
  if (error) throw new Error(error.message);
}

export async function getPlatformCommercialOverview() {
  const access = await requirePlatformCapability("platform.billing.read");
  const admin = createSupabaseAdminClient();
  const [plans, prices, entitlements, organizations, lifecycles, subscriptions] =
    await Promise.all([
      admin.from("platform_plans").select("id, plan_code, version, name, description, status, activated_at, retired_at, created_at").order("plan_code").order("version", { ascending: false }),
      admin.from("platform_plan_prices").select("plan_id, currency, interval, amount_minor").order("currency"),
      admin.from("platform_plan_entitlements").select("plan_id, entitlement_key, integer_value, boolean_value").order("entitlement_key"),
      admin.from("organizations").select("id, name, slug").order("name"),
      admin.from("organization_lifecycle").select("organization_id, status"),
      admin.from("organization_subscriptions").select("id, organization_id, plan_id, status, trial_ends_at, current_period_start, current_period_end, grace_ends_at, cancel_at_period_end, version, reason, updated_at"),
    ]);
  throwOnErrors([
    plans.error,
    prices.error,
    entitlements.error,
    organizations.error,
    lifecycles.error,
    subscriptions.error,
  ]);

  const priceRows = prices.data ?? [];
  const entitlementRows = entitlements.data ?? [];
  const planRows = (plans.data ?? []).map((plan) => ({
    ...plan,
    prices: priceRows.filter((price) => price.plan_id === plan.id),
    entitlements: entitlementRows.filter((entitlement) => entitlement.plan_id === plan.id),
  }));
  const lifecycleByOrganization = new Map(
    (lifecycles.data ?? []).map((row) => [row.organization_id, row.status]),
  );
  const subscriptionByOrganization = new Map(
    (subscriptions.data ?? []).map((row) => [row.organization_id, row]),
  );

  return {
    role: access.role,
    mfaVerified: access.mfa_verified,
    canManageBilling: platformRoleHasCapability(access.role, "platform.billing.manage"),
    plans: planRows,
    agencies: (organizations.data ?? []).map((organization) => ({
      ...organization,
      lifecycleStatus: lifecycleByOrganization.get(organization.id) ?? "active",
      subscription: subscriptionByOrganization.get(organization.id) ?? null,
    })),
  };
}

export async function createPlatformPlan(input: z.input<typeof createPlanSchema>) {
  const parsed = createPlanSchema.parse(input);
  const access = await requirePlatformCapability("platform.billing.manage", { mfa: true });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("create_platform_plan_service", {
    target_plan_code: parsed.planCode,
    target_name: parsed.name,
    target_description: parsed.description,
    target_currency: parsed.currency,
    target_interval: parsed.interval,
    target_amount_minor: parsed.amountMinor,
    target_user_limit: parsed.userLimit,
    target_monthly_ai_runs: parsed.monthlyAiRuns,
    target_storage_gb: parsed.storageGb,
    target_assisted_ai: parsed.assistedAi,
    target_autopilot_ai: parsed.autopilotAi,
    target_email_automation: parsed.emailAutomation,
    target_whatsapp_automation: parsed.whatsappAutomation,
    target_analytics_exports: parsed.analyticsExports,
    actor_id: access.user_id,
    creation_reason: parsed.reason,
  });
  if (error) throw new Error(error.message);
  return { planId: data.id, version: data.version };
}

export async function changePlatformPlanStatus(input: z.input<typeof planStatusSchema>) {
  const parsed = planStatusSchema.parse(input);
  if (parsed.confirmation !== parsed.expectedConfirmation) {
    throw new Error(`Type ${parsed.expectedConfirmation} exactly to confirm.`);
  }
  const access = await requirePlatformCapability("platform.billing.manage", { mfa: true });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("set_platform_plan_status_service", {
    target_plan_id: parsed.planId,
    target_status: parsed.status,
    actor_id: access.user_id,
    change_reason: parsed.reason,
  });
  if (error) throw new Error(error.message);
  return { planId: data.id, status: data.status };
}

export async function setPlatformAgencySubscription(input: z.input<typeof subscriptionSchema>) {
  const parsed = subscriptionSchema.parse(input);
  const access = await requirePlatformCapability("platform.billing.manage", { mfa: true });
  const admin = createSupabaseAdminClient();
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("slug")
    .eq("id", parsed.organizationId)
    .single();
  if (organizationError) throw new Error(organizationError.message);
  if (parsed.confirmation !== organization.slug) {
    throw new Error(`Type ${organization.slug} exactly to confirm.`);
  }
  const { data, error } = await admin.rpc("set_organization_subscription_service", {
    target_organization_id: parsed.organizationId,
    target_plan_id: parsed.planId,
    target_status: parsed.status,
    target_trial_ends_at: isoOrNull(parsed.trialEndsAt, "Trial end"),
    target_period_start: isoOrNull(parsed.periodStart, "Period start"),
    target_period_end: isoOrNull(parsed.periodEnd, "Period end"),
    target_grace_ends_at: isoOrNull(parsed.graceEndsAt, "Grace end"),
    target_cancel_at_period_end: parsed.cancelAtPeriodEnd,
    actor_id: access.user_id,
    change_reason: parsed.reason,
    expected_version: parsed.expectedVersion,
  });
  if (error) throw new Error(error.message);
  return { subscriptionId: data.id, version: data.version, status: data.status };
}
