import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../types/app-database";

const shouldRun = process.env.RUN_AUTHENTICATED_E2E === "true";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

type AdminClient = SupabaseClient<Database>;

let admin: AdminClient | null = null;
let userId: string | null = null;
let organizationIds: string[] = [];
let email = "";
const password = "AuthE2e!2026#";
let primaryWorkspaceName = "";
let secondaryWorkspaceName = "";

test.describe("authenticated owner workspace", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !shouldRun || !supabaseUrl || !supabaseKey,
    "Set RUN_AUTHENTICATED_E2E=true and the Supabase test-project variables.",
  );

  test.beforeAll(async () => {
    if (!supabaseUrl || !supabaseKey) return;

    const suffix = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    email = `aios.e2e.${suffix}@example.com`;
    primaryWorkspaceName = `E2E Travel ${suffix}`;
    secondaryWorkspaceName = `E2E Operations ${suffix}`;
    admin = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: createdUser, error: userError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: "Authenticated E2E Owner" },
      });
    if (userError) throw userError;
    userId = createdUser.user.id;

    const { data: organizations, error: organizationError } = await admin
      .from("organizations")
      .insert([
        {
          name: primaryWorkspaceName,
          slug: `e2e-travel-${suffix}`,
        },
        {
          name: secondaryWorkspaceName,
          slug: `e2e-operations-${suffix}`,
        },
      ])
      .select("id, name");
    if (organizationError) throw organizationError;
    organizationIds = organizations.map((organization) => organization.id);

    const { error: membershipError } = await admin.from("memberships").insert(
      organizationIds.map((organizationId) => ({
        organization_id: organizationId,
        user_id: userId!,
        role: "owner" as const,
        status: "active" as const,
      })),
    );
    if (membershipError) throw membershipError;

    const { data: contact, error: contactError } = await admin
      .from("contacts")
      .insert({
        organization_id: organizationIds[0],
        first_name: "Aarav",
        last_name: "Sharma",
        email: `traveller.${suffix}@example.com`,
        owner_id: userId,
      })
      .select("id")
      .single();
    if (contactError) throw contactError;

    const { data: deal, error: dealError } = await admin
      .from("deals")
      .insert({
        organization_id: organizationIds[0],
        contact_id: contact.id,
        owner_id: userId,
        title: "Kyoto discovery journey",
        destination: "Kyoto, Japan",
        stage: "qualified",
        value_amount: 480000,
        currency: "INR",
      })
      .select("id")
      .single();
    if (dealError) throw dealError;

    const { error: taskError } = await admin.from("tasks").insert({
      organization_id: organizationIds[0],
      contact_id: contact.id,
      deal_id: deal.id,
      assignee_id: userId,
      title: "Confirm dietary and room preferences",
      status: "open",
    });
    if (taskError) throw taskError;
  });

  test.afterAll(async () => {
    if (!admin) return;
    if (organizationIds.length > 0) {
      await admin.from("organizations").delete().in("id", organizationIds);
    }
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  test("signs in, switches tenants, loads protected modules, and fits mobile", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: /Good morning, Rayees/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: new RegExp(primaryWorkspaceName) }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: new RegExp(primaryWorkspaceName) })
      .click();
    await expect(
      page.getByRole("menuitemradio", { name: secondaryWorkspaceName }),
    ).toBeVisible();
    await page
      .getByRole("menuitemradio", { name: secondaryWorkspaceName })
      .click();
    await expect(
      page.getByRole("button", { name: new RegExp(secondaryWorkspaceName) }),
    ).toBeVisible();

    const protectedRoutes = [
      ["/contacts", /Know every traveller/i],
      ["/inbox", /Keep every relationship conversation/i],
      ["/tasks", /Every follow-up has an owner/i],
      ["/quotes", /Shape a confident proposal/i],
      ["/itineraries", /Design the journey/i],
      ["/aios", /Set how autonomous/i],
      ["/settings/team", /Humans stay accountable/i],
      ["/settings/security", /One password should never/i],
    ] as const;

    for (const [route, heading] of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["/", "/aios"]) {
      await page.goto(route);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(0);
    }

    await page.goto("/");
    const mobileNavRows = await page
      .locator(".mobile-nav a")
      .evaluateAll(
        (links) =>
          new Set(links.map((link) => (link as HTMLElement).offsetTop)).size,
      );
    expect(mobileNavRows).toBe(1);
    await expect(
      page.getByRole("link", { name: "✦ Open AIOS workspace" }),
    ).toHaveAttribute("href", "/aios#lead-intake");
  });
});
