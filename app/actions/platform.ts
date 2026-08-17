"use server";

import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";

import { getApplicationOrigin } from "../../lib/auth/application-origin";
import { sendPlatformAgencyOwnerInvitationEmail } from "../../lib/email/templates";

import {
  type IntegrationConnectionStatus,
  type IntegrationProvider,
  type IntegrationPublicConfig,
  type IntegrationSecrets,
  type IntegrationSummary,
} from "../../lib/integrations/catalog";
import {
  credentialHint,
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
import {
  type PlatformRole,
  requirePlatformCapability,
  requirePlatformRole,
} from "../../lib/platform/authorization";
import {
  ORGANIZATION_LIFECYCLE_STATUSES,
  canTransitionOrganizationLifecycle,
  type OrganizationLifecycleStatus,
} from "../../lib/platform/contracts";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

const PLATFORM_EMAIL = "travel@lumierah.in";
const EMAIL_PROVIDERS = ["resend", "custom_smtp"] as const;
const providerSchema = z.enum(EMAIL_PROVIDERS);
const mutationSchema = z.strictObject({
  provider: providerSchema,
  isEnabled: z.boolean(),
  publicConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  secretUpdates: z.record(z.string(), z.string().max(2_000)),
});
const referenceSchema = z.strictObject({ provider: providerSchema });
const platformDirectorySchema = z.strictObject({
  query: z.string().trim().max(120).default(""),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
});
const platformAuditSchema = z.strictObject({
  query: z.string().trim().max(120).default(""),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
});
const grantPlatformAccessSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(["superadmin", "platform_admin"]),
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().toLowerCase().email().max(320),
});
const updatePlatformAccessSchema = z.strictObject({
  userId: z.uuid(),
  role: z.enum(["superadmin", "platform_admin"]),
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().toLowerCase().email().max(320),
  expectedVersion: z.number().int().positive(),
});
const platformAgencyReferenceSchema = z.strictObject({
  organizationId: z.uuid(),
});
const organizationLifecycleMutationSchema = z.strictObject({
  organizationId: z.uuid(),
  status: z.enum(ORGANIZATION_LIFECYCLE_STATUSES),
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().min(2).max(120),
  expectedVersion: z.number().int().positive(),
});
const provisionPlatformAgencySchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  ownerEmail: z.string().trim().toLowerCase().email().max(320),
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().min(2).max(120),
});
const resendPlatformInvitationSchema = z.strictObject({
  organizationId: z.uuid(),
  invitationId: z.uuid(),
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().min(2).max(120),
});
const platformIdentityDirectorySchema = z.strictObject({
  query: z.string().trim().max(120).default(""),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
});
const platformIdentityStatusSchema = z.strictObject({
  userId: z.uuid(),
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().min(3).max(320),
  expectedVersion: z.number().int().positive(),
});
const platformIdentityReferenceSchema = z.strictObject({
  userId: z.uuid(),
});
const platformIdentitySecurityActionSchema = z.strictObject({
  userId: z.uuid(),
  action: z.enum(["revoke_sessions", "require_password_reset"]),
  reason: z.string().trim().min(12).max(500),
  confirmation: z.string().trim().min(3).max(320),
  expectedVersion: z.number().int().positive(),
});

type PlatformIntegrationRow = {
  id: string;
  provider: string;
  is_enabled: boolean;
  public_config: unknown;
  credential_hint: string;
  connection_status: string;
  last_tested_at: string | null;
  last_test_message: string | null;
  updated_at: string;
};

function toSummary(row: PlatformIntegrationRow): IntegrationSummary {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    category: "email",
    isEnabled: row.is_enabled,
    publicConfig: row.public_config as IntegrationPublicConfig,
    credentialHint: row.credential_hint,
    connectionStatus: row.connection_status as IntegrationConnectionStatus,
    lastTestedAt: row.last_tested_at,
    lastTestMessage: row.last_test_message,
    updatedAt: row.updated_at,
  };
}

async function recordPlatformAudit(
  actorId: string,
  input: {
    eventType: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, string | boolean | null>;
  },
) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("platform_audit_events").insert({
    actor_id: actorId,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) throw error;
}

export async function getCurrentPlatformAccess(): Promise<{
  role: PlatformRole;
  mfaVerified: boolean;
} | null> {
  try {
    const access = await requirePlatformRole();
    return { role: access.role, mfaVerified: access.mfa_verified };
  } catch {
    return null;
  }
}

