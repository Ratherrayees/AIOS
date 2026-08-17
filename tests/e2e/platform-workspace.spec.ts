import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../types/app-database";

const shouldRun = process.env.RUN_AUTHENTICATED_E2E === "true";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const password = "PlatformE2e!2026#";

type AdminClient = SupabaseClient<Database>;

let admin: AdminClient | null = null;
let superadminId = "";
let platformAdminId = "";
let superadminEmail = "";
let platformAdminEmail = "";
let testOrganizationId = "";
let testAgencyName = "";

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test.describe("separate platform administration workspace", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.skip(
    !shouldRun || !supabaseUrl || !supabaseKey,
    "Set RUN_AUTHENTICATED_E2E=true and the Supabase test-project variables.",
  );

  test.beforeAll(async () => {
    if (!supabaseUrl || !supabaseKey) return;
    admin = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { count: existingSuperadmins, error: countError } = await admin
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "superadmin")
      .eq("status", "active");
    if (countError) throw countError;
    if (!existingSuperadmins) {
      throw new Error("The test project must retain one bootstrap superadmin.");
    }
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    superadminEmail = `platform.superadmin.${suffix}@example.com`;
    platformAdminEmail = `platform.admin.${suffix}@example.com`;
    const { data: superadminUser, error: superadminError } = await admin.auth.admin.createUser({
      email: superadminEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: "E2E Platform Superadmin" },
    });
    if (superadminError) throw superadminError;
    superadminId = superadminUser.user.id;
    const { data: platformAdminUser, error: platformAdminError } = await admin.auth.admin.createUser({
      email: platformAdminEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: "E2E Platform Admin" },
    });
    if (platformAdminError) throw platformAdminError;
    platformAdminId = platformAdminUser.user.id;
    const { error: grantError } = await admin.from("platform_admins").insert([
      { user_id: superadminId, role: "superadmin", status: "active", granted_by: superadminId },
      { user_id: platformAdminId, role: "platform_admin", status: "active", granted_by: superadminId },
    ]);
    if (grantError) throw grantError;
    testAgencyName = `E2E Boundary Agency ${suffix}`;
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .insert({ name: testAgencyName, slug: `e2e-boundary-${suffix}` })
      .select("id")
      .single();
    if (organizationError) throw organizationError;
    testOrganizationId = organization.id;
  });

  test.afterAll(async () => {
    if (!admin) return;
    if (testOrganizationId) {
      await admin.from("organizations").delete().eq("id", testOrganizationId);
    }
    if (superadminId || platformAdminId) {
      await admin.from("platform_admins").delete().in("user_id", [superadminId, platformAdminId].filter(Boolean));
    }
    if (superadminId) await admin.auth.admin.deleteUser(superadminId);
    if (platformAdminId) await admin.auth.admin.deleteUser(platformAdminId);
  });

  test("routes anonymous platform entry to a dedicated sign-in context", async ({ page }) => {
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fplatform$/);
    await expect(page.getByRole("heading", { name: "Platform administration." })).toBeVisible();
    await expect(page.getByText("PLATFORM CONTROL PLANE", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create your account" })).toHaveCount(0);
  });

  test("gives superadmin a distinct, responsive control plane without tenant records", async ({ page }) => {
    const browserProblems: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) browserProblems.push(message.text());
    });
    await signIn(page, superadminEmail);
    await expect(page).toHaveURL("/platform");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    const platformNavigation = page.getByRole("navigation", { name: "Platform navigation" });
    for (const label of ["Overview", "Agencies", "Users & security", "Plans & billing", "Usage & limits", "System health", "Platform email", "Audit log", "Platform access"]) {
      await expect(platformNavigation.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("navigation", { name: "CRM navigation" })).toHaveCount(0);
    await expect(page.locator(".platform-boundary-signal")).toContainText("Tenant data boundary enforced");
    await expect(page.locator(".platform-header-actions")).toContainText("MFA required");
    await expect(page.getByText("No agency membership", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Switch operating context" })).toHaveCount(0);

    for (const route of ["/platform/agencies", "/platform/identities", "/platform/billing", "/platform/usage", "/platform/system", "/platform/audit", "/platform/email", "/platform/access"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      await expect(page.locator("#main-content")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    await page.goto("/platform/identities", { waitUntil: "networkidle" });
    const superadminRow = page.getByRole("row").filter({ hasText: superadminEmail });
    await expect(superadminRow).toBeVisible();
    await expect(superadminRow.getByRole("button", { name: "Suspend" })).toBeDisabled();
    await superadminRow.getByRole("link", { name: "E2E Platform Superadmin" }).click();
    await expect(page.getByRole("heading", { name: "E2E Platform Superadmin" })).toBeVisible();
    await expect(page.getByText("Authentication metadata only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke all sessions" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Require password reset" })).toBeDisabled();

    await page.goto("/platform/agencies", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Provision agency" })).toBeDisabled();
    await page.getByRole("link", { name: testAgencyName, exact: true }).click();
    await expect(page.getByRole("heading", { name: testAgencyName })).toBeVisible();
    await expect(page.getByText("Operational metadata only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply lifecycle change" })).toBeDisabled();

    await page.goto("/platform/access", { waitUntil: "networkidle" });
    await page.getByText("Grant platform access", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Grant access" })).toBeDisabled();
    await page.goto("/platform/email");
    await expect(page.getByRole("button", { name: "Save and verify" }).first()).toBeDisabled();
    await page.goto("/platform/billing");
    await expect(page.getByRole("button", { name: "Create draft version" })).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/platform/agencies", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Open platform navigation" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.goto("/platform/billing", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Plans & billing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft version" })).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    expect(browserProblems).toEqual([]);
  });

  test("keeps platform admin operational but excludes superadmin authority and agency data", async ({ page }) => {
    await signIn(page, platformAdminEmail);
    await expect(page).toHaveURL("/platform");
    const navigation = page.getByRole("navigation", { name: "Platform navigation" });
    await expect(navigation.getByRole("link", { name: "Agencies" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Users & security" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Plans & billing" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Usage & limits" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "System health" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Platform access" })).toHaveCount(0);
    await page.goto("/platform/agencies");
    await expect(page.getByRole("button", { name: "Provision agency" })).toHaveCount(0);
    await page.goto("/platform/identities");
    await expect(page.getByRole("heading", { name: "Users & security" })).toBeVisible();
    await expect(page.getByText("Read only").first()).toBeVisible();
    await page.goto("/platform/billing");
    await expect(page.getByText("Commercial controls are read-only", { exact: true })).toBeVisible();
    await expect(page.getByText("Create a plan version", { exact: true })).toHaveCount(0);
    await page.goto("/platform/access");
    await expect(page.getByRole("heading", { name: "This route is not on the itinerary." })).toBeVisible();
    await page.goto("/contacts");
    const unavailable = page.getByRole("alert", { name: "Contacts are unavailable" });
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText("No active workspace is available for this account.");
    await expect(page.getByText("Traveller directory", { exact: true })).toHaveCount(0);
  });
});
