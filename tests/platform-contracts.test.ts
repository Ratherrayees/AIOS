import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedOrganizationLifecycleTransitions,
  canManagePlatformAccess,
  canTransitionOrganizationLifecycle,
  platformCapabilities,
  platformCapabilityRequiresMfa,
  platformRoleHasCapability,
  platformRoleLabel,
} from "../lib/platform/contracts";
import { chooseAuthorityDestination } from "../lib/auth/authority-destination";

test("platform admin operates the control plane but cannot manage platform authority", () => {
  const capabilities = platformCapabilities("platform_admin");
  assert.equal(capabilities.reviewOverview, true);
  assert.equal(capabilities.reviewAgencies, true);
  assert.equal(capabilities.reviewSystemHealth, true);
  assert.equal(capabilities.configurePlatformEmail, true);
  assert.equal(capabilities.reviewPlatformAudit, true);
  assert.equal(capabilities.managePlatformAccess, false);
  assert.equal(capabilities.manageAgencyLifecycle, true);
  assert.equal(capabilities.reviewIdentities, true);
  assert.equal(capabilities.manageIdentities, false);
  assert.equal(capabilities.reviewBilling, true);
  assert.equal(capabilities.manageBilling, false);
  assert.equal(capabilities.reviewUsage, true);
  assert.equal(capabilities.accessTenantRecordsWithoutMembership, false);
});

test("superadmin alone can manage the independent platform access directory", () => {
  assert.equal(canManagePlatformAccess("superadmin"), true);
  assert.equal(canManagePlatformAccess("platform_admin"), false);
  assert.equal(platformCapabilities("superadmin").managePlatformAccess, true);
  assert.equal(platformCapabilities("superadmin").manageIdentities, true);
  assert.equal(platformCapabilities("superadmin").reviewBilling, true);
  assert.equal(platformCapabilities("superadmin").manageBilling, true);
  assert.equal(platformCapabilities("superadmin").reviewUsage, true);
  assert.equal(
    platformRoleHasCapability("platform_admin", "platform.identities.manage"),
    false,
  );
  assert.equal(
    platformRoleHasCapability("platform_admin", "platform.billing.manage"),
    false,
  );
});

test("platform role labels remain distinct from agency roles", () => {
  assert.equal(platformRoleLabel("superadmin"), "Platform superadmin");
  assert.equal(platformRoleLabel("platform_admin"), "Platform admin");
});

test("platform capability checks always require MFA", () => {
  assert.equal(platformCapabilityRequiresMfa(), true);
});

test("agency lifecycle permits only reviewed direct transitions", () => {
  assert.deepEqual(allowedOrganizationLifecycleTransitions("active"), [
    "restricted",
    "suspended",
    "archived",
  ]);
  assert.equal(canTransitionOrganizationLifecycle("suspended", "active"), true);
  assert.equal(canTransitionOrganizationLifecycle("active", "provisioning"), false);
  assert.equal(canTransitionOrganizationLifecycle("archived", "suspended"), false);
});

test("post-auth routing separates platform-only, agency-only, and dual authority", () => {
  assert.equal(
    chooseAuthorityDestination({
      requestedPath: "/",
      activeWorkspaceCount: 0,
      hasPlatformAccess: true,
    }),
    "/platform",
  );
  assert.equal(
    chooseAuthorityDestination({
      requestedPath: "/",
      activeWorkspaceCount: 2,
      hasPlatformAccess: true,
    }),
    "/choose-workspace",
  );
  assert.equal(
    chooseAuthorityDestination({
      requestedPath: "/",
      activeWorkspaceCount: 2,
      hasPlatformAccess: true,
      preferredAuthority: "platform",
    }),
    "/platform",
  );
  assert.equal(
    chooseAuthorityDestination({
      requestedPath: "/",
      activeWorkspaceCount: 2,
      hasPlatformAccess: true,
      preferredAuthority: "agency",
    }),
    "/",
  );
  assert.equal(
    chooseAuthorityDestination({
      requestedPath: "/",
      activeWorkspaceCount: 1,
      hasPlatformAccess: false,
    }),
    "/",
  );
  assert.equal(
    chooseAuthorityDestination({
      requestedPath: "/auth/invite?token=approved",
      activeWorkspaceCount: 0,
      hasPlatformAccess: true,
    }),
    "/auth/invite?token=approved",
  );
});
