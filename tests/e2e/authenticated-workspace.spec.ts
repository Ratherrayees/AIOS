import { createHash, createHmac } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { travelerPortalSnapshotSchema } from "../../lib/crm/traveler-portal";
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
const teammatePassword = "TeammateE2e!2026#";
let primaryWorkspaceName = "";
let secondaryWorkspaceName = "";
let dealId = "";
let contactId = "";
let leadCaptureFormToken = "";
let approvalId = "";
let operationalTripId = "";
let operationalVoucherId = "";
let teammateUserId = "";
let teammateMembershipId = "";
const teammateName = "Authenticated E2E Teammate";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("button", { name: new RegExp(primaryWorkspaceName) }),
  ).toBeVisible();
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP setup key.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret: string) {
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(message)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

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

    const { data: createdTeammate, error: teammateError } =
      await admin.auth.admin.createUser({
        email: `aios.e2e.teammate.${suffix}@example.com`,
        password: teammatePassword,
        email_confirm: true,
        user_metadata: { full_name: teammateName },
      });
    if (teammateError) throw teammateError;
    teammateUserId = createdTeammate.user.id;

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

    const { data: teammateMembership, error: teammateMembershipError } =
      await admin
        .from("memberships")
        .insert({
          organization_id: organizationIds[0],
          user_id: teammateUserId,
          role: "agent",
          status: "active",
        })
        .select("id")
        .single();
    if (teammateMembershipError) throw teammateMembershipError;
    teammateMembershipId = teammateMembership.id;

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
    contactId = contact.id;

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
        source: "E2E Website",
        probability: 65,
        next_step: "Present the refined Kyoto itinerary",
        expected_close_at: "2026-08-31",
      })
      .select("id")
      .single();
    if (dealError) throw dealError;
    dealId = deal.id;

    const { error: taskError } = await admin.from("tasks").insert({
      organization_id: organizationIds[0],
      contact_id: contact.id,
      deal_id: deal.id,
      assignee_id: userId,
      title: "Confirm dietary and room preferences",
      status: "open",
    });
    if (taskError) throw taskError;

    const { data: captureForm, error: captureFormError } = await admin
      .from("lead_capture_forms")
      .insert({
        organization_id: organizationIds[0],
        name: "E2E website capture",
        headline: "Plan an extraordinary journey",
        source: "E2E Website",
        default_owner_id: userId,
        first_response_minutes: 15,
        created_by: userId,
      })
      .select("public_token")
      .single();
    if (captureFormError) throw captureFormError;
    leadCaptureFormToken = captureForm.public_token;

    const { data: approval, error: approvalError } = await admin
      .from("approval_requests")
      .insert({
        organization_id: organizationIds[0],
        requester_id: userId,
        action: "crm.fixture.review",
        entity_type: "deal",
        entity_id: deal.id,
        rationale: "E2E approval needs a deliberate human decision.",
      })
      .select("id")
      .single();
    if (approvalError) throw approvalError;
    approvalId = approval.id;
  });

  test.afterAll(async () => {
    if (!admin) return;
    if (organizationIds.length > 0) {
      const { data: documents } = await admin
        .from("documents")
        .select("storage_path")
        .in("organization_id", organizationIds);
      if (documents?.length) {
        await admin.storage
          .from("travel-documents")
          .remove(documents.map((document) => document.storage_path));
      }
      await admin.from("organizations").delete().in("id", organizationIds);
    }
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (teammateUserId) await admin.auth.admin.deleteUser(teammateUserId);
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
      page.getByRole("heading", {
        name: /Welcome back, Authenticated\. Start with what needs attention/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Authenticated E2E Owner Owner · Sign out/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Make AIOS fit your agency" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Follow the customer, not the software." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "How AIOS works" }).click();
    await expect(
      page.getByRole("dialog", { name: "How the CRM fits together" }),
    ).toBeVisible();
    await expect(page.getByText("Human authority is non-bypassable")).toBeVisible();
    await page.getByRole("button", { name: "Close product guide" }).click();
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
      ["/trips", /From “won” to wheels up/i],
      ["/finance", /Know what is owed/i],
      ["/aios", /Set how autonomous/i],
      ["/analytics", /See where momentum becomes revenue/i],
      ["/settings/lead-capture", /Lead capture that enters/i],
      ["/settings/sales-workflows", /Qualify consistently/i],
      ["/settings/team", /Humans stay accountable/i],
      ["/settings/security", /One password should never/i],
    ] as const;

    for (const [route, heading] of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.locator(".ui-workspace-guide")).toBeVisible();
    }

    await page.goto("/?view=leads");
    await expect(
      page.getByRole("heading", { name: "Lead pipeline" }),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [
      "/",
      "/contacts",
      "/inbox",
      "/tasks",
      "/quotes",
      "/itineraries",
      "/trips",
      "/finance",
      "/aios",
      "/analytics",
      "/settings/lead-capture",
      "/settings/sales-workflows",
      "/settings/team",
      "/settings/security",
      `/leads/${dealId}`,
    ]) {
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
    await page.getByRole("button", { name: "More" }).click();
    await expect(
      page.getByRole("dialog", { name: "All workspace areas" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sales workflows", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close workspace navigation" })
      .click();
    await expect(
      page.locator('a[href="/aios#lead-intake"]'),
    ).toContainText("Open AIOS");
  });

  test("captures a public lead through the governed endpoint", async ({
    page,
  }) => {
    const capturedEmail = `public.${Date.now()}@example.com`;
    await page.goto(
      `/lead/${leadCaptureFormToken}?utm_source=e2e&utm_medium=browser&utm_campaign=release`,
    );
    await expect(
      page.getByRole("heading", { name: /Plan an extraordinary journey/i }),
    ).toBeVisible();
    await page.getByLabel("Your name").fill("Public E2E Traveller");
    await page.getByLabel("Email").fill(capturedEmail);
    await page.getByLabel("Dream destination").fill("Reykjavík, Iceland");
    await page.getByLabel("Approximate budget").fill("650000");
    await page.getByLabel(/I agree to be contacted/i).check();
    await page.waitForTimeout(1_050);
    const captureResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/public/leads/${leadCaptureFormToken}`),
    );
    await page.getByRole("button", { name: "Design my journey" }).click();
    const captureResponse = await captureResponsePromise;
    const capturePayload = await captureResponse.json();
    expect(
      captureResponse.ok(),
      JSON.stringify(capturePayload),
    ).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Request received" }),
    ).toBeVisible();

    const { data: submission, error } = await admin!
      .from("lead_submissions")
      .select("status, deal_id, utm_source, utm_campaign")
      .eq("organization_id", organizationIds[0])
      .eq("email", capturedEmail)
      .single();
    expect(error).toBeNull();
    expect(submission).toMatchObject({
      status: "converted",
      utm_source: "e2e",
      utm_campaign: "release",
    });
    expect(submission?.deal_id).toBeTruthy();
  });

  test("records response, advances a governed deal, and exposes analytics", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    await page.goto(`/leads/${dealId}`);
    await page.getByRole("button", { name: "Mark first response" }).click();
    await expect(page.getByRole("status")).toContainText(
      "First response recorded",
    );

    await page.getByLabel("Win probability").fill("65");
    await page.getByLabel("Opportunity value").fill("480000");
    await page.getByLabel("Destination").fill("Kyoto, Japan");
    await page.getByLabel("Expected close").fill("2026-08-31");
    await page
      .getByLabel("Next commercial step")
      .fill("Present the refined Kyoto itinerary");
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Commercial plan saved",
    );

    await page.getByLabel("Pipeline stage").selectOption("proposal");
    await page.getByRole("button", { name: "Update stage" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Opportunity moved to proposal",
    );

    await page.goto("/analytics");
    await expect(
      page.getByRole("heading", { name: /See where momentum becomes revenue/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: /E2E Website/ }),
    ).toBeVisible();
    await page.goto("/settings/lead-capture");
    await expect(page.getByText("E2E website capture")).toBeVisible();
  });

  test("resolves a human approval and secures a traveller document", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    await page.goto("/aios");
    const approvalCard = page
      .locator(".aios-approvals article")
      .filter({ hasText: "E2E approval needs a deliberate human decision." });
    await expect(approvalCard).toBeVisible();
    await approvalCard.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status")).toContainText("Approval approved");
    await expect(approvalCard).toHaveCount(0);

    const { data: approval, error: approvalError } = await admin!
      .from("approval_requests")
      .select("status, approver_id, resolved_at")
      .eq("id", approvalId)
      .single();
    expect(approvalError).toBeNull();
    expect(approval?.status).toBe("approved");
    expect(approval?.approver_id).toBe(userId);
    expect(approval?.resolved_at).toBeTruthy();

    await page.goto(`/leads/${dealId}`);
    await page.getByLabel("Travel document").setInputFiles({
      name: "passport-scan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
      ),
    });
    await page.getByRole("button", { name: "Secure document" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Travel document encrypted in private storage",
    );
    await expect(
      page.getByText("passport-scan.pdf", { exact: true }),
    ).toBeVisible();

    const { data: document, error: documentError } = await admin!
      .from("documents")
      .select(
        "id, organization_id, contact_id, uploaded_by, storage_path, file_name, mime_type, byte_size",
      )
      .eq("organization_id", organizationIds[0])
      .eq("file_name", "passport-scan.pdf")
      .single();
    expect(documentError).toBeNull();
    expect(document).toMatchObject({
      organization_id: organizationIds[0],
      uploaded_by: userId,
      file_name: "passport-scan.pdf",
      mime_type: "application/pdf",
    });
    expect(document?.storage_path).toMatch(
      new RegExp(`^${organizationIds[0]}/${document!.id}/`),
    );

    const { data: storedFile, error: storageError } = await admin!.storage
      .from("travel-documents")
      .download(document!.storage_path);
    expect(storageError).toBeNull();
    expect(await storedFile!.text()).toContain("%PDF-1.4");
  });

  test("gates advancement with reusable qualification evidence and schedules internal follow-up", async ({
    page,
  }) => {
    const qualificationName = `E2E premium qualification ${Date.now()}`;
    const sequenceName = `E2E qualified momentum ${Date.now()}`;

    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    await page.goto("/settings/sales-workflows");
    await page.getByLabel("Qualification template name").fill(
      qualificationName,
    );
    await page
      .getByLabel("Checklist items")
      .fill(
        "Confirm travel dates :: Record flexibility\n? Record visa support preference",
      );
    await page.getByRole("button", { name: "Create checklist" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Qualification checklist is ready",
    );
    await expect(page.getByText(qualificationName, { exact: true })).toBeVisible();

    await page.getByLabel("Follow-up sequence name").fill(sequenceName);
    await page
      .getByLabel("Sequence steps")
      .fill(
        "0 | Confirm the traveller brief\n2 | Review itinerary direction",
      );
    await page
      .getByRole("button", { name: "Create internal sequence" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Internal follow-up sequence is ready",
    );
    await expect(page.getByText(sequenceName, { exact: true })).toBeVisible();

    await page.goto(`/leads/${dealId}`);
    await page.getByLabel("Reusable checklist").selectOption({
      label: qualificationName,
    });
    await page.getByRole("button", { name: "Apply checklist" }).click();
    await expect(page.getByRole("status")).toContainText(
      "2 qualification checks added",
    );

    await page.getByLabel("Pipeline stage").selectOption("decision");
    await page.getByRole("button", { name: "Update stage" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Complete every required qualification check",
    );

    await page
      .getByRole("checkbox", { name: /Confirm travel dates/i })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Qualification evidence recorded",
    );

    await page.getByRole("button", { name: "Update stage" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Opportunity moved to decision",
    );

    await page.getByLabel("Internal sequence").selectOption({
      label: sequenceName,
    });
    await page
      .getByRole("button", { name: "Create sequence tasks" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "2 internal follow-up tasks created",
    );

    const { data: checks, error: checksError } = await admin!
      .from("deal_qualification_checks")
      .select("is_required, is_complete, completed_by, completed_at")
      .eq("organization_id", organizationIds[0])
      .eq("deal_id", dealId);
    expect(checksError).toBeNull();
    expect(checks).toHaveLength(2);
    expect(
      checks?.filter((check) => check.is_required).every(
        (check) =>
          check.is_complete &&
          check.completed_by === userId &&
          Boolean(check.completed_at),
      ),
    ).toBe(true);

    const { data: tasks, error: tasksError } = await admin!
      .from("tasks")
      .select("title, assignee_id, due_at")
      .eq("organization_id", organizationIds[0])
      .eq("deal_id", dealId)
      .in("title", [
        "Confirm the traveller brief",
        "Review itinerary direction",
      ]);
    expect(tasksError).toBeNull();
    expect(tasks).toHaveLength(2);
    expect(
      tasks?.every(
        (task) => task.assignee_id === userId && Boolean(task.due_at),
      ),
    ).toBe(true);

    const { count: runCount, error: runError } = await admin!
      .from("deal_follow_up_sequence_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationIds[0])
      .eq("deal_id", dealId);
    expect(runError).toBeNull();
    expect(runCount).toBe(1);
  });

  test("moves a pipeline card by governed drag and accessible stage selection", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/");

    await page
      .locator("button.nav-link")
      .filter({ hasText: "Leads" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Lead pipeline" }),
    ).toBeVisible();
    await expect(page.getByText("Governed pipeline:")).toBeVisible();

    const decisionColumn = page.getByLabel("Decision stage");
    const proposalColumn = page.getByLabel("Proposal stage");
    const decisionCard = decisionColumn
      .locator(".lead-card")
      .filter({ hasText: "Kyoto discovery journey" });
    await expect(decisionCard).toBeVisible();
    await decisionCard.dragTo(proposalColumn);
    await expect(page.getByRole("status")).toContainText(
      "Kyoto discovery journey moved to Proposal",
    );

    const proposalCard = proposalColumn
      .locator(".lead-card")
      .filter({ hasText: "Kyoto discovery journey" });
    await expect(proposalCard).toBeVisible();
    const stageSelector = proposalCard.getByLabel(
      "Move Kyoto discovery journey to stage",
    );
    await expect(stageSelector.locator("option")).toHaveText([
      "Choose a legal next stage…",
      "Qualified",
      "Decision",
    ]);
    await stageSelector.selectOption("decision");
    await expect(page.getByRole("status")).toContainText(
      "Kyoto discovery journey moved to Decision",
    );
    await expect(
      decisionColumn
        .locator(".lead-card")
        .filter({ hasText: "Kyoto discovery journey" }),
    ).toBeVisible();

    const { data: deal, error } = await admin!
      .from("deals")
      .select("stage")
      .eq("id", dealId)
      .single();
    expect(error).toBeNull();
    expect(deal?.stage).toBe("decision");
  });

  test("wires command-center search, lead creation, and private pipeline views", async ({
    page,
  }) => {
    const leadName = `E2E command lead ${Date.now()}`;
    const viewName = `E2E command view ${Date.now()}`;
    await signIn(page);

    await expect(page.locator(".ai-brief-list button")).toHaveCount(0);
    await expect(
      page.locator("a.ask-bar"),
    ).toHaveAttribute("href", "/aios");

    await page
      .getByRole("button", { name: /Search leads, contacts, and tasks/i })
      .click();
    await page
      .getByPlaceholder("Search leads, contacts, or tasks…")
      .fill("Kyoto discovery");
    await expect(
      page.getByRole("link", { name: /Kyoto discovery journey/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /New lead/i }).click();
    await page.getByLabel("Traveller name").fill(leadName);
    await page.getByLabel("Destination or journey").fill("Ladakh, India");
    await page.getByLabel("Estimated trip value").fill("3.25L");
    await page.getByLabel("Initial win probability").fill("25");
    await page.getByLabel("Next step").fill("Confirm departure city");
    await page.getByLabel("Expected close date").fill("2026-08-20");
    await page.getByRole("button", { name: /Create lead/i }).click();
    await expect(page.getByText(`${leadName} is now in your live pipeline.`)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Lead pipeline" }),
    ).toBeVisible();

    await page.getByLabel("Search leads").fill(leadName);
    await page
      .locator(".lead-filters label")
      .filter({ hasText: "Stage" })
      .locator("select")
      .selectOption("new");
    await page.getByLabel("Name this Leads view").fill(viewName);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByText(/private Leads view/i)).toBeVisible();

    const { data: createdDeal, error: dealError } = await admin!
      .from("deals")
      .select("title, stage, value_amount, destination, probability, next_step")
      .eq("organization_id", organizationIds[0])
      .eq("title", leadName)
      .single();
    expect(dealError).toBeNull();
    expect(createdDeal).toMatchObject({
      title: leadName,
      stage: "new",
      value_amount: 325000,
      destination: "Ladakh, India",
      probability: 25,
      next_step: "Confirm departure city",
    });

    const { data: savedView, error: savedViewError } = await admin!
      .from("saved_views")
      .select("id, feature, name, filters")
      .eq("organization_id", organizationIds[0])
      .eq("user_id", userId!)
      .eq("feature", "leads")
      .eq("name", viewName)
      .single();
    expect(savedViewError).toBeNull();
    expect(savedView?.filters).toMatchObject({
      query: leadName,
      stage: "new",
    });

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(/private Leads view was removed/i)).toBeVisible();
    const { count: remainingViewCount } = await admin!
      .from("saved_views")
      .select("id", { count: "exact", head: true })
      .eq("id", savedView!.id);
    expect(remainingViewCount).toBe(0);
  });

  test("wires contacts, companies, ownership, consent, notes, imports, and saved views", async ({
    page,
  }) => {
    const suffix = Date.now();
    const companyName = `E2E Company ${suffix}`;
    const contactName = `E2E Traveller ${suffix}`;
    const contactEmail = `contact.${suffix}@example.com`;
    const importedEmail = `imported.${suffix}@example.com`;
    const note = `E2E private contact note ${suffix}`;
    const viewName = `E2E contact view ${suffix}`;
    await signIn(page);
    await page.goto("/contacts");

    await page.getByLabel("New company").fill(companyName);
    await page.getByRole("button", { name: "Add company" }).click();
    await expect(page.getByRole("status")).toContainText(
      `${companyName} is ready`,
    );

    await page.getByLabel("New contact").fill(contactName);
    await page
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(contactEmail);
    await page
      .getByRole("textbox", { name: "Phone", exact: true })
      .fill("+91 98765 43210");
    await page
      .getByRole("combobox", { name: "Company", exact: true })
      .selectOption({ label: companyName });
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByRole("status")).toContainText(
      `${contactName} is now in your CRM`,
    );

    await page.getByLabel("Contact owner").selectOption(teammateUserId);
    await expect(page.getByRole("status")).toContainText(
      "Contact ownership updated",
    );
    await page.getByLabel("Consent status").selectOption("granted");
    await page.getByLabel("Recorded source").fill("E2E written consent");
    await page.getByLabel("Preferred channel").selectOption("whatsapp");
    await page.getByLabel("Locale").fill("en-IN");
    await page.getByLabel("Time zone").fill("Asia/Kolkata");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Communication preferences recorded",
    );

    await page.getByPlaceholder("Add a private CRM note…").fill(note);
    await page.getByRole("button", { name: "Record note" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Timeline note recorded",
    );

    await page.getByLabel(/Paste CSV contacts/i).fill(
      `Imported Traveller, ${importedEmail}, +91 90000 00000`,
    );
    await page.getByRole("button", { name: "Import up to 100" }).click();
    await expect(page.getByRole("status")).toContainText(
      "1 contacts imported",
    );

    await page.getByLabel("Search contacts").fill(contactName);
    await page.getByPlaceholder("Name this search").fill(viewName);
    await page
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "private Contacts view",
    );

    const { data: company, error: companyError } = await admin!
      .from("companies")
      .select("id")
      .eq("organization_id", organizationIds[0])
      .eq("name", companyName)
      .single();
    expect(companyError).toBeNull();
    const { data: contact, error: contactError } = await admin!
      .from("contacts")
      .select(
        "id, company_id, owner_id, communication_consent, consent_source, preferred_channel, preferred_locale, time_zone",
      )
      .eq("organization_id", organizationIds[0])
      .eq("email", contactEmail)
      .single();
    expect(contactError).toBeNull();
    expect(contact).toMatchObject({
      company_id: company!.id,
      owner_id: teammateUserId,
      communication_consent: "granted",
      consent_source: "E2E written consent",
      preferred_channel: "whatsapp",
      preferred_locale: "en-IN",
      time_zone: "Asia/Kolkata",
    });
    const { count: noteCount } = await admin!
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationIds[0])
      .eq("contact_id", contact!.id)
      .eq("body", note);
    expect(noteCount).toBe(1);
    const { count: importedCount } = await admin!
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationIds[0])
      .eq("email", importedEmail);
    expect(importedCount).toBe(1);

    await page.getByRole("button", { name: "Remove selected view" }).click();
    await expect(page.getByRole("status")).toContainText(
      "private saved view was removed",
    );
  });

  test("requires a human-reviewed duplicate merge and preserves one live contact", async ({
    page,
  }) => {
    const suffix = Date.now();
    const companyName = `E2E duplicate company ${suffix}`;
    const firstEmail = `duplicate.first.${suffix}@example.com`;
    const secondEmail = `duplicate.second.${suffix}@example.com`;
    await signIn(page);
    await page.goto("/contacts");

    await page.getByLabel("New company").fill(companyName);
    await page.getByRole("button", { name: "Add company" }).click();
    await expect(page.getByRole("status")).toContainText(
      `${companyName} is ready`,
    );
    await page.getByLabel("New contact").fill("Duplicate Review Person");
    await page
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(firstEmail);
    await page
      .getByRole("combobox", { name: "Company", exact: true })
      .selectOption({ label: companyName });
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByRole("status")).toContainText("is now in your CRM");

    await page.getByLabel("New contact").fill("Duplicate Review Person");
    await page
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(secondEmail);
    await page
      .getByRole("combobox", { name: "Company", exact: true })
      .selectOption({ label: companyName });
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByText(/Matched by name \+ company/i)).toBeVisible();

    const { data: candidateRows, error: candidateError } = await admin!
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationIds[0])
      .in("email", [firstEmail, secondEmail]);
    expect(candidateError).toBeNull();
    expect(candidateRows).toHaveLength(2);

    await page.getByRole("button", { name: "Keep older record" }).click();
    await expect(page.locator(".merge-confirmation")).toContainText(
      "Archive the other record",
    );
    await page.getByRole("button", { name: "Confirm merge" }).click();
    await expect(page.getByRole("status")).toContainText(
      "surviving contact record",
    );

    const { data: duplicateRows, error } = await admin!
      .from("contacts")
      .select("first_name, archived_at")
      .eq("organization_id", organizationIds[0])
      .in(
        "id",
        candidateRows!.map((candidate) => candidate.id),
      );
    expect(error).toBeNull();
    expect(duplicateRows).toHaveLength(2);
    expect(duplicateRows?.filter((row) => row.archived_at === null)).toHaveLength(
      1,
    );
  });

  test("wires Inbox ownership, SLA, templates, review drafts, notes, and views", async ({
    page,
  }) => {
    const suffix = Date.now();
    const subject = `E2E conversation ${suffix}`;
    const templateName = `E2E response ${suffix}`;
    const draftSubject = `E2E draft ${suffix}`;
    const note = `E2E internal Inbox note ${suffix}`;
    const viewName = `E2E Inbox view ${suffix}`;
    await signIn(page);
    await page.goto("/inbox");

    await page.getByLabel("Conversation contact").selectOption(contactId);
    await page.getByLabel("Conversation opportunity").selectOption(dealId);
    await page.getByPlaceholder("Start an internal conversation").fill(subject);
    await page.getByRole("button", { name: "Open conversation" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Internal conversation opened",
    );
    await page.getByLabel("Workflow status").selectOption("pending");
    await expect(page.getByRole("status")).toContainText(
      "Conversation marked pending",
    );
    await page.getByLabel("Workflow status").selectOption("open");
    await expect(page.getByRole("status")).toContainText(
      "Conversation marked open",
    );
    await page
      .locator("section.thread label")
      .filter({ hasText: /^Owner/ })
      .locator("select")
      .selectOption(teammateUserId);
    await expect(page.getByRole("status")).toContainText(
      "Conversation ownership updated",
    );
    await page.getByLabel("Priority").selectOption("urgent");
    await page.getByLabel("Respond by").fill("2026-07-27T09:00");
    await page.getByRole("button", { name: "Save SLA" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Response priority and deadline recorded",
    );

    await page.getByLabel("Template name").fill(templateName);
    await page.getByLabel("Template subject").fill(draftSubject);
    await page
      .getByLabel("Template body")
      .fill("A reviewed response template for the traveller.");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("status")).toContainText(
      `${templateName}” saved`,
    );

    await page
      .locator("section.thread-drafts form label")
      .filter({ hasText: /^Template/ })
      .locator("select")
      .selectOption({ label: `${templateName} · email` });
    const draftBody = page.getByRole("textbox", { name: "Draft", exact: true });
    await expect(draftBody).toHaveValue(
      "A reviewed response template for the traveller.",
    );
    await page
      .locator("section.thread-drafts form label")
      .filter({ hasText: /^Workflow/ })
      .locator("select")
      .selectOption("ready_for_review");
    await page.getByRole("button", { name: "Save internal draft" }).click();
    await expect(page.getByRole("status")).toContainText(
      "queued for human review",
    );
    await page.getByRole("button", { name: "Edit" }).click();
    await draftBody.fill(
      "A revised human-reviewed response for the traveller.",
    );
    await page.getByRole("button", { name: "Save revision" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Internal draft revised",
    );

    await page
      .getByPlaceholder("Write an internal note—this will not email anyone")
      .fill(note);
    await page.getByRole("button", { name: "Record note" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Internal note recorded",
    );

    await page.getByLabel("Search conversations").fill(subject);
    await page.getByLabel("Name this Inbox view").fill(viewName);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("status")).toContainText(
      "private Inbox view",
    );
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("status")).toContainText(
      "private Inbox view was removed",
    );
    await page.getByRole("button", { name: "Retire" }).click();
    await expect(page.getByRole("status")).toContainText(
      `${templateName}” retired`,
    );

    const { data: conversation, error: conversationError } = await admin!
      .from("conversations")
      .select("id, status, assignee_id, priority, response_due_at")
      .eq("organization_id", organizationIds[0])
      .eq("subject", subject)
      .single();
    expect(conversationError).toBeNull();
    expect(conversation).toMatchObject({
      status: "open",
      assignee_id: teammateUserId,
      priority: "urgent",
    });
    expect(conversation?.response_due_at).toBeTruthy();
    const { data: drafts, error: draftError } = await admin!
      .from("message_drafts")
      .select("status, subject, body")
      .eq("organization_id", organizationIds[0])
      .eq("conversation_id", conversation!.id);
    expect(draftError).toBeNull();
    expect(drafts).toContainEqual(
      expect.objectContaining({
        status: "ready_for_review",
        subject: draftSubject,
        body: "A revised human-reviewed response for the traveller.",
      }),
    );
    const { count: messageCount } = await admin!
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation!.id)
      .eq("body", note);
    expect(messageCount).toBe(1);
    const { data: template, error: templateError } = await admin!
      .from("message_templates")
      .select("is_active")
      .eq("organization_id", organizationIds[0])
      .eq("name", templateName)
      .single();
    expect(templateError).toBeNull();
    expect(template?.is_active).toBe(false);
  });

  test("wires task creation, ownership, lifecycle, filters, and saved views", async ({
    page,
  }) => {
    const title = `E2E operational task ${Date.now()}`;
    const viewName = `E2E task view ${Date.now()}`;
    await signIn(page);
    await page.goto("/tasks");

    const createForm = page.locator(".tasks-create");
    await createForm.getByLabel("New follow-up").fill(title);
    await createForm.getByLabel("Due date").fill("2026-08-15");
    await createForm.getByLabel("Owner").selectOption(teammateUserId);
    await createForm.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Follow-up added",
    );

    const taskCard = page.locator(".task-card").filter({ hasText: title });
    await expect(taskCard).toBeVisible();
    await taskCard.getByRole("button", { name: "Start work" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Task moved to in progress",
    );
    await taskCard.getByRole("button", { name: "Complete" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Task completed and recorded",
    );
    await taskCard.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByRole("status")).toContainText("Task moved to open");
    await taskCard.getByLabel("Owner").selectOption("");
    await expect(page.getByRole("status")).toContainText(
      "unassigned queue",
    );

    await page.getByLabel("Search tasks").fill(title);
    await page.getByLabel("Name this Tasks view").fill(viewName);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("status")).toContainText(
      "private Tasks view",
    );
    await page.getByRole("button", { name: "Remove" }).click();

    const { data: task, error } = await admin!
      .from("tasks")
      .select("status, assignee_id, due_at, completed_at")
      .eq("organization_id", organizationIds[0])
      .eq("title", title)
      .single();
    expect(error).toBeNull();
    expect(task?.status).toBe("open");
    expect(task?.assignee_id).toBeNull();
    expect(task?.due_at).toBeTruthy();
    expect(task?.completed_at).toBeNull();
  });

  test("wires quote drafts, immutable revisions, internal costs, and sharing approval", async ({
    page,
  }) => {
    const quoteTitle = `E2E reviewed proposal ${Date.now()}`;
    await signIn(page);
    await page.goto("/quotes");

    await page.getByLabel("Opportunity").selectOption(dealId);
    await page.getByLabel("Quote title").fill(quoteTitle);
    await page.getByLabel("Currency").selectOption("INR");
    await page.getByLabel("Quoted total").fill("520000");
    await page.getByLabel("Valid until").fill("2026-09-15");
    await page
      .getByRole("button", { name: "Create internal draft" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Quote draft created",
    );

    const quoteCard = page
      .locator(".quotes-list article")
      .filter({ hasText: quoteTitle });
    await expect(quoteCard).toBeVisible();
    await quoteCard.getByLabel("Revise total").fill("545000");
    await quoteCard.getByLabel("Internal estimated cost").fill("410000");
    await quoteCard.getByRole("button", { name: "New version" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Created internal version 2",
    );
    await quoteCard
      .getByRole("button", { name: "Request human sharing review" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Human sharing review requested",
    );
    await expect(quoteCard.getByText("Sharing review pending")).toBeVisible();

    const { data: quote, error: quoteError } = await admin!
      .from("quotes")
      .select("id, current_version, status, valid_until")
      .eq("organization_id", organizationIds[0])
      .eq("title", quoteTitle)
      .single();
    expect(quoteError).toBeNull();
    expect(quote).toMatchObject({
      current_version: 2,
      status: "draft",
      valid_until: "2026-09-15",
    });
    const { data: versions, error: versionError } = await admin!
      .from("quote_versions")
      .select("id, version, total_amount")
      .eq("organization_id", organizationIds[0])
      .eq("quote_id", quote!.id)
      .order("version");
    expect(versionError).toBeNull();
    expect(versions).toMatchObject([
      { version: 1, total_amount: 520000 },
      { version: 2, total_amount: 545000 },
    ]);
    const { data: cost, error: costError } = await admin!
      .from("quote_cost_estimates")
      .select("estimated_cost_amount")
      .eq("organization_id", organizationIds[0])
      .eq("quote_version_id", versions![1].id)
      .single();
    expect(costError).toBeNull();
    expect(cost?.estimated_cost_amount).toBe(410000);
    const { data: shareApproval, error: shareApprovalError } = await admin!
      .from("approval_requests")
      .select("status, action, entity_id")
      .eq("organization_id", organizationIds[0])
      .eq("action", "quote.share")
      .eq("entity_id", quote!.id)
      .single();
    expect(shareApprovalError).toBeNull();
    expect(shareApproval?.status).toBe("pending");
  });

  test("wires trip drafts, day items, comments, readiness tasks, and reusable templates", async ({
    page,
  }) => {
    const suffix = Date.now();
    const sourceTrip = `E2E source journey ${suffix}`;
    const targetTrip = `E2E target journey ${suffix}`;
    const itemTitle = `Old Delhi walk ${suffix}`;
    const templateName = `E2E itinerary pattern ${suffix}`;
    const comment = `E2E planning note ${suffix}`;
    await signIn(page);
    await page.goto("/itineraries");

    await page.getByLabel("Trip name").fill(sourceTrip);
    await page.getByLabel("Trip start date").fill("2026-10-10");
    await page.getByLabel("Trip end date").fill("2026-10-12");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Internal trip draft created",
    );

    await page
      .getByLabel("Trip for itinerary item")
      .selectOption({ label: sourceTrip });
    await page.getByLabel("Itinerary day number").fill("1");
    await page.getByLabel("Itinerary item type").selectOption("activity");
    await page.getByLabel("Itinerary item title").fill(itemTitle);
    await page.getByLabel("Itinerary item location").fill("Delhi");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Internal itinerary item added",
    );

    const sourceCard = page
      .locator(".itinerary-list > article")
      .filter({ hasText: sourceTrip });
    await sourceCard
      .getByPlaceholder("Leave an internal note for the planning team")
      .fill(comment);
    await sourceCard
      .getByRole("button", { name: "Add internal note" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Internal itinerary comment added",
    );

    await page
      .getByLabel("Source trip for template")
      .selectOption({ label: sourceTrip });
    await page.getByLabel("Itinerary template name").fill(templateName);
    await page
      .getByLabel("Itinerary template description")
      .fill("Human-reviewed reusable route");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("status")).toContainText(
      `${templateName}" as an internal reusable itinerary template`,
    );

    await page.getByLabel("Trip name").fill(targetTrip);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Internal trip draft created",
    );
    await page
      .getByLabel("Saved itinerary template")
      .selectOption({ label: templateName });
    await page
      .getByLabel("Target trip for template")
      .selectOption({ label: targetTrip });
    await page.getByRole("button", { name: "Apply internally" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Added 1 internal items",
    );

    await sourceCard
      .getByRole("button", { name: "Create internal follow-up" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      /AIOS (created one internal itinerary follow-up|itinerary follow-up is already open)/,
    );
    await expect(
      sourceCard.getByRole("button", {
        name: "Ask AIOS for a planning draft",
      }),
    ).toBeVisible();

    const { data: trips, error: tripError } = await admin!
      .from("trips")
      .select("id, name")
      .eq("organization_id", organizationIds[0])
      .in("name", [sourceTrip, targetTrip]);
    expect(tripError).toBeNull();
    expect(trips).toHaveLength(2);
    const sourceTripId = trips!.find((trip) => trip.name === sourceTrip)!.id;
    const targetTripId = trips!.find((trip) => trip.name === targetTrip)!.id;
    const { count: sourceItemCount } = await admin!
      .from("itinerary_items")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", sourceTripId)
      .eq("title", itemTitle);
    const { count: targetItemCount } = await admin!
      .from("itinerary_items")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", targetTripId)
      .eq("title", itemTitle);
    expect(sourceItemCount).toBe(1);
    expect(targetItemCount).toBe(1);
    const { count: commentCount } = await admin!
      .from("itinerary_comments")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", sourceTripId)
      .eq("body", comment);
    expect(commentCount).toBe(1);
    const { count: readinessTaskCount } = await admin!
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationIds[0])
      .eq("title", `AIOS itinerary readiness: ${sourceTrip}`);
    expect(readinessTaskCount).toBe(1);
  });

  test("converts a won deal into a governed operational trip and wires its control deck", async ({
    page,
  }) => {
    const travelerEmail = `trip.guest.${Date.now()}@example.com`;
    const bookingTitle = `E2E Kyoto hotel ${Date.now()}`;
    const taskTitle = `Confirm airport transfer ${Date.now()}`;

    await signIn(page);
    await page.goto(`/leads/${dealId}`);
    await page.getByLabel("Pipeline stage").selectOption("won");
    await page.getByRole("button", { name: "Update stage" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Opportunity moved to won",
    );

    await page.goto("/trips");
    await expect(
      page.getByRole("heading", {
        name: /From “won” to wheels up/i,
      }),
    ).toBeVisible();
    const handoff = page
      .locator(".conversion-grid article")
      .filter({ hasText: "Kyoto discovery journey" });
    await expect(handoff).toBeVisible();
    await handoff
      .getByRole("button", { name: "Open operational trip" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Operational trip opened",
    );
    await page
      .locator(".operations-radar")
      .getByRole("button", { name: "Scan now" })
      .click();
    await expect(
      page.locator(".operations-radar").getByRole("status"),
    ).toContainText("Scan complete");
    await expect(
      page
        .locator(".radar-card")
        .filter({ hasText: "Kyoto discovery journey" })
        .filter({ hasText: "Trip dates are incomplete" }),
    ).toBeVisible();

    const radarSchedule = page.locator(".radar-schedule");
    await expect(
      radarSchedule.getByRole("heading", {
        name: "Monitor continuously. Escalate internally.",
      }),
    ).toBeVisible();
    await radarSchedule
      .getByLabel("Scan frequency")
      .selectOption("30");
    await radarSchedule
      .getByLabel("Fallback exception owner")
      .selectOption(userId!);
    await radarSchedule
      .locator("article")
      .filter({ hasText: "Traveler documents" })
      .getByLabel("Watch days")
      .fill("21");
    await radarSchedule
      .locator("article")
      .filter({ hasText: "Traveler documents" })
      .getByLabel("High within days")
      .fill("5");
    await radarSchedule
      .getByRole("button", { name: "Save governed policy" })
      .click();
    await expect(radarSchedule.getByRole("status")).toContainText(
      "Schedule saved",
    );
    await radarSchedule
      .getByRole("button", { name: "Run durable scan now" })
      .click();
    await expect(radarSchedule.getByRole("status")).toContainText(
      "Durable run complete: 1 succeeded, 0 failed",
    );
    await expect(
      radarSchedule.getByText("operator scan", { exact: true }),
    ).toBeVisible();

    const tripLink = page
      .locator(".trip-grid > a")
      .filter({ hasText: "Kyoto discovery journey" });
    await expect(tripLink).toBeVisible();
    await tripLink.click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/);
    operationalTripId = page.url().split("/").at(-1)!;
    await expect(
      page.getByRole("heading", { name: "Kyoto discovery journey" }),
    ).toBeVisible();
    await expect(page.getByText("Sales handoff", { exact: true })).toBeVisible();

    await page
      .getByLabel("Destination", { exact: true })
      .fill("Kyoto and Osaka, Japan");
    await page.getByLabel("Start date").fill("2026-10-10");
    await page.getByLabel("End date").fill("2026-10-18");
    await page
      .getByLabel("Operations notes")
      .fill("Lead traveller prefers a quiet room away from lifts.");
    await page.getByRole("button", { name: "Save operating details" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Operational trip details saved",
    );

    await page.getByLabel("Traveller first name").fill("Mira");
    await page.getByLabel("Traveller last name").fill("Sharma");
    await page.getByLabel("Traveller email").fill(travelerEmail);
    await page.getByLabel("Traveller role").selectOption("traveler");
    await page
      .getByLabel("Traveller preferences")
      .fill("Vegetarian meals");
    await page.getByRole("button", { name: "Add traveller" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Traveller added to the operational roster",
    );
    await expect(page.getByText(travelerEmail)).toBeVisible();

    const { data: operationalTravelers, error: operationalTravelersError } =
      await admin!
        .from("travelers")
        .select("id, first_name, last_name")
        .eq("trip_id", operationalTripId)
        .order("created_at");
    expect(operationalTravelersError).toBeNull();
    expect(operationalTravelers).toHaveLength(2);

    const readinessPanel = page.locator(".entry-readiness-panel");
    await expect(
      readinessPanel.getByRole("heading", {
        name: "Passport & visa checkpoints",
      }),
    ).toBeVisible();
    await expect(readinessPanel).toContainText(
      "AIOS compares human-reviewed dates",
    );
    for (const traveler of operationalTravelers ?? []) {
      await readinessPanel
        .getByLabel("Traveller")
        .selectOption(traveler.id);
      await readinessPanel.getByLabel("Destination country").fill("JP");
      await readinessPanel.getByLabel("Citizenship").fill("IN");
      await readinessPanel.getByLabel("Passport issuer").fill("IN");
      await readinessPanel
        .getByLabel("Passport expires")
        .fill("2028-12-31");
      await readinessPanel
        .getByLabel("Required validity after trip")
        .selectOption("6");
      await readinessPanel
        .getByLabel("Visa requirement")
        .selectOption("required");
      await readinessPanel
        .getByLabel("Visa workflow state")
        .selectOption("granted");
      await readinessPanel
        .getByLabel("Visa valid until")
        .fill("2027-12-31");
      await readinessPanel
        .getByLabel("Evidence source")
        .fill("E2E embassy advisory reviewed by operator");
      await readinessPanel
        .getByLabel("Evidence link (HTTPS)")
        .fill("https://official.example/entry");
      await readinessPanel
        .getByRole("button", { name: "Save human review" })
        .click();
      await expect(readinessPanel.getByRole("status")).toContainText(
        "Human review saved",
      );
      await expect(
        readinessPanel
          .locator(".entry-check-list article")
          .filter({
            hasText: `${traveler.first_name}${
              traveler.last_name ? ` ${traveler.last_name}` : ""
            }`,
          })
          .getByText("clear", { exact: true }),
      ).toBeVisible();
    }

    await page.getByLabel("Booking title").fill(bookingTitle);
    await page.getByLabel("Booking type").selectOption("hotel");
    await page.getByLabel("Service start").fill("2026-10-10T15:00");
    await page.getByLabel("Service end").fill("2026-10-18T10:00");
    await page.getByLabel("Booking cost").fill("125000");
    await page
      .getByLabel("Booking notes")
      .fill("Internal hold only; no supplier outreach from this record.");
    await page
      .getByRole("button", { name: "Create internal record" })
      .click();
    await expect(page.locator(".trip-workspace-notice")).toContainText(
      "No supplier was contacted",
    );
    const bookingCard = page
      .locator(".booking-ledger > article")
      .filter({ hasText: bookingTitle });
    await bookingCard
      .getByRole("button", { name: "Mark requested" })
      .click();
    await expect(page.locator(".trip-workspace-notice")).toContainText(
      "moved to requested",
    );
    await bookingCard
      .getByLabel(`Confirmation reference for ${bookingTitle}`)
      .fill("KYOTO-E2E-42");
    await bookingCard
      .getByRole("button", { name: "Mark confirmed" })
      .click();
    await expect(page.locator(".trip-workspace-notice")).toContainText(
      "moved to confirmed",
    );

    await page.getByLabel("Operational task title").fill(taskTitle);
    await page
      .getByRole("button", { name: "Add task" })
      .click();
    await expect(page.locator(".trip-workspace-notice")).toContainText(
      "Operational follow-up added",
    );
    const taskCard = page
      .locator(".task-stack article")
      .filter({ hasText: taskTitle });
    await taskCard.getByRole("button", { name: "Complete" }).click();
    await expect(page.locator(".trip-workspace-notice")).toContainText(
      "Follow-up marked completed",
    );

    await page.getByLabel("Private trip document").setInputFiles({
      name: "trip-voucher.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
      ),
    });
    await page
      .locator(".document-form input[name='expiresAt']")
      .fill("2027-01-01");
    await page.getByRole("button", { name: "Store privately" }).click();
    await expect(page.locator(".trip-workspace-notice")).toContainText(
      "Private trip document stored",
    );
    const documentRow = page
      .locator(".document-list article")
      .filter({ hasText: "trip-voucher.pdf" });
    await expect(documentRow).toContainText("expires 2027-01-01");
    const downloadPromise = page.waitForEvent("download");
    await documentRow
      .getByRole("button", { name: "Secure download" })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("trip-voucher.pdf");
    const { data: voucher, error: voucherError } = await admin!
      .from("documents")
      .select("id, document_kind")
      .eq("trip_id", operationalTripId)
      .eq("file_name", "trip-voucher.pdf")
      .single();
    expect(voucherError).toBeNull();
    expect(voucher?.document_kind).toBe("voucher");
    operationalVoucherId = voucher!.id;

    const { error: operationalItineraryError } = await admin!
      .from("itinerary_items")
      .insert(
        Array.from({ length: 9 }, (_, index) => ({
          organization_id: organizationIds[0],
          trip_id: operationalTripId,
          day_number: index + 1,
          position: 1,
          item_type: "note" as const,
          title: `E2E operational day ${index + 1}`,
        })),
      );
    expect(operationalItineraryError).toBeNull();

    await page.getByLabel("Trip status note").fill("Lead traveller checked in");
    await page.getByRole("button", { name: "Move to in travel" }).click();
    await expect(page.locator(".trip-workspace-notice")).toContainText(
      "Trip moved to in travel",
    );
    await page
      .locator(".operations-radar")
      .getByRole("button", { name: "Scan now" })
      .click();
    await expect(
      page.locator(".operations-radar").getByRole("status"),
    ).toContainText("0 active");
    await expect(
      page.getByText("No active operational exceptions"),
    ).toBeVisible();

    const { data: trip, error: tripError } = await admin!
      .from("trips")
      .select(
        "deal_id, status, destination, start_date, end_date, converted_at, converted_by",
      )
      .eq("id", operationalTripId)
      .single();
    expect(tripError).toBeNull();
    expect(trip).toMatchObject({
      deal_id: dealId,
      status: "in_travel",
      destination: "Kyoto and Osaka, Japan",
      start_date: "2026-10-10",
      end_date: "2026-10-18",
      converted_by: userId,
    });
    expect(trip?.converted_at).toBeTruthy();

    const [
      { data: roster },
      { data: booking },
      { data: task },
      { data: statusRows },
      { data: entryChecks },
    ] = await Promise.all([
        admin!
          .from("travelers")
          .select("email, role")
          .eq("trip_id", operationalTripId),
        admin!
          .from("bookings")
          .select("status, confirmation_reference")
          .eq("trip_id", operationalTripId)
          .eq("title", bookingTitle)
          .single(),
        admin!
          .from("tasks")
          .select("status, trip_id")
          .eq("trip_id", operationalTripId)
          .eq("title", taskTitle)
          .single(),
        admin!
          .from("trip_status_history")
          .select("from_status, to_status, change_source")
          .eq("trip_id", operationalTripId)
          .order("changed_at"),
        admin!
          .from("traveler_entry_checks")
          .select(
            "destination_country_code, passport_expires_on, visa_requirement, visa_status, evidence_source_label",
          )
          .eq("trip_id", operationalTripId),
      ]);
    expect(roster?.some((item) => item.role === "lead_traveler")).toBe(true);
    expect(roster?.some((item) => item.email === travelerEmail)).toBe(true);
    expect(booking).toMatchObject({
      status: "confirmed",
      confirmation_reference: "KYOTO-E2E-42",
    });
    expect(task).toMatchObject({
      status: "completed",
      trip_id: operationalTripId,
    });
    expect(entryChecks).toHaveLength(2);
    expect(
      entryChecks?.every(
        (entryCheck) =>
          entryCheck.destination_country_code === "JP" &&
          entryCheck.passport_expires_on === "2028-12-31" &&
          entryCheck.visa_requirement === "required" &&
          entryCheck.visa_status === "granted" &&
          Boolean(entryCheck.evidence_source_label),
      ),
    ).toBe(true);
    expect(statusRows?.map((item) => item.to_status)).toEqual([
      "confirmed",
      "in_travel",
    ]);
    const { data: radarPolicy, error: radarPolicyError } = await admin!
      .from("operations_radar_policies")
      .select(
        "scan_interval_minutes, document_expiry_days, document_high_days, default_assignee_id, last_run_status",
      )
      .eq("organization_id", organizationIds[0])
      .single();
    expect(radarPolicyError).toBeNull();
    expect(radarPolicy).toMatchObject({
      scan_interval_minutes: 30,
      document_expiry_days: 21,
      document_high_days: 5,
      default_assignee_id: userId,
      last_run_status: "succeeded",
    });
    const { count: durableRadarRunCount } = await admin!
      .from("operations_radar_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationIds[0])
      .eq("status", "succeeded");
    expect(durableRadarRunCount).toBe(1);
  });

  test("wires supplier memory, payment evidence, and payment-due radar", async ({
    page,
  }) => {
    const suffix = Date.now();
    const supplierName = `E2E Kyoto supplier ${suffix}`;
    const contactName = `E2E Supplier Contact ${suffix}`;
    const contractTitle = `E2E 2027 rate agreement ${suffix}`;
    const paymentTitle = `E2E supplier deposit ${suffix}`;
    const invoiceNumber = `E2E-INV-${suffix}`;
    const settlementReference = `E2E-BANK-${suffix}`;
    const overdueDate = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);

    await signIn(page);
    await page.goto("/finance");
    await expect(
      page.getByRole("heading", { name: /Know what is owed/i }),
    ).toBeVisible();
    await expect(page.getByText("Internal ledger only")).toBeVisible();

    await page.getByText("Create supplier profile", { exact: true }).click();
    await page.getByLabel("Supplier name").fill(supplierName);
    await page.getByLabel("Supplier category").fill("DMC");
    await page.getByLabel("Main contact name").fill(contactName);
    await page
      .getByLabel("Supplier email")
      .fill(`supplier.${suffix}@example.invalid`);
    await page.getByLabel("Payment terms (days)").fill("14");
    await page.getByLabel("Quality rating").fill("4.7");
    await page.getByRole("button", { name: "Create supplier" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Supplier profile created",
    );
    await expect(
      page.getByRole("heading", { name: supplierName, exact: true }),
    ).toBeVisible();

    await page.getByText("Add supplier contact", { exact: true }).click();
    await page
      .getByLabel("Contact supplier")
      .selectOption({ label: supplierName });
    await page.getByLabel("Contact name", { exact: true }).fill(contactName);
    await page
      .getByLabel("Contact email")
      .fill(`operations.${suffix}@example.invalid`);
    await page.getByLabel("Primary contact").check();
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Supplier contact added",
    );

    await page.getByText("Record supplier contract", { exact: true }).click();
    await page
      .getByLabel("Contract supplier")
      .selectOption({ label: supplierName });
    await page.getByLabel("Contract title").fill(contractTitle);
    await page.getByLabel("Contract reference").fill(`RATE-${suffix}`);
    await page.getByLabel("Internal status").selectOption("active");
    await page.getByLabel("Starts on").fill("2026-08-01");
    await page.getByLabel("Ends on").fill("2027-07-31");
    await page
      .getByLabel("Contract payment terms (days)")
      .fill("14");
    await page.getByRole("button", { name: "Record contract" }).click();
    await expect(page.getByRole("status")).toContainText(
      "No contract was signed or accepted",
    );

    await page.getByLabel("Payment direction").selectOption("payable");
    await page.getByLabel("Obligation title").fill(paymentTitle);
    await page.getByLabel("Amount", { exact: true }).fill("125000");
    await page.getByLabel("Currency", { exact: true }).fill("INR");
    await page.getByLabel("Due date").fill(overdueDate);
    await page
      .getByLabel("Related trip")
      .selectOption(operationalTripId);
    await page
      .locator('.ledger-create select[name="supplierId"]')
      .selectOption({ label: supplierName });
    await page.getByLabel("Invoice number").fill(invoiceNumber);
    await page.getByRole("button", { name: "Create obligation" }).click();
    await expect(page.getByRole("status")).toContainText(
      "No charge, payout, or invoice was sent",
    );

    const paymentCard = page
      .locator(".payment-card")
      .filter({ hasText: paymentTitle });
    await expect(paymentCard).toBeVisible();
    await expect(
      paymentCard.getByText("overdue", { exact: true }),
    ).toBeVisible();

    await page.goto(`/trips/${operationalTripId}`);
    await page
      .locator(".operations-radar")
      .getByRole("button", { name: "Scan now" })
      .click();
    await expect(
      page
        .locator(".radar-card")
        .filter({ hasText: "Supplier payment needs attention" })
        .filter({ hasText: paymentTitle }),
    ).toBeVisible();

    await page.goto("/finance");
    const refreshedPaymentCard = page
      .locator(".payment-card")
      .filter({ hasText: paymentTitle });
    await refreshedPaymentCard
      .getByText("Record settlement", { exact: true })
      .click();
    await refreshedPaymentCard
      .getByLabel(`Settlement amount for ${paymentTitle}`)
      .fill("125000");
    await refreshedPaymentCard
      .getByLabel(`Settlement reference for ${paymentTitle}`)
      .fill(settlementReference);
    await refreshedPaymentCard
      .getByRole("button", { name: "Record evidence" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "AIOS did not initiate any money movement",
    );
    await page
      .getByRole("button", { name: "Settled", exact: true })
      .click();
    await expect(
      refreshedPaymentCard.getByText("paid", { exact: true }),
    ).toBeVisible();
    await expect(
      refreshedPaymentCard.getByText(settlementReference, { exact: true }),
    ).toBeVisible();

    const { data: supplier, error: supplierError } = await admin!
      .from("suppliers")
      .select("id, payment_terms_days, quality_rating")
      .eq("organization_id", organizationIds[0])
      .eq("name", supplierName)
      .single();
    expect(supplierError).toBeNull();
    const { data: payment, error: paymentError } = await admin!
      .from("payments")
      .select("id, status, amount, paid_amount, trip_id, supplier_id, created_by")
      .eq("organization_id", organizationIds[0])
      .eq("invoice_number", invoiceNumber)
      .single();
    expect(paymentError).toBeNull();
    expect(payment).toMatchObject({
      status: "paid",
      amount: 125000,
      paid_amount: 125000,
      trip_id: operationalTripId,
      supplier_id: supplier!.id,
      created_by: userId,
    });
    const { data: paymentAllocations, error: allocationError } = await admin!
      .from("payment_allocations")
      .select("amount, reference, recorded_by")
      .eq("payment_id", payment!.id);
    expect(allocationError).toBeNull();
    expect(paymentAllocations).toMatchObject([
      {
        amount: 125000,
        reference: settlementReference,
        recorded_by: userId,
      },
    ]);

    await page.goto(`/trips/${operationalTripId}`);
    await page
      .locator(".operations-radar")
      .getByRole("button", { name: "Scan now" })
      .click();
    await expect(
      page
        .locator(".radar-card")
        .filter({ hasText: "Supplier payment needs attention" }),
    ).toHaveCount(0);
  });

  test("publishes and revokes an approved traveler portal without exposing internal data", async ({
    page,
  }) => {
    const receivableTitle = `E2E traveler journey balance ${Date.now()}`;

    await signIn(page);
    await page.goto("/finance");
    await page.getByLabel("Payment direction").selectOption("receivable");
    await page.getByLabel("Obligation title").fill(receivableTitle);
    await page.getByLabel("Amount", { exact: true }).fill("480000");
    await page.getByLabel("Currency", { exact: true }).fill("INR");
    await page.getByLabel("Due date").fill("2026-09-15");
    await page.getByLabel("Related trip").selectOption(operationalTripId);
    await page.getByRole("button", { name: "Create obligation" }).click();
    await expect(page.getByRole("status")).toContainText(
      "No charge, payout, or invoice was sent",
    );

    await page.goto(`/trips/${operationalTripId}/portal`);
    await expect(
      page.getByRole("heading", {
        name: "Share the journey, not the back office.",
      }),
    ).toBeVisible();
    await expect(page.getByText("NEVER VISIBLE")).toBeVisible();
    await page
      .getByLabel(/trip-voucher\.pdf/i)
      .check();
    await page.getByLabel("Include customer payment status").check();
    await page.getByLabel("Link lifetime").selectOption("7");
    await page
      .getByRole("button", { name: "Request human approval" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Human review requested",
    );

    await page
      .getByRole("button", { name: "Approve reviewed scope" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Human approval recorded",
    );
    await page
      .getByRole("button", { name: "Publish approved portal" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Traveler portal published",
    );

    const portalAnchor = page.getByRole("link", {
      name: "Open traveler portal",
    });
    const portalPath = await portalAnchor.getAttribute("href");
    expect(portalPath).toMatch(/^\/portal\/[A-Za-z0-9_-]{43}$/);
    const rawToken = portalPath!.split("/").at(-1)!;
    const rawTokenHash = createHash("sha256").update(rawToken).digest("hex");
    const { data: publicSnapshot, error: publicSnapshotError } =
      await admin!.rpc("get_traveler_portal_snapshot", {
        target_token_hash: rawTokenHash,
      });
    expect(publicSnapshotError).toBeNull();
    const parsedPublicSnapshot =
      travelerPortalSnapshotSchema.safeParse(publicSnapshot);
    if (!parsedPublicSnapshot.success) {
      throw new Error(
        `Published traveler snapshot is invalid: ${JSON.stringify(parsedPublicSnapshot.error.issues)}`,
      );
    }

    const travelerPage = await page.context().newPage();
    const portalResponse = await travelerPage.goto(portalPath!);
    expect(portalResponse?.status()).toBe(200);
    await expect(
      travelerPage.getByRole("heading", {
        name: "Kyoto discovery journey",
      }),
    ).toBeVisible();
    await expect(travelerPage.getByText("KYOTO-E2E-42")).toBeVisible();
    await expect(
      travelerPage.getByText(receivableTitle, { exact: true }),
    ).toBeVisible();
    await expect(
      travelerPage.getByText("trip-voucher.pdf", { exact: true }),
    ).toBeVisible();
    await expect(
      travelerPage.getByText(
        "Lead traveller prefers a quiet room away from lifts.",
      ),
    ).toHaveCount(0);
    await expect(travelerPage.getByText("Internal cost")).toHaveCount(0);

    const portalDownload = travelerPage.waitForEvent("download");
    await travelerPage
      .getByRole("link", { name: "Secure download" })
      .click();
    expect((await portalDownload).suggestedFilename()).toBe(
      "trip-voucher.pdf",
    );

    const { data: portalLink, error: portalLinkError } = await admin!
      .from("trip_portal_links")
      .select(
        "id, status, token_hash, snapshot, approval_request_id, expires_at",
      )
      .eq("trip_id", operationalTripId)
      .single();
    expect(portalLinkError).toBeNull();
    expect(portalLink?.token_hash).toBe(rawTokenHash);
    expect(portalLink?.token_hash).not.toBe(rawToken);
    const portalSnapshot = portalLink?.snapshot as Record<string, unknown>;
    expect(portalSnapshot).not.toHaveProperty("operations_notes");
    expect(portalSnapshot).not.toHaveProperty("supplier_terms");
    const { count: mappedDocumentCount } = await admin!
      .from("trip_portal_documents")
      .select("document_id", { count: "exact", head: true })
      .eq("portal_link_id", portalLink!.id)
      .eq("document_id", operationalVoucherId);
    expect(mappedDocumentCount).toBe(1);
    const { data: portalApproval } = await admin!
      .from("approval_requests")
      .select("status")
      .eq("id", portalLink!.approval_request_id)
      .single();
    expect(portalApproval?.status).toBe("approved");

    await page
      .getByLabel("Revocation reason")
      .fill("Traveler access window is complete.");
    await page
      .getByRole("button", { name: "Revoke immediately" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Traveler link revoked immediately",
    );

    const revokedResponse = await travelerPage.goto(portalPath!);
    expect(revokedResponse?.status()).toBe(404);
    const { data: revokedPortal } = await admin!
      .from("trip_portal_links")
      .select("status, revoked_by, revoked_at, revocation_note")
      .eq("id", portalLink!.id)
      .single();
    expect(revokedPortal).toMatchObject({
      status: "revoked",
      revoked_by: userId,
      revocation_note: "Traveler access window is complete.",
    });
    expect(revokedPortal?.revoked_at).toBeTruthy();
    await travelerPage.close();
  });

  test("wires lead-capture creation, preview routing, pause, and resume", async ({
    page,
  }) => {
    const formName = `E2E capture surface ${Date.now()}`;
    await signIn(page);
    await page.goto("/settings/lead-capture");

    await page.getByLabel("Internal form name").fill(formName);
    await page
      .getByLabel("Traveller-facing headline")
      .fill("Design your E2E journey");
    await page.getByLabel("Attribution source").fill("E2E Campaign");
    await page.getByLabel("Response target").selectOption("30");
    await page.getByLabel("Default owner").selectOption(userId!);
    await page.getByRole("button", { name: "Create live form" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Lead capture form is live",
    );

    const formCard = page.locator(".capture-form-row").filter({ hasText: formName });
    await expect(formCard).toBeVisible();
    const { data: captureForm, error: captureFormError } = await admin!
      .from("lead_capture_forms")
      .select(
        "id, public_token, is_active, headline, source, default_owner_id, first_response_minutes",
      )
      .eq("organization_id", organizationIds[0])
      .eq("name", formName)
      .single();
    expect(captureFormError).toBeNull();
    await expect(formCard.getByRole("link", { name: "Preview" })).toHaveAttribute(
      "href",
      `/lead/${captureForm!.public_token}`,
    );

    await formCard.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("status")).toContainText("Form paused");
    const { data: paused } = await admin!
      .from("lead_capture_forms")
      .select("is_active")
      .eq("id", captureForm!.id)
      .single();
    expect(paused?.is_active).toBe(false);
    await formCard.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("status")).toContainText("Form resumed");
    const { data: resumed } = await admin!
      .from("lead_capture_forms")
      .select("is_active")
      .eq("id", captureForm!.id)
      .single();
    expect(resumed?.is_active).toBe(true);
    expect(captureForm).toMatchObject({
      headline: "Design your E2E journey",
      source: "E2E Campaign",
      default_owner_id: userId,
      first_response_minutes: 30,
    });
  });

  test("wires team roles, suspension safeguards, invitations, and revocation", async ({
    page,
  }) => {
    const invitationEmail = `invite.${Date.now()}@example.com`;
    await signIn(page);
    await page.goto("/settings/team");
    await expect(page.getByText(teammateName, { exact: true })).toBeVisible();

    await page
      .getByLabel(`Role for ${teammateName}`)
      .selectOption("operations");
    const teamFeedback = page.locator(".team-feedback [role='status']");
    await expect(teamFeedback).toContainText(
      `${teammateName} now has the Operations role`,
    );

    const teammateRow = page
      .getByRole("row")
      .filter({ hasText: teammateName });
    page.once("dialog", (dialog) => dialog.accept());
    await teammateRow.getByRole("button", { name: "Suspend" }).click();
    await expect(teamFeedback).toContainText(
      "workspace access was suspended",
    );
    await teammateRow.getByRole("button", { name: "Restore" }).click();
    await expect(teamFeedback).toContainText(
      "workspace access was restored",
    );

    await page.getByLabel("Work email").fill(invitationEmail);
    await page.getByLabel("Workspace role").selectOption("sales");
    await page.getByRole("button", { name: "Record invitation" }).click();
    await expect(teamFeedback).toContainText(
      "Invitation recorded securely",
    );
    await page
      .getByRole("button", {
        name: `Revoke invitation for ${invitationEmail}`,
      })
      .click();
    await expect(teamFeedback).toContainText(
      `invitation for ${invitationEmail} was revoked`,
    );

    const { data: membership, error: membershipError } = await admin!
      .from("memberships")
      .select("role, status")
      .eq("id", teammateMembershipId)
      .single();
    expect(membershipError).toBeNull();
    expect(membership).toMatchObject({ role: "operations", status: "active" });
    const { data: invitation, error: invitationError } = await admin!
      .from("organization_invitations")
      .select("role, status, token_hash, revoked_at")
      .eq("organization_id", organizationIds[0])
      .eq("email", invitationEmail)
      .single();
    expect(invitationError).toBeNull();
    expect(invitation?.role).toBe("sales");
    expect(invitation?.status).toBe("revoked");
    expect(invitation?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation?.revoked_at).toBeTruthy();
  });

  test("curates, renews, and retrieves permission-aware knowledge with a citation", async ({
    page,
  }) => {
    const sourceTitle = `Kyoto rail policy ${Date.now()}`;
    await signIn(page);
    await page.goto("/knowledge");
    await expect(
      page.getByRole("heading", {
        name: "Give AIOS trusted material, with a source for every answer.",
      }),
    ).toBeVisible();

    await page.getByLabel("Source title").fill(sourceTitle);
    await page.getByLabel("Source type").selectOption("destination_guide");
    await page.getByLabel("Authority").selectOption("official");
    await page.getByLabel("Sensitivity").selectOption("normal");
    await page.getByLabel("Version").fill("2026.1");
    await page
      .getByLabel("HTTPS source link")
      .fill("https://example.com/kyoto-rail-policy");
    await page
      .getByLabel("Curator summary")
      .fill("Human-reviewed rail guidance for itinerary planning.");
    await page
      .getByRole("button", { name: "Create governed draft" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Draft source saved",
    );

    await page.getByLabel("Section heading").fill("Cancellation windows");
    await page
      .getByLabel("Evidence content")
      .fill(
        "Kyoto rail cancellation windows require operator review before any traveller-facing commitment.",
      );
    await page
      .getByLabel("Citation label")
      .fill("Kyoto rail policy §4");
    await page.getByRole("button", { name: "Add cited passage" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Cited section added",
    );

    await page
      .getByRole("button", { name: "Send to human review" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Knowledge moved to in review",
    );
    await page
      .getByRole("button", { name: "Approve for AIOS retrieval" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Knowledge moved to approved",
    );

    await page
      .getByLabel("Question or evidence needed")
      .fill("cancellation windows");
    await page
      .getByRole("button", { name: "Search approved sources" })
      .click();
    await expect(page.getByText("Kyoto rail policy §4")).toBeVisible();
    await expect(page.getByText("Current review")).toBeVisible();
    await page.setViewportSize({ width: 748, height: 900 });
    const [retrievalBox, inventoryBox, retrievalLayout] = await Promise.all([
      page.locator(".governed-knowledge-search").boundingBox(),
      page.locator(".knowledge-workspace").boundingBox(),
      page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ]);
    expect(retrievalBox).not.toBeNull();
    expect(inventoryBox).not.toBeNull();
    expect(retrievalBox!.y + retrievalBox!.height).toBeLessThanOrEqual(
      inventoryBox!.y,
    );
    expect(retrievalLayout.scrollWidth).toBeLessThanOrEqual(
      retrievalLayout.innerWidth,
    );
    await page.setViewportSize({ width: 1280, height: 720 });

    await expect(page.getByLabel("Replacement version")).toHaveValue(
      "2026.2",
    );
    await page
      .getByRole("button", { name: "Prepare replacement draft" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Replacement draft prepared",
    );
    await expect(
      page.getByText(
        "Replacement draft for v2026.1. The prior approved version remains live until this version is approved.",
      ),
    ).toBeVisible();

    const passageEditor = page.locator(".knowledge-section-editor").first();
    await passageEditor.getByText("Revise passage").click();
    await passageEditor
      .getByLabel("Section heading")
      .fill("Revised cancellation windows");
    await passageEditor
      .getByLabel("Evidence content")
      .fill(
        "The 2026.2 Kyoto rail policy requires operator confirmation before any traveller-facing commitment.",
      );
    await passageEditor
      .getByLabel("Citation label")
      .fill("Kyoto rail policy §5");
    await passageEditor
      .getByRole("button", { name: "Save revision" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Draft passage revised",
    );

    await page
      .getByRole("button", { name: "Send to human review" })
      .click();
    await page
      .getByRole("button", { name: "Approve for AIOS retrieval" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Knowledge moved to approved",
    );
    await page
      .getByRole("button", { name: "Search approved sources" })
      .click();
    await expect(page.getByText("Kyoto rail policy §5")).toBeVisible();
    await expect(
      page.getByText(`${sourceTitle} · v2026.2 · official`),
    ).toBeVisible();

    const { data: sources, error: sourceError } = await admin!
      .from("knowledge_sources")
      .select(
        "id, status, reviewed_by, source_url, version_label, supersedes_source_id, retired_at",
      )
      .eq("organization_id", organizationIds[0])
      .eq("title", sourceTitle)
      .order("version_label");
    expect(sourceError).toBeNull();
    expect(sources).toHaveLength(2);
    const originalSource = sources!.find(
      (source) => source.version_label === "2026.1",
    );
    const replacementSource = sources!.find(
      (source) => source.version_label === "2026.2",
    );
    expect(originalSource).toMatchObject({
      status: "retired",
      reviewed_by: userId,
      source_url: "https://example.com/kyoto-rail-policy",
    });
    expect(originalSource?.retired_at).toBeTruthy();
    expect(replacementSource).toMatchObject({
      status: "approved",
      reviewed_by: userId,
      source_url: "https://example.com/kyoto-rail-policy",
      supersedes_source_id: originalSource?.id,
    });
    const { data: sections, error: sectionError } = await admin!
      .from("knowledge_sections")
      .select("citation_label")
      .eq("source_id", replacementSource!.id);
    expect(sectionError).toBeNull();
    expect(sections).toEqual([{ citation_label: "Kyoto rail policy §5" }]);
  });

  test("wires AIOS budgets, provider pricing, autonomy controls, and deterministic triage", async ({
    page,
  }) => {
    const modelName = `e2e-glm-${Date.now()}`;
    await signIn(page);
    await page.goto("/aios");

    await page.getByLabel("Daily run ceiling").fill("7");
    await page.getByLabel("Selected provider").selectOption("glm");
    await page.getByLabel("Model execution").uncheck();
    await page.getByRole("button", { name: "Save budget policy" }).click();
    await expect(
      page
        .locator(".aios-notice")
        .filter({ hasText: "Provider-backed model execution is disabled" }),
    ).toBeVisible();

    await page.getByLabel("Exact model").fill(modelName);
    await page.getByLabel("Currency").fill("USD");
    await page.getByLabel("Input / 1M").fill("0.1");
    await page.getByLabel("Output / 1M").fill("0.2");
    await page.getByRole("button", { name: "Add approved price" }).click();
    await expect(
      page
        .locator(".aios-notice")
        .filter({ hasText: `glm/${modelName} price version` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Triage lead risks" }).click();
    await expect(
      page.locator(".aios-notice").filter({ hasText: /AIOS triage/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Triage Inbox SLAs" }).click();
    await expect(
      page
        .locator(".aios-notice")
        .filter({ hasText: /AIOS (checked|found)/i }),
    ).toBeVisible();

    const taskPolicyCard = page
      .locator(".autonomy-card")
      .filter({ hasText: "Create internal follow-up tasks" });
    await taskPolicyCard
      .getByRole("button", { name: /Assist/i })
      .click();
    await expect(
      page
        .locator(".aios-notice")
        .filter({ hasText: "internal.task.create is now set to assist" }),
    ).toBeVisible();
    await taskPolicyCard
      .getByRole("button", { name: /Auto/i })
      .click();
    await expect(
      page
        .locator(".aios-notice")
        .filter({ hasText: "internal.task.create is now set to auto" }),
    ).toBeVisible();
    await taskPolicyCard
      .getByRole("button", { name: "Disable workflow" })
      .click();
    await expect(
      page
        .locator(".aios-notice")
        .filter({ hasText: "internal.task.create is disabled" }),
    ).toBeVisible();
    await taskPolicyCard
      .getByRole("button", { name: "Enable workflow" })
      .click();
    await expect(
      page
        .locator(".aios-notice")
        .filter({ hasText: "internal.task.create is enabled" }),
    ).toBeVisible();

    const quotePolicyCard = page
      .locator(".autonomy-card")
      .filter({ hasText: "Share quotes" });
    await expect(
      quotePolicyCard.getByRole("button", { name: /Auto/i }),
    ).toBeDisabled();

    const { data: budget, error: budgetError } = await admin!
      .from("ai_budget_policies")
      .select(
        "daily_model_run_limit, model_execution_enabled, selected_model_provider, allowed_model_providers, updated_by",
      )
      .eq("organization_id", organizationIds[0])
      .single();
    expect(budgetError).toBeNull();
    expect(budget).toMatchObject({
      daily_model_run_limit: 7,
      model_execution_enabled: false,
      selected_model_provider: "glm",
      updated_by: userId,
    });
    expect(budget?.allowed_model_providers).toContain("glm");
    const { data: modelPrice, error: modelPriceError } = await admin!
      .from("ai_model_prices")
      .select(
        "provider, model, currency, input_price_per_million, output_price_per_million, approved_by",
      )
      .eq("organization_id", organizationIds[0])
      .eq("model", modelName)
      .single();
    expect(modelPriceError).toBeNull();
    expect(modelPrice).toMatchObject({
      provider: "glm",
      currency: "USD",
      input_price_per_million: 0.1,
      output_price_per_million: 0.2,
      approved_by: userId,
    });
    const { data: taskPolicy, error: taskPolicyError } = await admin!
      .from("ai_autonomy_policies")
      .select("mode, is_enabled")
      .eq("organization_id", organizationIds[0])
      .eq("action", "internal.task.create")
      .single();
    expect(taskPolicyError).toBeNull();
    expect(taskPolicy).toMatchObject({ mode: "auto", is_enabled: true });
  });

  test("renders every workspace surface without browser errors or warnings", async ({
    page,
  }) => {
    const browserProblems: string[] = [];
    page.on("pageerror", (error) => browserProblems.push(`page: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        browserProblems.push(`${message.type()}: ${message.text()}`);
      }
    });
    await signIn(page);
    for (const route of [
      "/",
      "/contacts",
      "/inbox",
      "/tasks",
      "/quotes",
      "/itineraries",
      "/trips",
      `/trips/${operationalTripId}`,
      `/trips/${operationalTripId}/portal`,
      "/finance",
      "/aios",
      "/knowledge",
      "/analytics",
      "/settings/lead-capture",
      "/settings/sales-workflows",
      "/settings/team",
      "/settings/security",
      `/leads/${dealId}`,
    ]) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
    }
    expect(browserProblems).toEqual([]);
  });

  test("enrolls, verifies, and removes a TOTP authenticator through the UI", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/settings/security");
    await page.getByRole("button", { name: "Begin setup" }).click();
    await expect(
      page.getByRole("heading", { name: "Scan this private QR code" }),
    ).toBeVisible();
    await page.getByText("Can't scan? Enter the setup key").click();
    const secret = await page.locator(".security-enrollment code").innerText();
    if (Date.now() % 30_000 > 27_000) await page.waitForTimeout(3_500);
    await page
      .getByLabel("Six-digit verification code")
      .fill(currentTotp(secret));
    await page.getByRole("button", { name: "Enable authenticator" }).click();
    const securityFeedback = page.locator(
      ".security-feedback [role='status'], .ui-form-feedback[role='status']",
    );
    await expect(securityFeedback).toContainText(
      "Authenticator verified",
    );
    await expect(page.getByText("Verified", { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(securityFeedback).toContainText(
      "Authenticator removed",
    );
    const { data: factors, error } = await admin!.auth.admin.mfa.listFactors({
      userId: userId!,
    });
    expect(error).toBeNull();
    expect(factors?.factors).toHaveLength(0);
  });
});