export async function getPlatformOverview() {
  const access = await requirePlatformCapability("platform.overview.read");
  const admin = createSupabaseAdminClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const [
    agencies,
    recentAgencies,
    activeMemberships,
    activeAgencyLifecycles,
    tenantIntegrations,
    integrations,
    queuedAiJobs,
    failedAiJobs,
    pendingApprovals,
    failedInbound,
    failedOutbound,
    activeOperators,
  ] = await Promise.all([
    admin.from("organizations").select("id", { count: "exact", head: true }),
    admin
      .from("organizations")
      .select("id, name, slug, created_at", { count: "exact" })
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("memberships")
      .select("organization_id")
      .eq("status", "active"),
    admin
      .from("organization_lifecycle")
      .select("organization_id")
      .eq("status", "active"),
    admin
      .from("organization_integrations")
      .select("id, is_enabled, connection_status"),
    admin
      .from("platform_integrations")
      .select(
        "id, provider, is_enabled, public_config, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
      )
      .order("provider"),
    admin
      .from("ai_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running", "failed"]),
    admin
      .from("ai_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "dead_letter"]),
    admin
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("email_inbound_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    admin
      .from("email_message_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    admin
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("status", "active"),
  ]);
  const firstError = [
    agencies.error,
    recentAgencies.error,
    activeMemberships.error,
    activeAgencyLifecycles.error,
    tenantIntegrations.error,
    integrations.error,
    queuedAiJobs.error,
    failedAiJobs.error,
    pendingApprovals.error,
    failedInbound.error,
    failedOutbound.error,
    activeOperators.error,
  ].find(Boolean);
  if (firstError) throw firstError;
  const tenantIntegrationRows = tenantIntegrations.data || [];
  const activeAgencyIds = new Set(
    (activeAgencyLifecycles.data || []).map((row) => row.organization_id),
  );
  const activeMembershipCount = (activeMemberships.data || []).filter((membership) =>
    activeAgencyIds.has(membership.organization_id),
  ).length;
  return {
    role: access.role,
    mfaVerified: access.mfa_verified,
    agencyCount: agencies.count ?? 0,
    agenciesCreatedLast30Days: recentAgencies.count ?? 0,
    activeMembershipCount,
    activeOperatorCount: activeOperators.count ?? 0,
    tenantIntegrationCount: tenantIntegrationRows.length,
    enabledTenantIntegrationCount: tenantIntegrationRows.filter(
      (item) => item.is_enabled,
    ).length,
    tenantIntegrationAttentionCount: tenantIntegrationRows.filter(
      (item) => item.connection_status === "failed",
    ).length,
    queuedAiJobCount: queuedAiJobs.count ?? 0,
    failedAiJobCount: failedAiJobs.count ?? 0,
    pendingApprovalCount: pendingApprovals.count ?? 0,
    failedInboundEmailCount: failedInbound.count ?? 0,
    failedOutboundEmailCount: failedOutbound.count ?? 0,
    recentAgencies: recentAgencies.data || [],
    platformEmail: PLATFORM_EMAIL,
    integrations: (integrations.data || []).map((row) => toSummary(row)),
    vaultConfigured: isIntegrationVaultConfigured(),
    systemReadiness: [
      {
        key: "application_origin",
        label: "Production application URL",
        ready: Boolean(process.env.APP_BASE_URL?.startsWith("https://")),
        guidance: "Required for secure authentication and customer callbacks.",
      },
      {
        key: "credential_vault",
        label: "Integration credential vault",
        ready: isIntegrationVaultConfigured(),
        guidance: "Required before tenant or platform credentials can be saved.",
      },
      {
        key: "aios_worker",
        label: "AIOS background worker",
        ready: Boolean(process.env.AIOS_WORKER_SECRET && process.env.AIOS_WORKER_SECRET.length >= 32),
        guidance: "Required for durable model jobs, retries, and scheduled agents.",
      },
      {
        key: "inbound_email_worker",
        label: "Inbound email worker",
        ready: Boolean(
          process.env.EMAIL_INBOUND_WORKER_SECRET &&
            process.env.EMAIL_INBOUND_WORKER_SECRET.length >= 32,
        ),
        guidance: "Required for tenant IMAP ingestion and protected polling.",
      },
    ],
  };
}

export async function getPlatformAgencies(input: unknown = {}) {
  const parsed = platformDirectorySchema.parse(input);
  const access = await requirePlatformCapability("platform.agencies.read");
  const admin = createSupabaseAdminClient();
  const from = (parsed.page - 1) * parsed.pageSize;
  const to = from + parsed.pageSize - 1;
  let query = admin
    .from("organizations")
    .select("id, name, slug, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (parsed.query) {
    const safeQuery = parsed.query.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim();
    query = query.or(`name.ilike.%${safeQuery}%,slug.ilike.%${safeQuery}%`);
  }
  const { data: organizations, count, error } = await query;
  if (error) throw error;
  const organizationIds = (organizations || []).map((organization) => organization.id);
  const [memberships, integrations, lifecycles] = organizationIds.length
    ? await Promise.all([
        admin
          .from("memberships")
          .select("organization_id, status")
          .in("organization_id", organizationIds),
        admin
          .from("organization_integrations")
          .select("organization_id, provider, category, is_enabled, connection_status")
          .in("organization_id", organizationIds),
        admin
          .from("organization_lifecycle")
          .select("organization_id, status, updated_at")
          .in("organization_id", organizationIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (memberships.error) throw memberships.error;
  if (integrations.error) throw integrations.error;
  if (lifecycles.error) throw lifecycles.error;
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    total: count ?? 0,
    query: parsed.query,
    canProvisionAgencies: access.role === "superadmin",
    mfaVerified: access.mfa_verified,
    agencies: (organizations || []).map((organization) => {
      const memberRows = (memberships.data || []).filter(
        (membership) => membership.organization_id === organization.id,
      );
      const integrationRows = (integrations.data || []).filter(
        (integration) => integration.organization_id === organization.id,
      );
      const activeProviders = integrationRows.filter(
        (integration) =>
          integration.is_enabled && integration.connection_status === "connected",
      );
      const lifecycle = (lifecycles.data || []).find(
        (candidate) => candidate.organization_id === organization.id,
      );
      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.created_at,
        updatedAt: organization.updated_at,
        lifecycleStatus: lifecycle?.status || "active",
        lifecycleUpdatedAt: lifecycle?.updated_at || organization.updated_at,
        activeMemberCount: memberRows.filter((membership) => membership.status === "active").length,
        configuredIntegrationCount: integrationRows.length,
        activeIntegrationCount: activeProviders.length,
        emailReady: activeProviders.some((integration) => integration.category === "email"),
        paymentReady: activeProviders.some((integration) => integration.category === "payment"),
        whatsappReady: activeProviders.some((integration) => integration.provider === "whatsapp_cloud"),
        aiReady: activeProviders.some((integration) => integration.category === "ai"),
      };
    }),
  };
}

export async function getPlatformAgencyDetail(input: unknown) {
  const parsed = platformAgencyReferenceSchema.parse(input);
  const access = await requirePlatformCapability("platform.agencies.read");
  const admin = createSupabaseAdminClient();
  const [organizationResult, lifecycleResult, membershipsResult, integrationsResult, eventsResult, invitationsResult] =
    await Promise.all([
      admin
        .from("organizations")
        .select("id, name, slug, created_at, updated_at")
        .eq("id", parsed.organizationId)
        .maybeSingle(),
      admin
        .from("organization_lifecycle")
        .select("status, reason, changed_by, version, created_at, updated_at")
        .eq("organization_id", parsed.organizationId)
        .maybeSingle(),
      admin
        .from("memberships")
        .select("user_id, role, status, created_at")
        .eq("organization_id", parsed.organizationId),
      admin
        .from("organization_integrations")
        .select("provider, category, is_enabled, connection_status, updated_at")
        .eq("organization_id", parsed.organizationId)
        .order("category"),
      admin
        .from("organization_lifecycle_events")
        .select("id, previous_status, next_status, reason, actor_id, version, created_at")
        .eq("organization_id", parsed.organizationId)
        .order("created_at", { ascending: false })
        .limit(20),
      admin
        .from("organization_invitations")
        .select("id, email, role, status, expires_at, created_at")
        .eq("organization_id", parsed.organizationId)
        .eq("role", "owner")
        .in("status", ["pending", "expired"])
        .order("created_at", { ascending: false }),
    ]);
  const firstError = [
    organizationResult.error,
    lifecycleResult.error,
    membershipsResult.error,
    integrationsResult.error,
    eventsResult.error,
    invitationsResult.error,
  ].find(Boolean);
  if (firstError) throw firstError;
  if (!organizationResult.data || !lifecycleResult.data) {
    throw new Error("That agency no longer exists.");
  }

  const memberships = membershipsResult.data || [];
  const ownerIds = memberships
    .filter((membership) => membership.role === "owner")
    .map((membership) => membership.user_id);
  const actorIds = (eventsResult.data || []).flatMap((event) =>
    event.actor_id ? [event.actor_id] : [],
  );
  const profileIds = [...new Set([...ownerIds, ...actorIds])];
  const { data: profiles, error: profileError } = profileIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
  const ownerEmails = await Promise.all(
    ownerIds.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return [userId, data.user?.email || null] as const;
    }),
  );
  const emails = new Map(ownerEmails);

  const countTables = [
    ["contacts", "Contacts"],
    ["deals", "Opportunities"],
    ["conversations", "Conversations"],
    ["quotes", "Quotes"],
    ["trips", "Trips"],
    ["tasks", "Tasks"],
  ] as const;
  const countResults = await Promise.all(
    countTables.map(async ([table, label]) => {
      const { count, error } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", parsed.organizationId);
      if (error) throw error;
      return { label, count: count ?? 0 };
    }),
  );

  return {
    organization: {
      id: organizationResult.data.id,
      name: organizationResult.data.name,
      slug: organizationResult.data.slug,
      createdAt: organizationResult.data.created_at,
      updatedAt: organizationResult.data.updated_at,
    },
    lifecycle: {
      status: lifecycleResult.data.status,
      reason: lifecycleResult.data.reason,
      version: lifecycleResult.data.version,
      updatedAt: lifecycleResult.data.updated_at,
    },
    membershipSummary: {
      total: memberships.length,
      active: memberships.filter((membership) => membership.status === "active").length,
      suspended: memberships.filter((membership) => membership.status === "suspended").length,
      invited: memberships.filter((membership) => membership.status === "invited").length,
    },
    owners: ownerIds.map((userId) => ({
      userId,
      fullName: names.get(userId) || "Agency owner",
      email: emails.get(userId) || null,
    })),
    integrations: integrationsResult.data || [],
    recordCounts: countResults,
    lifecycleEvents: (eventsResult.data || []).map((event) => ({
      id: event.id,
      previousStatus: event.previous_status,
      nextStatus: event.next_status,
      reason: event.reason,
      actorName: event.actor_id
        ? names.get(event.actor_id) || "Platform operator"
        : "System",
      version: event.version,
      createdAt: event.created_at,
    })),
    canManageLifecycle: access.role === "superadmin" || access.role === "platform_admin",
    canResendOwnerInvitations: access.role === "superadmin",
    ownerInvitations: (invitationsResult.data || []).map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      status:
        invitation.status === "pending" && Date.parse(invitation.expires_at) <= Date.now()
          ? "expired"
          : invitation.status,
      expiresAt: invitation.expires_at,
      createdAt: invitation.created_at,
    })),
    mfaVerified: access.mfa_verified,
  };
}

