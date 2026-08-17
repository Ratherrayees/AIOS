export type PlatformRoleValue = "superadmin" | "platform_admin";

export const PLATFORM_CAPABILITIES = [
  "platform.overview.read",
  "platform.agencies.read",
  "platform.agencies.provision",
  "platform.system.read",
  "platform.email.manage",
  "platform.audit.read",
  "platform.access.manage",
  "platform.agency_lifecycle.manage",
  "platform.identities.read",
  "platform.identities.manage",
  "platform.billing.read",
  "platform.billing.manage",
  "platform.usage.read",
] as const;

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

export type PlatformCapabilityAssuranceOptions = {
  /** @deprecated Platform capability checks require MFA by default. */
  mfa?: boolean;
};

export function platformCapabilityRequiresMfa(
  options: PlatformCapabilityAssuranceOptions = {},
) {
  void options;
  return true;
}

export const ORGANIZATION_LIFECYCLE_STATUSES = [
  "provisioning",
  "active",
  "restricted",
  "suspended",
  "archived",
] as const;

export type OrganizationLifecycleStatus =
  (typeof ORGANIZATION_LIFECYCLE_STATUSES)[number];

const ORGANIZATION_LIFECYCLE_TRANSITIONS: Record<
  OrganizationLifecycleStatus,
  readonly OrganizationLifecycleStatus[]
> = {
  provisioning: ["active", "suspended"],
  active: ["restricted", "suspended", "archived"],
  restricted: ["active", "suspended", "archived"],
  suspended: ["active", "restricted", "archived"],
  archived: ["active"],
};

export function allowedOrganizationLifecycleTransitions(
  current: OrganizationLifecycleStatus,
) {
  return [...ORGANIZATION_LIFECYCLE_TRANSITIONS[current]];
}

export function canTransitionOrganizationLifecycle(
  current: OrganizationLifecycleStatus,
  next: OrganizationLifecycleStatus,
) {
  return ORGANIZATION_LIFECYCLE_TRANSITIONS[current].includes(next);
}

const PLATFORM_ROLE_CAPABILITIES: Record<
  PlatformRoleValue,
  readonly PlatformCapability[]
> = {
  platform_admin: [
    "platform.overview.read",
    "platform.agencies.read",
    "platform.system.read",
    "platform.email.manage",
    "platform.audit.read",
    "platform.agency_lifecycle.manage",
    "platform.identities.read",
    "platform.billing.read",
    "platform.usage.read",
  ],
  superadmin: PLATFORM_CAPABILITIES,
};

export function platformRoleHasCapability(
  role: PlatformRoleValue,
  capability: PlatformCapability,
) {
  return PLATFORM_ROLE_CAPABILITIES[role].includes(capability);
}

export function platformCapabilitiesForRole(role: PlatformRoleValue) {
  return [...PLATFORM_ROLE_CAPABILITIES[role]];
}

export function canManagePlatformAccess(role: PlatformRoleValue) {
  return platformRoleHasCapability(role, "platform.access.manage");
}

export function platformRoleLabel(role: PlatformRoleValue) {
  return role === "superadmin" ? "Platform superadmin" : "Platform admin";
}

export function platformCapabilities(role: PlatformRoleValue) {
  return {
    reviewOverview: platformRoleHasCapability(role, "platform.overview.read"),
    reviewAgencies: platformRoleHasCapability(role, "platform.agencies.read"),
    provisionAgencies: platformRoleHasCapability(
      role,
      "platform.agencies.provision",
    ),
    reviewSystemHealth: platformRoleHasCapability(role, "platform.system.read"),
    configurePlatformEmail: platformRoleHasCapability(role, "platform.email.manage"),
    reviewPlatformAudit: platformRoleHasCapability(role, "platform.audit.read"),
    managePlatformAccess: canManagePlatformAccess(role),
    manageAgencyLifecycle: platformRoleHasCapability(
      role,
      "platform.agency_lifecycle.manage",
    ),
    reviewIdentities: platformRoleHasCapability(role, "platform.identities.read"),
    manageIdentities: platformRoleHasCapability(
      role,
      "platform.identities.manage",
    ),
    reviewBilling: platformRoleHasCapability(role, "platform.billing.read"),
    manageBilling: platformRoleHasCapability(role, "platform.billing.manage"),
    reviewUsage: platformRoleHasCapability(role, "platform.usage.read"),
    accessTenantRecordsWithoutMembership: false,
  } as const;
}