export async function updateOrganizationLifecycle(input: unknown) {
  const parsed = organizationLifecycleMutationSchema.parse(input);
  const access = await requirePlatformCapability(
    "platform.agency_lifecycle.manage",
    { mfa: true },
  );
  const admin = createSupabaseAdminClient();
  const [{ data: current, error: currentError }, organizationResult] = await Promise.all([
    admin
    .from("organization_lifecycle")
    .select("status, version")
    .eq("organization_id", parsed.organizationId)
    .maybeSingle(),
    admin
      .from("organizations")
      .select("name")
      .eq("id", parsed.organizationId)
      .maybeSingle(),
  ]);
  if (currentError) throw currentError;
  if (organizationResult.error) throw organizationResult.error;
  if (!current || !organizationResult.data) {
    throw new Error("That agency no longer exists.");
  }
  if (parsed.confirmation !== organizationResult.data.name) {
    throw new Error("Enter the exact agency name to confirm this lifecycle change.");
  }
  if (current.version !== parsed.expectedVersion) {
    throw new Error("Agency status changed. Refresh and review the latest state.");
  }
  if (
    !canTransitionOrganizationLifecycle(
      current.status as OrganizationLifecycleStatus,
      parsed.status,
    )
  ) {
    throw new Error(
      `The agency cannot move directly from ${current.status} to ${parsed.status}.`,
    );
  }
  const { data, error } = await admin.rpc("set_organization_lifecycle_service", {
    target_organization_id: parsed.organizationId,
    target_status: parsed.status,
    actor_id: access.user_id,
    change_reason: parsed.reason,
    expected_version: parsed.expectedVersion,
  });
  if (error) throw error;
  return { success: true, lifecycle: data };
}

export async function provisionPlatformAgency(input: unknown) {
  const parsed = provisionPlatformAgencySchema.parse(input);
  const access = await requirePlatformCapability("platform.agencies.provision", {
    mfa: true,
  });
  if (parsed.confirmation !== parsed.slug) {
    throw new Error("Enter the exact agency slug to confirm provisioning.");
  }

  const invitationToken = randomBytes(32).toString("base64url");
  const invitationTokenHash = createHash("sha256")
    .update(invitationToken)
    .digest("hex");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("provision_organization_service", {
    organization_name: parsed.name,
    organization_slug: parsed.slug,
    owner_email: parsed.ownerEmail,
    invitation_token_hash: invitationTokenHash,
    actor_id: access.user_id,
    provision_reason: parsed.reason,
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error("That agency slug or pending owner invitation already exists.");
    }
    throw error;
  }
  const provisioned = data?.[0];
  if (!provisioned) throw new Error("The agency provisioning transaction returned no record.");

  let delivery: "sent" | "pending" = "pending";
  const origin = await getApplicationOrigin();
  if (origin) {
    try {
      await sendPlatformAgencyOwnerInvitationEmail({
        to: parsed.ownerEmail,
        organizationName: parsed.name,
        invitationUrl: `${origin}/auth/invite?token=${encodeURIComponent(invitationToken)}`,
        invitationId: provisioned.invitation_id,
      });
      delivery = "sent";
      await recordPlatformAudit(access.user_id, {
        eventType: "agency.owner_invitation.sent",
        entityType: "organization",
        entityId: provisioned.organization_id,
        metadata: { invitationId: provisioned.invitation_id },
      });
    } catch {
      await recordPlatformAudit(access.user_id, {
        eventType: "agency.owner_invitation.delivery_pending",
        entityType: "organization",
        entityId: provisioned.organization_id,
        metadata: {
          invitationId: provisioned.invitation_id,
          reason: "Platform email delivery was unavailable.",
        },
      });
    }
  } else {
    await recordPlatformAudit(access.user_id, {
      eventType: "agency.owner_invitation.delivery_pending",
      entityType: "organization",
      entityId: provisioned.organization_id,
      metadata: {
        invitationId: provisioned.invitation_id,
        reason: "Application origin is not configured.",
      },
    });
  }

  return {
    success: true,
    organizationId: provisioned.organization_id,
    lifecycleStatus: provisioned.lifecycle_status,
    invitationDelivery: delivery,
  };
}

export async function resendPlatformAgencyOwnerInvitation(input: unknown) {
  const parsed = resendPlatformInvitationSchema.parse(input);
  const access = await requirePlatformCapability("platform.agencies.provision", {
    mfa: true,
  });
  const admin = createSupabaseAdminClient();
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("name, slug")
    .eq("id", parsed.organizationId)
    .maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization) throw new Error("That agency no longer exists.");
  if (parsed.confirmation !== organization.slug) {
    throw new Error("Enter the exact agency slug to rotate this invitation.");
  }

  const invitationToken = randomBytes(32).toString("base64url");
  const replacementTokenHash = createHash("sha256")
    .update(invitationToken)
    .digest("hex");
  const { data, error } = await admin.rpc("resend_organization_invitation_service", {
    target_organization_id: parsed.organizationId,
    target_invitation_id: parsed.invitationId,
    replacement_token_hash: replacementTokenHash,
    actor_id: access.user_id,
    resend_reason: parsed.reason,
  });
  if (error) throw error;
  const invitation = data?.[0];
  if (!invitation) throw new Error("The invitation rotation returned no record.");

  const origin = await getApplicationOrigin();
  if (!origin) {
    await recordPlatformAudit(access.user_id, {
      eventType: "agency.owner_invitation.delivery_pending",
      entityType: "organization",
      entityId: parsed.organizationId,
      metadata: {
        invitationId: invitation.invitation_id,
        reason: "Application origin is not configured.",
      },
    });
    return { success: true, invitationDelivery: "pending" as const };
  }
  try {
    await sendPlatformAgencyOwnerInvitationEmail({
      to: invitation.invitation_email,
      organizationName: organization.name,
      invitationUrl: `${origin}/auth/invite?token=${encodeURIComponent(invitationToken)}`,
      invitationId: invitation.invitation_id,
    });
    await recordPlatformAudit(access.user_id, {
      eventType: "agency.owner_invitation.sent",
      entityType: "organization",
      entityId: parsed.organizationId,
      metadata: { invitationId: invitation.invitation_id },
    });
    return { success: true, invitationDelivery: "sent" as const };
  } catch {
    await recordPlatformAudit(access.user_id, {
      eventType: "agency.owner_invitation.delivery_pending",
      entityType: "organization",
      entityId: parsed.organizationId,
      metadata: {
        invitationId: invitation.invitation_id,
        reason: "Platform email delivery was unavailable.",
      },
    });
    return { success: true, invitationDelivery: "pending" as const };
  }
}

async function listAllAuthUsers() {
  const admin = createSupabaseAdminClient();
  const users: User[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (!data.nextPage) break;
  }
  return users;
}

async function profileNames(userIds: string[]) {
  const admin = createSupabaseAdminClient();
  const rows: Array<{ id: string; full_name: string | null }> = [];
  for (let index = 0; index < userIds.length; index += 400) {
    const batch = userIds.slice(index, index + 400);
    if (!batch.length) continue;
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", batch);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return new Map(rows.map((profile) => [profile.id, profile.full_name]));
}

async function mfaEnrollmentMap(userIds: string[]) {
  const admin = createSupabaseAdminClient();
  const entries = await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
      if (error) return [userId, null] as const;
      return [
        userId,
        data.factors.some(
          (factor) => factor.factor_type === "totp" && factor.status === "verified",
        ),
      ] as const;
    }),
  );
  return new Map<string, boolean | null>(entries);
}

export async function getPlatformIdentityAnomalies() {
  await requirePlatformCapability("platform.identities.read");
  const admin = createSupabaseAdminClient();
  const [users, operatorsResult, organizationsResult, lifecycleResult, ownerMembershipsResult] =
    await Promise.all([
      listAllAuthUsers(),
      admin
        .from("platform_admins")
        .select("user_id, role, status")
        .eq("status", "active"),
      admin.from("organizations").select("id, name, slug"),
      admin
        .from("organization_lifecycle")
        .select("organization_id, status")
        .in("status", ["provisioning", "active", "restricted"]),
      admin
        .from("memberships")
        .select("organization_id, user_id")
        .eq("role", "owner")
        .eq("status", "active"),
    ]);
  const firstError = [
    operatorsResult.error,
    organizationsResult.error,
    lifecycleResult.error,
    ownerMembershipsResult.error,
  ].find(Boolean);
  if (firstError) throw firstError;

  const usersById = new Map(users.map((user) => [user.id, user]));
  const activeOperators = operatorsResult.data || [];
  const operatorMfa = await mfaEnrollmentMap(
    activeOperators.map((operator) => operator.user_id),
  );
  const missingMfa = activeOperators
    .filter((operator) => operatorMfa.get(operator.user_id) === false)
    .map((operator) => {
      const user = usersById.get(operator.user_id);
      return {
        userId: operator.user_id,
        email: user?.email || "Email unavailable",
        role: operator.role,
      };
    });

  const dormantCutoff = Date.now() - 45 * 24 * 60 * 60 * 1_000;
  const dormantPrivileged = activeOperators
    .filter((operator) => {
      const lastSignIn = usersById.get(operator.user_id)?.last_sign_in_at;
      return !lastSignIn || Date.parse(lastSignIn) < dormantCutoff;
    })
    .map((operator) => {
      const user = usersById.get(operator.user_id);
      return {
        userId: operator.user_id,
        email: user?.email || "Email unavailable",
        role: operator.role,
        lastSignInAt: user?.last_sign_in_at || null,
      };
    });

  const organizations = new Map(
    (organizationsResult.data || []).map((organization) => [organization.id, organization]),
  );
  const organizationsWithOwner = new Set(
    (ownerMembershipsResult.data || []).map((membership) => membership.organization_id),
  );
  const orphanedAgencies = (lifecycleResult.data || [])
    .filter((lifecycle) => !organizationsWithOwner.has(lifecycle.organization_id))
    .flatMap((lifecycle) => {
      const organization = organizations.get(lifecycle.organization_id);
      return organization
        ? [{
            organizationId: organization.id,
            name: organization.name,
            slug: organization.slug,
            lifecycleStatus: lifecycle.status,
          }]
        : [];
    });

  return {
    generatedAt: new Date().toISOString(),
    dormantThresholdDays: 45,
    missingMfa: { total: missingMfa.length, items: missingMfa.slice(0, 12) },
    unknownMfaOperatorCount: activeOperators.filter(
      (operator) => operatorMfa.get(operator.user_id) === null,
    ).length,
    dormantPrivileged: {
      total: dormantPrivileged.length,
      items: dormantPrivileged.slice(0, 12),
    },
    orphanedAgencies: {
      total: orphanedAgencies.length,
      items: orphanedAgencies.slice(0, 12),
    },
    failedSignInCoverage: "external_auth_monitoring_required" as const,
  };
}

export async function getPlatformIdentities(input: unknown = {}) {
  const parsed = platformIdentityDirectorySchema.parse(input);
  const access = await requirePlatformCapability("platform.identities.read");
  const admin = createSupabaseAdminClient();
  let users: User[];
  let total: number;
  let names = new Map<string, string | null>();
  if (parsed.query) {
    const allUsers = await listAllAuthUsers();
    names = await profileNames(allUsers.map((user) => user.id));
    const normalized = parsed.query.toLocaleLowerCase();
    const filtered = allUsers.filter((user) =>
      [user.email || "", names.get(user.id) || ""]
        .some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
    total = filtered.length;
    const from = (parsed.page - 1) * parsed.pageSize;
    users = filtered.slice(from, from + parsed.pageSize);
  } else {
    const { data, error } = await admin.auth.admin.listUsers({
      page: parsed.page,
      perPage: parsed.pageSize,
    });
    if (error) throw error;
    users = data.users;
    total = data.total;
    names = await profileNames(users.map((user) => user.id));
  }
  const userIds = users.map((user) => user.id);
  const [memberships, platformOperators, securityControls, mfaEnrollment] = userIds.length
    ? await Promise.all([
        admin
          .from("memberships")
          .select("user_id, role, status")
          .in("user_id", userIds),
        admin
          .from("platform_admins")
          .select("user_id, role, status")
          .in("user_id", userIds),
        admin
          .from("identity_security_controls")
          .select("user_id, status, sessions_valid_after, password_reset_required, version")
          .in("user_id", userIds),
        mfaEnrollmentMap(userIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        new Map<string, boolean | null>(),
      ];
  if (memberships.error) throw memberships.error;
  if (platformOperators.error) throw platformOperators.error;
  if (securityControls.error) throw securityControls.error;
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    total,
    query: parsed.query,
    currentUserId: access.user_id,
    canManageIdentities: access.role === "superadmin",
    mfaVerified: access.mfa_verified,
    identities: users.map((user) => {
      const userMemberships = (memberships.data || []).filter(
        (membership) => membership.user_id === user.id,
      );
      const platformOperator = (platformOperators.data || []).find(
        (operator) => operator.user_id === user.id,
      );
      const securityControl = (securityControls.data || []).find(
        (control) => control.user_id === user.id,
      );
      return {
        userId: user.id,
        fullName: names.get(user.id) || "Unnamed account",
        email: user.email || null,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at || null,
        emailVerified: Boolean(user.email_confirmed_at),
        mfaEnrolled: mfaEnrollment.get(user.id) ?? null,
        status: securityControl?.status || ("active" as const),
        securityVersion: securityControl?.version || 1,
        sessionsValidAfter:
          securityControl?.sessions_valid_after || "1970-01-01T00:00:00.000Z",
        passwordResetRequired: securityControl?.password_reset_required || false,
        activeMembershipCount: userMemberships.filter(
          (membership) => membership.status === "active",
        ).length,
        membershipRoles: [...new Set(userMemberships.map((membership) => membership.role))],
        platformRole: platformOperator?.role || null,
        platformStatus: platformOperator?.status || null,
      };
    }),
  };
}

export async function getPlatformIdentityDetail(input: unknown) {
  const parsed = platformIdentityReferenceSchema.parse(input);
  const access = await requirePlatformCapability("platform.identities.read");
  const admin = createSupabaseAdminClient();
  const [authUser, profile, memberships, platformOperator, securityControl, events] =
    await Promise.all([
      admin.auth.admin.getUserById(parsed.userId),
      admin.from("profiles").select("full_name").eq("id", parsed.userId).maybeSingle(),
      admin
        .from("memberships")
        .select("organization_id, role, status, created_at, organizations(name, slug)")
        .eq("user_id", parsed.userId)
        .order("created_at", { ascending: false }),
      admin
        .from("platform_admins")
        .select("role, status, granted_at, updated_at")
        .eq("user_id", parsed.userId)
        .maybeSingle(),
      admin
        .from("identity_security_controls")
        .select("status, sessions_valid_after, password_reset_required, version, updated_at")
        .eq("user_id", parsed.userId)
        .single(),
      admin
        .from("identity_security_events")
        .select("id, actor_id, event_type, reason, version, created_at")
        .eq("user_id", parsed.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
  const firstError = [
    authUser.error,
    profile.error,
    memberships.error,
    platformOperator.error,
    securityControl.error,
    events.error,
  ].find(Boolean);
  if (firstError) throw firstError;
  if (!authUser.data.user || !securityControl.data) {
    throw new Error("That authentication account no longer exists.");
  }
  const actorIds = [
    ...new Set((events.data || []).flatMap((event) => event.actor_id ? [event.actor_id] : [])),
  ];
  const actorNames = await profileNames(actorIds);
  const user = authUser.data.user;
  const mfaEnrollment = await mfaEnrollmentMap([user.id]);
  const providerBanned = Boolean(
    user.banned_until && Date.parse(user.banned_until) > Date.now(),
  );
  return {
    currentUserId: access.user_id,
    canManageIdentities: access.role === "superadmin",
    mfaVerified: access.mfa_verified,
    identity: {
      userId: user.id,
      fullName: profile.data?.full_name || "Unnamed account",
      email: user.email || null,
      createdAt: user.created_at,
      updatedAt: user.updated_at || user.created_at,
      lastSignInAt: user.last_sign_in_at || null,
      emailVerified: Boolean(user.email_confirmed_at),
      mfaEnrolled: mfaEnrollment.get(user.id) ?? null,
      providerBanned,
    },
    security: {
      status: securityControl.data.status,
      sessionsValidAfter: securityControl.data.sessions_valid_after,
      passwordResetRequired: securityControl.data.password_reset_required,
      version: securityControl.data.version,
      updatedAt: securityControl.data.updated_at,
      providerStatusAligned:
        providerBanned === (securityControl.data.status === "suspended"),
    },
    platformAuthority: platformOperator.data
      ? {
          role: platformOperator.data.role,
          status: platformOperator.data.status,
          grantedAt: platformOperator.data.granted_at,
          updatedAt: platformOperator.data.updated_at,
        }
      : null,
    memberships: (memberships.data || []).map((membership) => ({
      organizationId: membership.organization_id,
      organizationName: membership.organizations?.name || "Travel workspace",
      organizationSlug: membership.organizations?.slug || "unavailable",
      role: membership.role,
      status: membership.status,
      createdAt: membership.created_at,
    })),
    events: (events.data || []).map((event) => ({
      id: event.id,
      eventType: event.event_type,
      reason: event.reason,
      version: event.version,
      createdAt: event.created_at,
      actorName: event.actor_id
        ? actorNames.get(event.actor_id) || "Platform operator"
        : "System",
    })),
  };
}

export async function updatePlatformIdentityStatus(input: unknown) {
  const parsed = platformIdentityStatusSchema.parse(input);
  const access = await requirePlatformCapability("platform.identities.manage", {
    mfa: true,
  });
  if (parsed.userId === access.user_id) {
    throw new Error("Use another superadmin to change your own account status.");
  }
  const admin = createSupabaseAdminClient();
  const { data: target, error: targetError } = await admin.auth.admin.getUserById(
    parsed.userId,
  );
  if (targetError || !target.user) {
    throw targetError || new Error("That account no longer exists.");
  }
  if (parsed.confirmation !== (target.user.email || parsed.userId)) {
    throw new Error("Enter the exact account email to confirm this security change.");
  }
  if (parsed.status === "active") {
    const { error: authError } = await admin.auth.admin.updateUserById(parsed.userId, {
      ban_duration: "none",
    });
    if (authError) throw authError;
  }
  const { data: securityControl, error: securityError } = await admin.rpc(
    "set_identity_security_status_service",
    {
      target_user_id: parsed.userId,
      target_status: parsed.status,
      actor_id: access.user_id,
      change_reason: parsed.reason,
      expected_version: parsed.expectedVersion,
    },
  );
  if (securityError) throw securityError;
  if (parsed.status === "suspended") {
    const { error: authError } = await admin.auth.admin.updateUserById(parsed.userId, {
      ban_duration: "876000h",
    });
    if (authError) throw authError;
  }
  return { success: true, status: parsed.status, securityControl };
}

export async function runPlatformIdentitySecurityAction(input: unknown) {
  const parsed = platformIdentitySecurityActionSchema.parse(input);
  const access = await requirePlatformCapability("platform.identities.manage", {
    mfa: true,
  });
  if (parsed.userId === access.user_id) {
    throw new Error("Use self-service security controls for your own account.");
  }
  const admin = createSupabaseAdminClient();
  const { data: target, error: targetError } = await admin.auth.admin.getUserById(
    parsed.userId,
  );
  if (targetError || !target.user) {
    throw targetError || new Error("That account no longer exists.");
  }
  if (parsed.confirmation !== (target.user.email || parsed.userId)) {
    throw new Error("Enter the exact account email to confirm this security change.");
  }
  const rpcName = parsed.action === "revoke_sessions"
    ? "revoke_identity_sessions_service"
    : "require_identity_password_reset_service";
  const { data, error } = await admin.rpc(rpcName, {
    target_user_id: parsed.userId,
    actor_id: access.user_id,
    change_reason: parsed.reason,
    expected_version: parsed.expectedVersion,
  });
  if (error) throw error;
  return { success: true, action: parsed.action, securityControl: data };
}

export async function getPlatformAccessDirectory() {
  const access = await requirePlatformCapability("platform.access.manage");
  const admin = createSupabaseAdminClient();
  const { data: operators, error } = await admin
    .from("platform_admins")
    .select("user_id, role, status, granted_by, granted_at, updated_at, version")
    .order("granted_at");
  if (error) throw error;
  const profileIds = [...new Set((operators || []).flatMap((operator) => [
    operator.user_id,
    ...(operator.granted_by ? [operator.granted_by] : []),
  ]))];
  const { data: profiles, error: profileError } = profileIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
  const operatorIds = (operators || []).map((operator) => operator.user_id);
  const [authUserEntries, mfaEnrollment] = await Promise.all([
    Promise.all(
      operatorIds.map(async (userId) => {
        const { data } = await admin.auth.admin.getUserById(userId);
        return [userId, data.user || null] as const;
      }),
    ),
    mfaEnrollmentMap(operatorIds),
  ]);
  const authUsers = new Map(authUserEntries);
  return {
    currentUserId: access.user_id,
    mfaVerified: access.mfa_verified,
    operators: (operators || []).map((operator) => {
      const authUser = authUsers.get(operator.user_id);
      return {
        userId: operator.user_id,
        fullName: names.get(operator.user_id) || "Platform operator",
        email: authUser?.email || null,
        emailVerified: Boolean(authUser?.email_confirmed_at),
        mfaEnrolled: mfaEnrollment.get(operator.user_id) ?? null,
        lastSignInAt: authUser?.last_sign_in_at || null,
        role: operator.role,
        status: operator.status,
        version: operator.version,
        grantedBy: operator.granted_by
          ? names.get(operator.granted_by) || "Platform operator"
          : "System bootstrap",
        grantedAt: operator.granted_at,
        updatedAt: operator.updated_at,
      };
    }),
  };
}

async function findAuthUserByEmail(email: string) {
  const admin = createSupabaseAdminClient();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === email,
    );
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

export async function grantPlatformAccess(input: unknown) {
  const parsed = grantPlatformAccessSchema.parse(input);
  const access = await requirePlatformCapability("platform.access.manage", {
    mfa: true,
  });
  const target = await findAuthUserByEmail(parsed.email);
  if (!target) {
    throw new Error("No registered AIOS account uses that email address.");
  }
  if (target.id === access.user_id) {
    throw new Error("Use another active superadmin to change your own platform access.");
  }
  if (parsed.confirmation !== target.email?.trim().toLowerCase()) {
    throw new Error("Enter the exact account email to confirm this access change.");
  }
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("platform_admins")
    .select("user_id, role, status, version")
    .eq("user_id", target.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    throw new Error("That account already has a platform access record. Use Review access instead.");
  }
  if (!target.email_confirmed_at) {
    throw new Error("The target account must verify its email before platform access can be granted.");
  }
  const { data: targetControl, error: targetControlError } = await admin
    .from("identity_security_controls")
    .select("status, password_reset_required")
    .eq("user_id", target.id)
    .maybeSingle();
  if (
    targetControlError ||
    !targetControl ||
    targetControl.status !== "active" ||
    targetControl.password_reset_required
  ) {
    throw new Error("The target account is not eligible for active platform access.");
  }
  const { data: targetFactors, error: targetFactorsError } =
    await admin.auth.admin.mfa.listFactors({ userId: target.id });
  if (targetFactorsError) {
    throw new Error("The target account's MFA enrollment could not be verified. Try again.");
  }
  if (!targetFactors.factors.some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  )) {
    throw new Error("The target account must enroll and verify an authenticator before platform access can be granted.");
  }
  const { data: operator, error } = await admin.rpc("set_platform_access_service", {
    target_user_id: target.id,
    target_role: parsed.role,
    target_status: "active",
    actor_id: access.user_id,
    change_reason: parsed.reason,
    expected_version: null,
  });
  if (error) throw error;
  if (!operator) throw new Error("Platform access was not returned after the update.");
  return { success: true, version: operator.version };
}

export async function updatePlatformAccess(input: unknown) {
  const parsed = updatePlatformAccessSchema.parse(input);
  const access = await requirePlatformCapability("platform.access.manage", {
    mfa: true,
  });
  if (parsed.userId === access.user_id) {
    throw new Error("Use another active superadmin to change your own platform access.");
  }
  const admin = createSupabaseAdminClient();
  const { data: target, error: targetError } = await admin
    .from("platform_admins")
    .select("user_id, role, status, version")
    .eq("user_id", parsed.userId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("That platform operator no longer exists.");
  if (target.version !== parsed.expectedVersion) {
    throw new Error("Platform access changed. Refresh and try again.");
  }
  const { data: targetIdentity, error: identityError } =
    await admin.auth.admin.getUserById(parsed.userId);
  if (identityError || !targetIdentity.user) {
    throw identityError || new Error("That account no longer exists.");
  }
  if (parsed.confirmation !== targetIdentity.user.email?.trim().toLowerCase()) {
    throw new Error("Enter the exact account email to confirm this access change.");
  }
  if (parsed.status === "active") {
    if (!targetIdentity.user.email_confirmed_at) {
      throw new Error("The target account must verify its email before active platform access can be assigned.");
    }
    const { data: targetControl, error: targetControlError } = await admin
      .from("identity_security_controls")
      .select("status, password_reset_required")
      .eq("user_id", parsed.userId)
      .maybeSingle();
    if (
      targetControlError ||
      !targetControl ||
      targetControl.status !== "active" ||
      targetControl.password_reset_required
    ) {
      throw new Error("The target account is not eligible for active platform access.");
    }
    const { data: targetFactors, error: targetFactorsError } =
      await admin.auth.admin.mfa.listFactors({ userId: parsed.userId });
    if (targetFactorsError) {
      throw new Error("The target account's MFA enrollment could not be verified. Try again.");
    }
    if (!targetFactors.factors.some(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    )) {
      throw new Error("The target account must enroll and verify an authenticator before active platform access can be assigned.");
    }
  }
  if (
    target.role === "superadmin" &&
    target.status === "active" &&
    (parsed.role !== "superadmin" || parsed.status !== "active")
  ) {
    const { count, error: countError } = await admin
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "superadmin")
      .eq("status", "active");
    if (countError) throw countError;
    if ((count ?? 0) <= 1) {
      throw new Error("At least one active platform superadmin is required.");
    }
  }
  const { data: operator, error } = await admin.rpc("set_platform_access_service", {
    target_user_id: parsed.userId,
    target_role: parsed.role,
    target_status: parsed.status,
    actor_id: access.user_id,
    change_reason: parsed.reason,
    expected_version: parsed.expectedVersion,
  });
  if (error) throw error;
  if (!operator) throw new Error("Platform access was not returned after the update.");
  return { success: true, version: operator.version };
}

export async function getPlatformAuditEvents(input: unknown = {}) {
  const parsed = platformAuditSchema.parse(input);
  await requirePlatformCapability("platform.audit.read");
  const admin = createSupabaseAdminClient();
  const from = (parsed.page - 1) * parsed.pageSize;
  const to = from + parsed.pageSize - 1;
  let query = admin
    .from("platform_audit_events")
    .select("id, actor_id, event_type, entity_type, entity_id, metadata, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (parsed.query) {
    const safeQuery = parsed.query.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim();
    query = query.or(`event_type.ilike.%${safeQuery}%,entity_type.ilike.%${safeQuery}%`);
  }
  const { data: events, count, error } = await query;
  if (error) throw error;
  const actorIds = [...new Set((events || []).flatMap((event) => (event.actor_id ? [event.actor_id] : [])))];
  const { data: profiles, error: profileError } = actorIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
  const safeMetadataKeys = new Set([
    "provider",
    "enabled",
    "result",
    "role",
    "status",
    "previousRole",
    "previousStatus",
    "nextRole",
    "nextStatus",
    "version",
    "reason",
    "expiresAt",
    "invitationId",
    "previousInvitationId",
    "deliveryStatus",
    "source",
  ]);
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    total: count ?? 0,
    query: parsed.query,
    events: (events || []).map((event) => ({
      id: event.id,
      actorName: event.actor_id
        ? names.get(event.actor_id) || "Platform operator"
        : "System",
      eventType: event.event_type,
      entityType: event.entity_type,
      entityId: event.entity_id,
      createdAt: event.created_at,
      metadata:
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? Object.fromEntries(
              Object.entries(event.metadata).filter(([key]) => safeMetadataKeys.has(key)),
            )
          : {},
    })),
  };
}

export async function savePlatformEmailIntegration(input: unknown) {
  const parsed = mutationSchema.parse(input);
  const access = await requirePlatformCapability("platform.email.manage", {
    mfa: true,
  });
  const actorId = access.user_id;
  const provider = parsed.provider;
  const inboundDisabledConfig =
    provider === "resend"
      ? { ...parsed.publicConfig, inboundEnabled: false, inboundAddress: "", receivingDomain: "" }
      : {
          ...parsed.publicConfig,
          inboundEnabled: false,
          inboundAddress: "",
          imapHost: "",
          imapPort: 993,
          imapSecurity: "tls",
          imapUsername: "",
          imapMailbox: "INBOX",
        };
  const publicConfig = parseIntegrationConfig(provider, inboundDisabledConfig);
  if (provider === "custom_smtp" && publicConfig.security === "none") {
    throw new Error("Platform SMTP must use STARTTLS or TLS.");
  }
  if (String(publicConfig.fromEmail).toLowerCase() !== PLATFORM_EMAIL) {
    throw new Error(`Platform email must use ${PLATFORM_EMAIL}.`);
  }
  const secretUpdates = parseSecretUpdates(provider, parsed.secretUpdates);
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("platform_integrations")
    .select("id, encrypted_secrets, created_by")
    .eq("provider", provider)
    .maybeSingle();
  if (existingError) throw existingError;
  const existingSecrets: IntegrationSecrets = existing
    ? decryptIntegrationSecrets(existing.encrypted_secrets)
    : {};
  let secrets: IntegrationSecrets;
  try {
    secrets = parseCompleteSecrets(provider, {
      ...existingSecrets,
      ...secretUpdates,
    });
  } catch {
    throw new Error("Enter every required platform email credential before saving.");
  }

  const { data: saved, error } = await admin
    .from("platform_integrations")
    .upsert(
      {
        provider,
        is_enabled: false,
        public_config: publicConfig,
        encrypted_secrets: encryptIntegrationSecrets(secrets),
        credential_hint: credentialHint(provider, secrets),
        encryption_version: 1,
        connection_status: "not_tested",
        last_tested_at: null,
        last_test_message: null,
        created_by: existing?.created_by ?? actorId,
        updated_by: actorId,
      },
      { onConflict: "provider" },
    )
    .select(
      "id, provider, is_enabled, public_config, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
    )
    .single();
  if (error) throw error;
  await recordPlatformAudit(actorId, {
    eventType: existing ? "record.updated" : "record.created",
    entityType: "platform_integration",
    entityId: saved.id,
    metadata: { provider, credentials_returned_to_client: false },
  });
  return toSummary(saved);
}

async function verifyPlatformProvider(
  provider: (typeof EMAIL_PROVIDERS)[number],
  config: IntegrationPublicConfig,
  secrets: IntegrationSecrets,
) {
  if (provider === "resend") {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${secrets.apiKey}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("The Resend account could not be verified.");
    return;
  }
  const originalHost = String(config.host);
  const resolvedHost = await resolvePublicHostname(originalHost);
  const transport = nodemailer.createTransport({
    host: resolvedHost,
    port: Number(config.port),
    secure: config.security === "tls",
    requireTLS: config.security === "starttls",
    ignoreTLS: config.security === "none",
    auth: { user: String(config.username), pass: secrets.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
    tls: { servername: originalHost, rejectUnauthorized: true },
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export async function testPlatformEmailIntegration(input: unknown) {
  const parsed = referenceSchema.parse(input);
  const access = await requirePlatformCapability("platform.email.manage", {
    mfa: true,
  });
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("platform_integrations")
    .select(
      "id, provider, is_enabled, public_config, encrypted_secrets, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
    )
    .eq("provider", parsed.provider)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new Error("Save the platform email provider before testing it.");
  const testedAt = new Date().toISOString();
  let connectionStatus: IntegrationConnectionStatus = "connected";
  let message = "Connection verified. No email was sent.";
  try {
    await verifyPlatformProvider(
      parsed.provider,
      existing.public_config as IntegrationPublicConfig,
      decryptIntegrationSecrets(existing.encrypted_secrets),
    );
  } catch {
    connectionStatus = "failed";
    message = "The platform email account could not be verified.";
  }
  const { data: updated, error } = await admin
    .from("platform_integrations")
    .update({
      is_enabled: false,
      connection_status: connectionStatus,
      last_tested_at: testedAt,
      last_test_message: message,
    })
    .eq("id", existing.id)
    .select(
      "id, provider, is_enabled, public_config, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
    )
    .single();
  if (error) throw error;
  await recordPlatformAudit(access.user_id, {
    eventType: "record.updated",
    entityType: "platform_integration",
    entityId: existing.id,
    metadata: { provider: parsed.provider, result: connectionStatus },
  });
  return toSummary(updated);
}

export async function setPlatformEmailProviderEnabled(input: unknown) {
  const parsed = z
    .strictObject({ provider: providerSchema, enabled: z.boolean() })
    .parse(input);
  const access = await requirePlatformCapability("platform.email.manage", {
    mfa: true,
  });
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("platform_integrations")
    .select("id, connection_status")
    .eq("provider", parsed.provider)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing || existing.connection_status !== "connected") {
    throw new Error("Verify the platform email connection before enabling it.");
  }
  if (parsed.enabled) {
    const { error: disableError } = await admin
      .from("platform_integrations")
      .update({ is_enabled: false, updated_by: access.user_id })
      .neq("provider", parsed.provider);
    if (disableError) throw disableError;
  }
  const { data: updated, error } = await admin
    .from("platform_integrations")
    .update({ is_enabled: parsed.enabled, updated_by: access.user_id })
    .eq("provider", parsed.provider)
    .select(
      "id, provider, is_enabled, public_config, credential_hint, connection_status, last_tested_at, last_test_message, updated_at",
    )
    .single();
  if (error) throw error;
  await recordPlatformAudit(access.user_id, {
    eventType: "record.updated",
    entityType: "platform_integration",
    entityId: updated.id,
    metadata: { provider: parsed.provider, enabled: parsed.enabled },
  });
  return toSummary(updated);
}
