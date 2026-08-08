import { createHash, createHmac } from "node:crypto";

import { expect, test, type Cookie, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { travelerPortalSnapshotSchema } from "../../lib/crm/traveler-portal";
import { quoteShareSnapshotSchema } from "../../lib/crm/quote-share";
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
let sessionCookies: Cookie[] = [];
const teammateName = "Authenticated E2E Teammate";

async function signIn(page: Page) {
  if (sessionCookies.length > 0) {
    await page.context().addCookies(sessionCookies);
    await page.goto("/");
  } else {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
  }
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

    sessionCookies = [];
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
      const { data: invoiceDocuments } = await admin
        .from("invoice_documents")
        .select("storage_path")
        .in("organization_id", organizationIds);
      if (invoiceDocuments?.length) {
        await admin.storage
          .from("invoice-documents")
          .remove(
            invoiceDocuments.map((document) => document.storage_path),
          );
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
    sessionCookies = await page.context().cookies();
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
      ["/analytics", /See revenue, readiness, and risk in one place/i],
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

  test("keeps authenticated modal focus bounded and restores keyboard context", async ({
    page,
  }) => {
    await signIn(page);

    const helpTrigger = page.getByRole("button", { name: "How AIOS works" });
    await helpTrigger.focus();
    await helpTrigger.press("Enter");
    const helpDialog = page.getByRole("dialog", {
      name: "How the CRM fits together",
    });
    await expect(helpDialog).toBeVisible();
    const closeHelp = page.getByRole("button", {
      name: "Close product guide",
    });
    await expect(closeHelp).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(
      helpDialog.getByRole("link", { name: "Start with a lead" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeHelp).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(helpDialog).toHaveCount(0);
    await expect(helpTrigger).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("");

    const searchTrigger = page.getByRole("button", {
      name: /Search leads, contacts, and tasks/i,
    });
    await searchTrigger.focus();
    await page.keyboard.press("Control+K");
    const searchDialog = page.getByRole("dialog", {
      name: "Search your workspace",
    });
    await expect(searchDialog).toBeVisible();
    await expect(
      page.getByPlaceholder("Search leads, contacts, or tasks…"),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(searchDialog).toHaveCount(0);
    await expect(searchTrigger).toBeFocused();
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
    await signIn(page);

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
      page.getByRole("heading", {
        name: /See revenue, readiness, and risk in one place/i,
      }),
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
    await signIn(page);

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

    await signIn(page);

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
    const priorityBrief = page.locator("#sales-priority-brief");
    await expect(priorityBrief.getByText("AIOS SALES PRIORITY")).toBeVisible();
    await expect(
      priorityBrief.getByRole("heading", {
        name: /Build the case|Recover momentum/,
      }),
    ).toBeVisible();
    await expect(priorityBrief.getByText(/not conversion probability/i)).toBeVisible();
    await priorityBrief
      .getByText("Show the exact readiness calculation")
      .click();
    await expect(
      priorityBrief.getByText("Qualification evidence", { exact: true }),
    ).toBeVisible();
    await expect(priorityBrief.getByText(/0 model calls/i)).toBeVisible();
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
    await expect(
      priorityBrief.getByRole("heading", { name: "Recover momentum" }),
    ).toBeVisible();
    await expect(
      priorityBrief.getByRole("link", {
        name: "Advanced stage has no active quote",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      priorityBrief.getByRole("link", {
        name: "Prepare or refresh the quote",
      }),
    ).toHaveAttribute("href", "/quotes");

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
    await signIn(page);

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
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await decisionCard.dispatchEvent("dragstart", { dataTransfer });
    await expect(proposalColumn).toHaveClass(/drop-allowed/);
    await proposalColumn.dispatchEvent("dragenter", { dataTransfer });
    await proposalColumn.dispatchEvent("dragover", { dataTransfer });
    await proposalColumn.dispatchEvent("drop", { dataTransfer });
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

    const { error: disabledBudgetError } = await admin!
      .from("ai_budget_policies")
      .insert({
        organization_id: organizationIds[0],
        daily_model_run_limit: 30,
        model_execution_enabled: false,
        selected_model_provider: "glm",
        fallback_model_provider: null,
        allowed_model_providers: ["glm"],
        updated_by: userId!,
      });
    expect(disabledBudgetError).toBeNull();
    await page.getByRole("button", { name: "Ask Sales Copilot" }).click();
    await expect(page.getByRole("status")).toContainText(
      "model execution is disabled",
    );
    const { data: blockedCopilotRun, error: blockedCopilotRunError } =
      await admin!
        .from("ai_runs")
        .select("id, status, error_code")
        .eq("organization_id", organizationIds[0])
        .eq("agent_type", "conversation_reply_draft")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
    expect(blockedCopilotRunError).toBeNull();
    expect(blockedCopilotRun).toMatchObject({
      status: "blocked",
      error_code: "AI_MODEL_EXECUTION_DISABLED",
    });
    const { count: generatedDraftCount } = await admin!
      .from("message_drafts")
      .select("id", { count: "exact", head: true })
      .eq("ai_run_id", blockedCopilotRun!.id);
    expect(generatedDraftCount).toBe(0);
    const { error: disabledBudgetCleanupError } = await admin!
      .from("ai_budget_policies")
      .delete()
      .eq("organization_id", organizationIds[0]);
    expect(disabledBudgetCleanupError).toBeNull();

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

    const copilotSubject = `AIOS review draft ${suffix}`;
    const { data: copilotRun, error: copilotRunError } = await admin!
      .from("ai_runs")
      .insert({
        organization_id: organizationIds[0],
        initiated_by: userId!,
        agent_type: "conversation_reply_draft",
        agent_version: "e2e-fixture",
        status: "succeeded",
        input_reference: {
          workflow: "conversation_reply_draft",
          conversation_id: conversation!.id,
        },
      })
      .select("id")
      .single();
    expect(copilotRunError).toBeNull();
    const { data: copilotDraft, error: copilotDraftError } = await admin!
      .from("message_drafts")
      .insert({
        organization_id: organizationIds[0],
        conversation_id: conversation!.id,
        ai_run_id: copilotRun!.id,
        created_by: userId!,
        channel: "email",
        recipient: null,
        subject: copilotSubject,
        body: "A fictional AIOS draft awaiting exact-revision review.",
        status: "ready_for_review",
      })
      .select("id")
      .single();
    expect(copilotDraftError).toBeNull();

    await page.reload();
    await page.getByLabel("Search conversations").fill(subject);
    await page
      .locator("section.inbox-workspace > aside > button")
      .filter({ hasText: subject })
      .click();
    let copilotCard = page.locator(".draft-card").filter({
      hasText: copilotSubject,
    });
    await expect(copilotCard).toContainText("review needed");
    await copilotCard.getByRole("button", { name: "Review AI draft" }).click();
    await copilotCard
      .getByLabel("Review feedback")
      .fill("Confirm the hotel category before using this reply.");
    await copilotCard.getByRole("button", { name: "Request changes" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Changes requested and recorded. Nothing was sent.",
    );
    await expect(copilotCard).toContainText("changes requested");

    await copilotCard.getByRole("button", { name: "Edit" }).click();
    await page
      .getByRole("textbox", { name: "Draft", exact: true })
      .fill("A human-revised fictional AIOS response for review.");
    await page.getByRole("button", { name: "Save revision" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Internal draft revised",
    );
    copilotCard = page.locator(".draft-card").filter({
      hasText: copilotSubject,
    });
    await expect(copilotCard).toContainText("revision needs review");
    await copilotCard.getByRole("button", { name: "Review AI draft" }).click();
    await copilotCard.getByRole("button", { name: "Approve for use" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Draft approved for human use. Nothing was sent.",
    );
    await expect(copilotCard).toContainText("approved");

    const { data: copilotReviews, error: copilotReviewsError } = await admin!
      .from("message_draft_reviews")
      .select("decision, note, content_sha256")
      .eq("message_draft_id", copilotDraft!.id)
      .order("reviewed_at", { ascending: true });
    expect(copilotReviewsError).toBeNull();
    expect(copilotReviews).toHaveLength(2);
    expect(copilotReviews?.map((review) => review.decision)).toEqual([
      "changes_requested",
      "approved",
    ]);
    expect(copilotReviews?.every((review) =>
      /^[a-f0-9]{64}$/.test(review.content_sha256),
    )).toBe(true);
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
    browser,
    page,
  }) => {
    const quoteTitle = `E2E reviewed proposal ${Date.now()}`;
    const catalogProductName = `E2E two-room stay ${Date.now()}`;
    const validUntil = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const effectiveFrom = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const { data: catalogProduct, error: catalogProductError } = await admin!
      .from("quote_catalog_products")
      .insert({
        organization_id: organizationIds[0],
        category: "accommodation",
        name: catalogProductName,
        description: "Two rooms",
        unit_label: "room night",
        currency: "INR",
        created_by: userId!,
      })
      .select("id")
      .single();
    expect(catalogProductError).toBeNull();
    const { data: catalogRate, error: catalogRateError } = await admin!
      .from("quote_catalog_rates")
      .insert({
        organization_id: organizationIds[0],
        product_id: catalogProduct!.id,
        version: 1,
        unit_sell_amount: 200000,
        unit_cost_amount: 150000,
        tax_percent: 5,
        valid_from: effectiveFrom,
        published_by: userId!,
      })
      .select("id")
      .single();
    expect(catalogRateError).toBeNull();
    await signIn(page);
    await page.goto("/quotes");

    await page.getByLabel("Minimum gross margin %").fill("20");
    await page.getByLabel("Minimum markup on cost %").fill("25");
    await page.getByLabel("Maximum validity days").fill("60");
    await page.getByLabel("Maximum discount %").fill("3");
    await page.getByLabel("Commission basis").selectOption("net_sell");
    await page.getByLabel("Estimated commission %").fill("5");
    await page.getByLabel("Minimum margin after commission %").fill("15");
    await page
      .getByLabel("Flag terms outside the standard set")
      .check();
    await page
      .getByLabel("Standard customer terms · one per line")
      .fill("Subject to availability");
    await page.getByRole("button", { name: "Save quote guardrails" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Quote guardrails updated",
    );

    await page.getByLabel("Opportunity").selectOption(dealId);
    await page.getByLabel("Quote title").fill(quoteTitle);
    await page.getByLabel("Currency").selectOption("INR");
    await page.getByLabel("Quoted total").fill("520000");
    await page.getByLabel("Valid until").fill(validUntil);
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
    await expect(
      quoteCard.getByLabel("Commercial readiness: Incomplete"),
    ).toContainText("Current cost estimate required");
    await expect(
      quoteCard.getByRole("button", {
        name: "Request human sharing review",
      }),
    ).toBeDisabled();
    await quoteCard.getByLabel("Revise total").fill("545000");
    await quoteCard.getByLabel("Internal estimated cost").fill("410000");
    await quoteCard.getByRole("button", { name: "New version" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Created internal version 2",
    );
    await expect(
      quoteCard.getByLabel("Commercial readiness: Incomplete"),
    ).toContainText("Proposal inclusions and terms required");
    await expect(
      quoteCard.getByRole("button", {
        name: "Request human sharing review",
      }),
    ).toBeDisabled();

    await quoteCard
      .getByText("Define proposal inclusions & terms")
      .click();
    await quoteCard
      .getByLabel("Proposal inclusions")
      .fill("Two rooms with breakfast\nPrivate airport transfers");
    await quoteCard
      .getByLabel("Proposal exclusions")
      .fill("International flights\nPersonal expenses");
    await quoteCard
      .getByLabel("Proposal terms")
      .fill("Subject to availability\nValid only until the quote expiry date");
    await quoteCard
      .getByRole("button", { name: "Save as new proposal version" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Created customer-content version 3",
    );
    await expect(
      quoteCard.getByLabel("Commercial readiness: Exception review"),
    ).toContainText("Terms differ from the standard set");
    await quoteCard.getByText("Customer proposal content").click();
    const proposalPreview = quoteCard.locator(".quote-proposal-preview");
    await expect(
      proposalPreview.getByText("Two rooms with breakfast"),
    ).toBeVisible();
    await expect(
      proposalPreview.getByText("International flights"),
    ).toBeVisible();
    await expect(
      proposalPreview.getByText("Subject to availability"),
    ).toBeVisible();
    const commercialEvidence = quoteCard.getByLabel(
      "Protected markup and commission evidence",
    );
    await expect(commercialEvidence).toContainText(
      /Markup on cost.*1,35,000.*32\.9%/s,
    );
    await expect(commercialEvidence).toContainText(
      /Estimated commission.*27,250.*5\.0% of net sell/s,
    );
    await expect(commercialEvidence).toContainText(
      /Margin after commission.*1,07,750.*19\.8%/s,
    );
    await expect(quoteCard.getByText(/₹5,45,000/).first()).toBeVisible();
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
      current_version: 3,
      status: "draft",
      valid_until: validUntil,
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
      { version: 3, total_amount: 545000 },
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
      .select("id, status, action, entity_id, payload")
      .eq("organization_id", organizationIds[0])
      .eq("action", "quote.share")
      .eq("entity_id", quote!.id)
      .single();
    expect(shareApprovalError).toBeNull();
    expect(shareApproval?.status).toBe("pending");
    expect(shareApproval?.payload).toMatchObject({
      quote_version: 3,
      guardrail_status: "exception_review",
      risk_codes: ["non_standard_terms"],
      external_share_performed: false,
      proposal_content: {
        schema_version: 1,
        inclusion_count: 2,
        exclusion_count: 2,
        term_count: 2,
      },
      guardrail_policy: {
        minimum_margin_percent: 20,
        minimum_markup_percent: 25,
        require_cost_estimate: true,
        require_valid_until: true,
        maximum_validity_days: 60,
        maximum_discount_percent: 3,
        enforce_standard_terms: true,
        standard_term_count: 1,
        commission_basis: "net_sell",
        commission_percent: 5,
        minimum_post_commission_margin_percent: 15,
      },
      commercial_exceptions: {
        discount_percent: 0,
        standard_terms_match: false,
        commission_basis: "net_sell",
        commission_percent: 5,
        commission_policy_current: true,
      },
    });
    const approvalCommercialExceptions = (
      shareApproval?.payload as {
        commercial_exceptions?: {
          gross_markup_percent?: number;
          post_commission_margin_percent?: number;
        };
      }
    ).commercial_exceptions;
    expect(Number(approvalCommercialExceptions?.gross_markup_percent)).toBeCloseTo(
      32.9268,
      4,
    );
    expect(
      Number(approvalCommercialExceptions?.post_commission_margin_percent),
    ).toBeCloseTo(19.7706, 4);
    expect(JSON.stringify(shareApproval?.payload)).not.toContain("410000");
    expect(JSON.stringify(shareApproval?.payload)).not.toContain("545000");
    expect(JSON.stringify(shareApproval?.payload)).not.toContain(
      "Two rooms with breakfast",
    );
    expect(
      String(
        (
          shareApproval?.payload as {
            proposal_content?: { sha256?: string };
          }
        )?.proposal_content?.sha256,
      ),
    ).toHaveLength(64);

    await quoteCard.getByLabel("Revise total").fill("550000");
    await quoteCard.getByLabel("Internal estimated cost").fill("412000");
    await quoteCard.getByRole("button", { name: "New version" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Created internal version 4",
    );
    await expect(quoteCard.getByText("Sharing review pending")).toHaveCount(0);
    await expect(
      quoteCard.getByRole("button", {
        name: "Request human sharing review",
      }),
    ).toBeEnabled();
    const { data: staleApproval, error: staleApprovalError } = await admin!
      .from("approval_requests")
      .select("status, resolved_at")
      .eq("id", shareApproval!.id)
      .single();
    expect(staleApprovalError).toBeNull();
    expect(staleApproval?.status).toBe("cancelled");
    expect(staleApproval?.resolved_at).toBeTruthy();

    await quoteCard.getByText("Build itemized pricing").click();
    await quoteCard
      .getByLabel("Add from current rate catalog")
      .selectOption(catalogRate!.id);
    await expect(
      quoteCard.getByText(
        `Catalog snapshot · ${catalogProductName} · rate v1`,
      ),
    ).toBeVisible();
    await expect(quoteCard.getByLabel("Description 1")).toHaveValue(
      "Two rooms",
    );
    await quoteCard.getByLabel("Quantity 1").fill("2");
    await expect(quoteCard.getByLabel("Unit sell 1")).toHaveValue("200000");
    await expect(quoteCard.getByLabel("Unit sell 1")).toHaveAttribute(
      "readonly",
    );
    await expect(quoteCard.getByLabel("Unit cost · internal 1")).toHaveValue(
      "150000",
    );
    await quoteCard.getByLabel("Line discount 1").fill("20000");
    await expect(quoteCard.getByLabel("Tax % 1")).toHaveValue("5");
    await quoteCard.getByRole("button", { name: "Add line item" }).click();
    await quoteCard.getByLabel("Category 2").selectOption("activity");
    await quoteCard.getByLabel("Description 2").fill("Private experiences");
    await quoteCard.getByLabel("Quantity 2").fill("1");
    await quoteCard.getByLabel("Unit sell 2").fill("100000");
    await quoteCard.getByLabel("Unit cost · internal 2").fill("70000");
    await quoteCard.getByLabel("Line discount 2").fill("0");
    await quoteCard.getByLabel("Tax % 2").fill("5");
    await expect(
      quoteCard.getByLabel("Structured quote preview"),
    ).toContainText(/Customer total.*5,04,000/);
    await expect(
      quoteCard.getByLabel("Structured quote preview"),
    ).toContainText(/Margin.*1,10,000.*22\.9%/);
    await expect(
      quoteCard.getByLabel("Structured quote preview"),
    ).toContainText(/Markup.*1,10,000.*29\.7% on cost/);
    await expect(
      quoteCard.getByLabel("Structured quote preview"),
    ).toContainText(/Commission estimate.*24,000/);
    await expect(
      quoteCard.getByLabel("Structured quote preview"),
    ).toContainText(/After commission.*86,000.*17\.9%/);
    await quoteCard
      .getByRole("button", { name: "Save structured version" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Created structured internal version 5",
    );
    await expect(
      quoteCard.getByLabel("Commercial readiness: Exception review"),
    ).toContainText("22.9% evidenced margin");
    await expect(
      quoteCard.getByLabel("Commercial readiness: Exception review"),
    ).toContainText("4.0% itemized discount");
    await expect(
      quoteCard.getByLabel("Commercial readiness: Exception review"),
    ).toContainText("Discount exceeds the review threshold");
    await expect(
      quoteCard.getByLabel("Commercial readiness: Exception review"),
    ).toContainText("Terms differ from the standard set");
    await expect(quoteCard.getByText("2 customer line items")).toBeVisible();

    const { data: structuredQuote, error: structuredQuoteError } = await admin!
      .from("quotes")
      .select("current_version")
      .eq("id", quote!.id)
      .single();
    expect(structuredQuoteError).toBeNull();
    expect(structuredQuote?.current_version).toBe(5);
    const { data: structuredVersion, error: structuredVersionError } =
      await admin!
        .from("quote_versions")
        .select(
          "id, total_amount, net_amount, tax_amount, margin_amount, margin_percent, terms_snapshot",
        )
        .eq("quote_id", quote!.id)
        .eq("version", 5)
        .single();
    expect(structuredVersionError).toBeNull();
    expect(structuredVersion).toMatchObject({
      total_amount: 504000,
      net_amount: 480000,
      tax_amount: 24000,
      margin_amount: 110000,
    });
    expect(Number(structuredVersion?.margin_percent)).toBeCloseTo(22.9167, 4);
    expect(structuredVersion?.terms_snapshot).toMatchObject({
      schema_version: 1,
      inclusions: ["Two rooms with breakfast", "Private airport transfers"],
      exclusions: ["International flights", "Personal expenses"],
      terms: [
        "Subject to availability",
        "Valid only until the quote expiry date",
      ],
    });
    const { data: customerLines, error: customerLinesError } = await admin!
      .from("quote_line_items")
      .select(
        "description, total_amount, catalog_product_id, catalog_rate_id, supplier_id",
      )
      .eq("quote_version_id", structuredVersion!.id)
      .order("position");
    expect(customerLinesError).toBeNull();
    expect(customerLines).toMatchObject([
      {
        description: "Two rooms",
        total_amount: 399000,
        catalog_product_id: catalogProduct!.id,
        catalog_rate_id: catalogRate!.id,
        supplier_id: null,
      },
      {
        description: "Private experiences",
        total_amount: 105000,
        catalog_product_id: null,
        catalog_rate_id: null,
        supplier_id: null,
      },
    ]);
    expect(customerLines?.some((line) => "unit_cost_amount" in line)).toBe(
      false,
    );
    const { data: protectedCosts, error: protectedCostsError } = await admin!
      .from("quote_line_costs")
      .select("unit_cost_amount, cost_amount")
      .eq("organization_id", organizationIds[0]);
    expect(protectedCostsError).toBeNull();
    expect(protectedCosts).toEqual(
      expect.arrayContaining([
        { unit_cost_amount: 150000, cost_amount: 300000 },
        { unit_cost_amount: 70000, cost_amount: 70000 },
      ]),
    );
    const { data: structuredCost, error: structuredCostError } = await admin!
      .from("quote_cost_estimates")
      .select("estimated_cost_amount")
      .eq("quote_version_id", structuredVersion!.id)
      .single();
    expect(structuredCostError).toBeNull();
    expect(structuredCost?.estimated_cost_amount).toBe(370000);
    const { data: structuredCommercialTerms, error: structuredTermsError } =
      await admin!
        .from("quote_version_commercial_terms")
        .select(
          "estimated_cost_amount, net_sell_amount, gross_markup_amount, gross_markup_percent, commission_basis, commission_percent, commission_base_amount, estimated_commission_amount, post_commission_margin_amount, post_commission_margin_percent",
        )
        .eq("quote_version_id", structuredVersion!.id)
        .single();
    expect(structuredTermsError).toBeNull();
    expect(structuredCommercialTerms).toMatchObject({
      estimated_cost_amount: 370000,
      net_sell_amount: 480000,
      gross_markup_amount: 110000,
      commission_basis: "net_sell",
      commission_percent: 5,
      commission_base_amount: 480000,
      estimated_commission_amount: 24000,
      post_commission_margin_amount: 86000,
    });
    expect(Number(structuredCommercialTerms?.gross_markup_percent)).toBeCloseTo(
      29.7297,
      4,
    );
    expect(
      Number(structuredCommercialTerms?.post_commission_margin_percent),
    ).toBeCloseTo(17.9167, 4);
    await expect(commercialEvidence).toContainText(
      /Markup on cost.*1,10,000.*29\.7%/s,
    );
    await expect(commercialEvidence).toContainText(
      /Estimated commission.*24,000.*5\.0% of net sell/s,
    );
    await expect(commercialEvidence).toContainText(
      /Margin after commission.*86,000.*17\.9%/s,
    );

    await expect(quoteCard.getByLabel("Payment amount 1")).toHaveValue(
      "151200",
    );
    await expect(quoteCard.getByLabel("Payment amount 2")).toHaveValue(
      "352800",
    );
    await quoteCard
      .getByRole("button", { name: "Save exact payment schedule" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Payment schedule revision 1 saved",
    );
    await expect(
      quoteCard.getByLabel(
        "Invoice readiness: Schedule ready · invoice after acceptance",
      ),
    ).toContainText("Schedule revision 1 · 2 milestones");
    const { data: paymentSchedule, error: paymentScheduleError } = await admin!
      .from("quote_payment_schedules")
      .select(
        "id, quote_version_id, revision, status, total_amount, items, item_count, content_sha256",
      )
      .eq("organization_id", organizationIds[0])
      .eq("quote_id", quote!.id)
      .eq("status", "active")
      .single();
    expect(paymentScheduleError).toBeNull();
    expect(paymentSchedule).toMatchObject({
      quote_version_id: structuredVersion!.id,
      revision: 1,
      status: "active",
      total_amount: 504000,
      item_count: 2,
      items: [
        { kind: "deposit", label: "Booking deposit", amount: 151200 },
        { kind: "balance", label: "Final balance", amount: 352800 },
      ],
    });
    expect(paymentSchedule?.content_sha256).toHaveLength(64);

    const previewHref = await quoteCard
      .getByRole("link", { name: "Preview customer version" })
      .getAttribute("href");
    expect(previewHref).toContain(`/quotes/${quote!.id}/preview`);
    const previewPage = await page.context().newPage();
    const previewResponse = await previewPage.goto(previewHref!);
    expect(previewResponse?.status()).toBe(200);
    await expect(
      previewPage.getByText("INTERNAL CUSTOMER PREVIEW"),
    ).toBeVisible();
    await expect(
      previewPage.getByRole("heading", { name: quoteTitle }),
    ).toBeVisible();
    await expect(previewPage.getByText("Prepared for Aarav Sharma")).toBeVisible();
    await expect(
      previewPage.getByRole("table", { name: "Customer quote line items" }),
    ).toContainText("Two rooms");
    await expect(previewPage.getByText("Two rooms with breakfast")).toBeVisible();
    await expect(
      previewPage.getByRole("heading", { name: "Payment schedule" }),
    ).toBeVisible();
    await expect(previewPage.getByText("Booking deposit")).toBeVisible();
    await expect(previewPage.getByText("Final balance")).toBeVisible();
    await expect(previewPage.getByText(/₹5,04,000/).first()).toBeVisible();
    await expect(
      previewPage.getByRole("button", { name: "Print or save PDF" }),
    ).toBeVisible();
    const previewBody = previewPage.locator("body");
    await expect(previewBody).not.toContainText("estimated cost");
    await expect(previewBody).not.toContainText("gross margin");
    await expect(previewBody).not.toContainText("catalog snapshot");
    await expect(previewBody).not.toContainText("₹3,70,000");
    await previewPage.setViewportSize({ width: 390, height: 844 });
    const previewOverflow = await previewPage.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(previewOverflow).toBeLessThanOrEqual(1);
    await previewPage.close();

    await quoteCard
      .getByRole("button", { name: "Request human sharing review" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Human sharing review requested",
    );
    const { data: scheduledApproval, error: scheduledApprovalError } =
      await admin!
        .from("approval_requests")
        .select("payload")
        .eq("organization_id", organizationIds[0])
        .eq("entity_id", quote!.id)
        .eq("action", "quote.share")
        .eq("status", "pending")
        .single();
    expect(scheduledApprovalError).toBeNull();
    expect(scheduledApproval?.payload).toMatchObject({
      quote_version: 5,
      payment_schedule: {
        configured: true,
        revision: 1,
        item_count: 2,
        invoice_created: false,
        receivable_created: false,
      },
    });
    expect(
      String(
        (
          scheduledApproval?.payload as {
            payment_schedule?: { content_sha256?: string };
          }
        )?.payment_schedule?.content_sha256,
      ),
    ).toHaveLength(64);
    expect(JSON.stringify(scheduledApproval?.payload)).not.toContain(
      "Booking deposit",
    );
    await page.goto("/aios");
    const quoteApprovalCard = page
      .locator(".aios-approvals article")
      .filter({ hasText: "quote share" })
      .first();
    await expect(quoteApprovalCard).toContainText(
      "Quote version 5 passed deterministic readiness checks",
    );
    await quoteApprovalCard.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status")).toContainText("Approval approved");

    await page.goto("/quotes");
    await expect(
      quoteCard.getByText("Approved · ready to publish"),
    ).toBeVisible();
    await quoteCard.getByLabel("Link lifetime").selectOption("7");
    await quoteCard
      .getByRole("button", { name: "Publish approved proposal" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Approved proposal published",
    );
    await expect(quoteCard.getByText("Public link active")).toBeVisible();
    await expect(quoteCard.getByText("Private proposal is live")).toBeVisible();

    const publicProposalHref = await quoteCard
      .getByRole("link", { name: "Open public proposal" })
      .getAttribute("href");
    expect(publicProposalHref).toMatch(/^\/proposal\/[A-Za-z0-9_-]{43}$/);
    const rawToken = publicProposalHref!.split("/").at(-1)!;
    const { data: storedShare, error: storedShareError } = await admin!
      .from("quote_share_links")
      .select("id, token_hash, status, snapshot, expires_at")
      .eq("quote_id", quote!.id)
      .single();
    expect(storedShareError).toBeNull();
    expect(storedShare?.status).toBe("active");
    expect(storedShare?.token_hash).toHaveLength(64);
    expect(storedShare?.token_hash).not.toBe(rawToken);
    expect(storedShare?.snapshot).toMatchObject({
      schema_version: 1,
      customer: { name: "Aarav Sharma", destination: "Kyoto, Japan" },
      quote: {
        title: quoteTitle,
        version: 5,
        currency: "INR",
        total_amount: 504000,
        payment_schedule: [
          { kind: "deposit", label: "Booking deposit", amount: 151200 },
          { kind: "balance", label: "Final balance", amount: 352800 },
        ],
        content: {
          inclusions: [
            "Two rooms with breakfast",
            "Private airport transfers",
          ],
        },
      },
    });
    const storedSnapshotText = JSON.stringify(storedShare?.snapshot);
    expect(storedSnapshotText).not.toMatch(
      /unit_cost|estimated_cost|margin|supplier|catalog|deal_id|contact_id/i,
    );

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    const publicProposalUrl = new URL(publicProposalHref!, page.url()).toString();
    const publicResponse = await publicPage.goto(publicProposalUrl);
    expect(publicResponse?.status()).toBe(200);
    await expect(
      publicPage.getByRole("heading", { name: quoteTitle }),
    ).toBeVisible();
    await expect(publicPage.getByText("Prepared for Aarav Sharma")).toBeVisible();
    await expect(
      publicPage.getByRole("table", { name: "Proposal line items" }),
    ).toContainText("Two rooms");
    await expect(publicPage.getByText("Two rooms with breakfast")).toBeVisible();
    await expect(
      publicPage.getByRole("heading", { name: "Payment schedule" }),
    ).toBeVisible();
    await expect(publicPage.getByText("Booking deposit")).toBeVisible();
    await expect(publicPage.getByText("Final balance")).toBeVisible();
    await expect(publicPage.getByText(/₹5,04,000/).first()).toBeVisible();
    await expect(
      publicPage.getByRole("button", { name: "Print or save PDF" }),
    ).toBeVisible();
    await expect(publicPage.locator("body")).not.toContainText("estimated cost");
    await expect(publicPage.locator("body")).not.toContainText("gross margin");
    await expect(publicPage.locator("body")).not.toContainText("catalog snapshot");
    await expect(publicPage.locator("body")).not.toContainText("₹3,70,000");
    await publicPage.setViewportSize({ width: 390, height: 844 });
    expect(
      await publicPage.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await expect(
      publicPage.getByRole("heading", { name: "Accept this proposal" }),
    ).toBeVisible();
    await publicPage.getByLabel("Your full name").fill("Aarav Sharma");
    await publicPage.getByRole("checkbox").check();
    await publicPage
      .getByRole("button", { name: "Accept this proposal" })
      .click();
    await expect(publicPage.getByText("Proposal accepted")).toBeVisible();
    await expect(publicPage.getByText(/does not itself confirm bookings/i)).toHaveCount(0);

    const acceptedResponse = await publicPage.reload();
    expect(acceptedResponse?.status()).toBe(200);
    await expect(publicPage.getByText("Proposal accepted")).toBeVisible();
    await expect(
      publicPage.getByRole("button", { name: "Accept this proposal" }),
    ).toHaveCount(0);

    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const [acceptanceEvidence, acceptedQuote, acceptedSnapshot] =
      await Promise.all([
        admin!
          .from("quote_acceptances")
          .select(
            "id, quote_version_id, quote_share_link_id, signatory_name, statement_version, snapshot_sha256, accepted_at",
          )
          .eq("quote_id", quote!.id)
          .single(),
        admin!
          .from("quotes")
          .select("status, accepted_at, deal_id")
          .eq("id", quote!.id)
          .single(),
        admin!.rpc("get_quote_share_snapshot", {
          target_token_hash: tokenHash,
        }),
      ]);
    expect(acceptanceEvidence.error).toBeNull();
    expect(acceptanceEvidence.data).toMatchObject({
      quote_version_id: paymentSchedule!.quote_version_id,
      quote_share_link_id: storedShare!.id,
      signatory_name: "Aarav Sharma",
      statement_version: 1,
    });
    expect(acceptanceEvidence.data?.snapshot_sha256).toHaveLength(64);
    expect(acceptanceEvidence.data?.accepted_at).toBeTruthy();
    expect(acceptedQuote.error).toBeNull();
    expect(acceptedQuote.data?.status).toBe("accepted");
    expect(acceptedQuote.data?.accepted_at).toBeTruthy();
    expect(acceptedSnapshot.error).toBeNull();
    const acceptedSnapshotData = quoteShareSnapshotSchema.parse(
      acceptedSnapshot.data,
    );
    expect(acceptedSnapshotData.acceptance).toMatchObject({
      status: "accepted",
      statement_version: 1,
    });
    expect(JSON.stringify(acceptedSnapshotData.acceptance)).not.toMatch(
      /Aarav Sharma|snapshot_sha256|acceptance_id/,
    );

    await page.reload();
    await expect(quoteCard.locator(".quote-status")).toHaveText("accepted");
    await expect(
      quoteCard.getByLabel(
        "Invoice readiness: Accepted schedule is invoice-ready",
      ),
    ).toBeVisible();
    await expect(
      quoteCard.getByLabel("Customer acceptance evidence"),
    ).toContainText("Accepted by Aarav Sharma");
    await expect(
      quoteCard.getByLabel("Customer acceptance evidence"),
    ).toContainText(
      "It did not create a booking, invoice, receivable, payment, or message",
    );

    const receivableHandoff = quoteCard.getByLabel(
      "Accepted quote receivable handoff",
    );
    await expect(receivableHandoff).toContainText(
      "Accepted schedule is ready for the ledger",
    );
    await receivableHandoff
      .getByRole("button", { name: "Create internal receivable schedule" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "2 internal receivable milestones created",
    );
    await expect(receivableHandoff).toContainText(
      "2 receivable milestones recorded",
    );
    await expect(receivableHandoff).toContainText("Booking deposit");
    await expect(receivableHandoff).toContainText("Final balance");
    await expect(receivableHandoff).toContainText(
      "No traveler was charged or contacted",
    );
    const { data: quoteReceivables, error: quoteReceivablesError } = await admin!
      .from("payments")
      .select(
        "quote_id, quote_version_id, quote_acceptance_id, quote_payment_schedule_id, quote_schedule_item_position, direction, status, title, invoice_number, amount, paid_amount, currency, due_at",
      )
      .eq("quote_id", quote!.id)
      .order("quote_schedule_item_position");
    expect(quoteReceivablesError).toBeNull();
    expect(quoteReceivables).toMatchObject([
      {
        quote_version_id: paymentSchedule!.quote_version_id,
        quote_acceptance_id: acceptanceEvidence.data!.id,
        quote_payment_schedule_id: paymentSchedule!.id,
        quote_schedule_item_position: 0,
        direction: "receivable",
        title: "Booking deposit",
        invoice_number: null,
        amount: 151200,
        paid_amount: 0,
        currency: "INR",
      },
      {
        quote_version_id: paymentSchedule!.quote_version_id,
        quote_acceptance_id: acceptanceEvidence.data!.id,
        quote_payment_schedule_id: paymentSchedule!.id,
        quote_schedule_item_position: 1,
        direction: "receivable",
        title: "Final balance",
        invoice_number: null,
        amount: 352800,
        paid_amount: 0,
        currency: "INR",
      },
    ]);
    expect(
      quoteReceivables?.reduce(
        (sum, receivable) => sum + Number(receivable.amount),
        0,
      ),
    ).toBe(504000);

    await page.goto("/finance");
    const depositReceivable = page
      .locator(".payment-card")
      .filter({ hasText: "Booking deposit" });
    await expect(depositReceivable).toContainText("ACCEPTED QUOTE");
    await expect(depositReceivable).toContainText(
      "no invoice document was issued or delivered",
    );
    await expect(
      depositReceivable.getByRole("link", { name: "Review quote evidence" }),
    ).toHaveAttribute("href", "/quotes");
    await page.getByLabel("Invoice number prefix").fill("INV/2027-");
    await page.getByLabel("Next preview number").fill("42");
    await page.getByLabel("Number padding").fill("5");
    await page.getByRole("button", { name: "Save preview policy" }).click();
    await expect(page.getByRole("status")).toContainText(
      "No legal number was allocated",
    );
    const invoiceDraftCard = page
      .locator(".invoice-draft-card")
      .filter({ hasText: "ACCEPTED QUOTE" });
    await expect(invoiceDraftCard).toContainText("2 MILESTONES");
    await invoiceDraftCard
      .getByRole("button", { name: "Prepare exact invoice draft" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Invoice draft revision 1 prepared",
    );
    await expect(invoiceDraftCard).toContainText("INV/2027-00042");
    await expect(invoiceDraftCard).toContainText("Aarav Sharma");
    await expect(invoiceDraftCard).toContainText("2 lines · 2 terms");
    await expect(invoiceDraftCard).toContainText("current preview policy");
    await expect(invoiceDraftCard).toContainText(
      "no legal number, document, delivery, message, charge, or settlement",
    );
    const { data: firstInvoiceDraft, error: firstInvoiceDraftError } =
      await admin!
        .from("invoice_drafts")
        .select(
          "id, quote_version_id, quote_acceptance_id, quote_payment_schedule_id, revision, status, number_preview, bill_to_name, currency, net_amount, tax_amount, total_amount, line_count, payment_term_count, line_items, payment_terms, content_sha256",
        )
        .eq("quote_id", quote!.id)
        .eq("status", "ready")
        .single();
    expect(firstInvoiceDraftError).toBeNull();
    expect(firstInvoiceDraft).toMatchObject({
      quote_version_id: paymentSchedule!.quote_version_id,
      quote_acceptance_id: acceptanceEvidence.data!.id,
      quote_payment_schedule_id: paymentSchedule!.id,
      revision: 1,
      status: "ready",
      number_preview: "INV/2027-00042",
      bill_to_name: "Aarav Sharma",
      currency: "INR",
      net_amount: 480000,
      tax_amount: 24000,
      total_amount: 504000,
      line_count: 2,
      payment_term_count: 2,
    });
    expect(firstInvoiceDraft?.content_sha256).toHaveLength(64);
    expect(firstInvoiceDraft?.line_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "Two rooms" }),
        expect.objectContaining({ description: "Private experiences" }),
      ]),
    );
    expect(firstInvoiceDraft?.payment_terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Booking deposit" }),
        expect.objectContaining({ label: "Final balance" }),
      ]),
    );
    await page.getByLabel("Next preview number").fill("43");
    await page.getByRole("button", { name: "Save preview policy" }).click();
    await expect(invoiceDraftCard).toContainText("preview policy changed");
    await invoiceDraftCard
      .getByRole("button", { name: "Prepare revised draft" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Invoice draft revision 2 prepared",
    );
    await expect(invoiceDraftCard).toContainText("INV/2027-00043");
    const { data: invoiceDraftHistory, error: invoiceDraftHistoryError } =
      await admin!
        .from("invoice_drafts")
        .select("id, revision, status, number_preview, superseded_at")
        .eq("quote_id", quote!.id)
        .order("revision");
    expect(invoiceDraftHistoryError).toBeNull();
    expect(invoiceDraftHistory).toMatchObject([
      { revision: 1, status: "superseded", number_preview: "INV/2027-00042" },
      { revision: 2, status: "ready", number_preview: "INV/2027-00043" },
    ]);
    expect(invoiceDraftHistory?.[0]?.superseded_at).toBeTruthy();
    const revisedInvoiceDraftId = invoiceDraftHistory?.[1]?.id;
    if (!revisedInvoiceDraftId)
      throw new Error("Revised invoice draft fixture is unavailable.");
    const { data: unchangedQuoteReceivables } = await admin!
      .from("payments")
      .select("invoice_number")
      .eq("quote_id", quote!.id);
    expect(
      unchangedQuoteReceivables?.every(
        (receivable) => receivable.invoice_number === null,
      ),
    ).toBe(true);
    await page
      .getByLabel("Legal business name")
      .fill("StateAI Travel Private Limited");
    await page
      .getByLabel("Registered address")
      .fill("12 Fictional Market Road, Bengaluru, Karnataka 560001");
    await page.getByLabel("Country code").fill("IN");
    await page.getByLabel("Tax registration ID").fill("29ABCDE1234F1Z5");
    await page.getByRole("button", { name: "Save issuer identity" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Invoice issuer identity saved",
    );
    await invoiceDraftCard
      .getByLabel("Issuance review rationale")
      .fill(
        "Finance verified the exact accepted quote, customer totals, payment milestones, bill-to identity, and issuer identity.",
      );
    await invoiceDraftCard
      .getByRole("button", { name: "Request human issuance approval" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Exact invoice issuance review requested",
    );
    await expect(
      invoiceDraftCard.getByRole("link", {
        name: "Open AIOS approval queue",
      }),
    ).toHaveAttribute("href", "/aios#approval-queue");
    const { data: invoiceApproval, error: invoiceApprovalError } = await admin!
      .from("approval_requests")
      .select("id, status, action, entity_id, payload")
      .eq("action", "invoice.issue")
      .eq("entity_id", revisedInvoiceDraftId)
      .single();
    expect(invoiceApprovalError).toBeNull();
    expect(invoiceApproval).toMatchObject({
      status: "pending",
      action: "invoice.issue",
      entity_id: revisedInvoiceDraftId,
    });
    expect(invoiceApproval?.payload).toMatchObject({
      draft_revision: 2,
      number_preview: "INV/2027-00043",
      invoice_number_allocated: false,
      invoice_issued: false,
      invoice_delivered: false,
      external_action_performed: false,
    });
    expect(
      (invoiceApproval?.payload as { draft_content_sha256?: string })
        .draft_content_sha256,
    ).toHaveLength(64);
    expect(
      (invoiceApproval?.payload as { issuer_profile_sha256?: string })
        .issuer_profile_sha256,
    ).toHaveLength(64);
    await page.goto("/aios#approval-queue");
    const invoiceApprovalCard = page
      .locator(".aios-approvals article")
      .filter({ hasText: "invoice issue" });
    await expect(invoiceApprovalCard).toContainText(
      "Finance verified the exact accepted quote",
    );
    await invoiceApprovalCard.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status")).toContainText("Approval approved");
    await page.goto("/finance");
    const approvedInvoiceDraftCard = page
      .locator(".invoice-draft-card")
      .filter({ hasText: "INV/2027-00043" });
    await expect(approvedInvoiceDraftCard).toContainText(
      "Human approval recorded for this exact hash",
    );
    await approvedInvoiceDraftCard
      .getByRole("button", { name: "Allocate number and issue record" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Invoice INV/2027-00043 issued atomically",
    );
    await expect(approvedInvoiceDraftCard).toContainText(
      "permanent issuance evidence recorded",
    );
    await expect(approvedInvoiceDraftCard).toContainText(
      "no rendered document, delivery, message, payment link, charge, or settlement",
    );
    const { data: issuedInvoice, error: issuedInvoiceError } = await admin!
      .from("invoice_issuances")
      .select(
        "id, invoice_draft_id, approval_request_id, quote_version_id, quote_acceptance_id, quote_payment_schedule_id, draft_revision, invoice_number, sequence_value, issuer_legal_name, issuer_registered_address, issuer_jurisdiction_country_code, issuer_tax_registration_id, bill_to_name, currency, net_amount, tax_amount, total_amount, line_count, payment_term_count, source_content_sha256, issuance_sha256",
      )
      .eq("quote_id", quote!.id)
      .single();
    expect(issuedInvoiceError).toBeNull();
    expect(issuedInvoice).toMatchObject({
      invoice_draft_id: revisedInvoiceDraftId,
      approval_request_id: invoiceApproval!.id,
      quote_version_id: paymentSchedule!.quote_version_id,
      quote_acceptance_id: acceptanceEvidence.data!.id,
      quote_payment_schedule_id: paymentSchedule!.id,
      draft_revision: 2,
      invoice_number: "INV/2027-00043",
      sequence_value: 43,
      issuer_legal_name: "StateAI Travel Private Limited",
      issuer_jurisdiction_country_code: "IN",
      issuer_tax_registration_id: "29ABCDE1234F1Z5",
      bill_to_name: "Aarav Sharma",
      currency: "INR",
      net_amount: 480000,
      tax_amount: 24000,
      total_amount: 504000,
      line_count: 2,
      payment_term_count: 2,
    });
    expect(issuedInvoice?.source_content_sha256).toHaveLength(64);
    expect(issuedInvoice?.issuance_sha256).toHaveLength(64);
    const { data: policyAfterIssuance } = await admin!
      .from("invoice_number_policies")
      .select("next_number")
      .eq("organization_id", organizationIds[0])
      .single();
    expect(Number(policyAfterIssuance?.next_number)).toBe(44);
    const { data: linkedInvoiceReceivables } = await admin!
      .from("payments")
      .select("invoice_issuance_id, invoice_number")
      .eq("quote_id", quote!.id);
    expect(linkedInvoiceReceivables).toHaveLength(2);
    expect(
      linkedInvoiceReceivables?.every(
        (receivable) =>
          receivable.invoice_issuance_id === issuedInvoice!.id &&
          receivable.invoice_number === null,
      ),
    ).toBe(true);

    await expect(approvedInvoiceDraftCard).toContainText(
      "DOCUMENT NOT RENDERED",
    );
    await expect(approvedInvoiceDraftCard).toContainText(
      "jurisdiction review required",
    );
    await approvedInvoiceDraftCard
      .getByRole("button", { name: "Render private invoice PDF" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "rendered with immutable checksum evidence",
    );
    await expect(approvedInvoiceDraftCard).toContainText("PRIVATE PDF READY");
    await expect(approvedInvoiceDraftCard).toContainText(
      "inv-2027-00043.pdf",
    );
    await expect(approvedInvoiceDraftCard).toContainText(
      "Private rendering only · no delivery, customer message, payment link, charge, or settlement",
    );
    const { data: invoiceDocument, error: invoiceDocumentError } = await admin!
      .from("invoice_documents")
      .select(
        "id, invoice_issuance_id, invoice_number, renderer_version, compliance_status, storage_bucket, storage_path, file_name, mime_type, byte_size, source_issuance_sha256, content_sha256, generated_by, generated_at",
      )
      .eq("invoice_issuance_id", issuedInvoice!.id)
      .single();
    expect(invoiceDocumentError).toBeNull();
    expect(invoiceDocument).toMatchObject({
      invoice_issuance_id: issuedInvoice!.id,
      invoice_number: "INV/2027-00043",
      renderer_version: "invoice-record-v1",
      compliance_status: "jurisdiction_review_required",
      storage_bucket: "invoice-documents",
      file_name: "inv-2027-00043.pdf",
      mime_type: "application/pdf",
      source_issuance_sha256: issuedInvoice!.issuance_sha256,
      generated_by: userId,
    });
    expect(invoiceDocument?.storage_path).toBe(
      `${organizationIds[0]}/${issuedInvoice!.id}/invoice-record-v1/${invoiceDocument!.content_sha256}.pdf`,
    );
    expect(invoiceDocument?.content_sha256).toHaveLength(64);
    expect(Number(invoiceDocument?.byte_size)).toBeGreaterThan(512);
    const { data: invoiceRenderAudit, error: invoiceRenderAuditError } =
      await admin!
        .from("audit_events")
        .select("metadata")
        .eq("entity_id", invoiceDocument!.id)
        .eq("metadata->>event", "finance.invoice_document_rendered")
        .single();
    expect(invoiceRenderAuditError).toBeNull();
    expect(invoiceRenderAudit?.metadata).toMatchObject({
      invoice_issuance_id: issuedInvoice!.id,
      renderer_version: "invoice-record-v1",
      source_issuance_sha256: issuedInvoice!.issuance_sha256,
      content_sha256: invoiceDocument!.content_sha256,
      invoice_rendered: true,
      invoice_delivered: false,
      message_sent: false,
      payment_link_created: false,
      payment_collected: false,
      external_action_performed: false,
    });

    const invoiceDownloadEvent = page.waitForEvent("download");
    await approvedInvoiceDraftCard
      .getByRole("button", { name: "Secure PDF download" })
      .click();
    const invoiceDownload = await invoiceDownloadEvent;
    expect(invoiceDownload.suggestedFilename()).toBe("inv-2027-00043.pdf");
    const invoiceDownloadStream = await invoiceDownload.createReadStream();
    const invoiceDownloadChunks: Buffer[] = [];
    for await (const chunk of invoiceDownloadStream)
      invoiceDownloadChunks.push(Buffer.from(chunk));
    const downloadedInvoiceBytes = Buffer.concat(invoiceDownloadChunks);
    expect(downloadedInvoiceBytes.subarray(0, 5).toString("ascii")).toBe(
      "%PDF-",
    );
    expect(
      createHash("sha256").update(downloadedInvoiceBytes).digest("hex"),
    ).toBe(invoiceDocument!.content_sha256);
    await expect(page.getByRole("status")).toContainText(
      "Secure invoice download issued for 60 seconds",
    );
    const { data: invoiceAccessAudit, error: invoiceAccessAuditError } =
      await admin!
        .from("audit_events")
        .select("metadata")
        .eq("entity_id", invoiceDocument!.id)
        .eq("metadata->>event", "finance.invoice_document_accessed")
        .single();
    expect(invoiceAccessAuditError).toBeNull();
    expect(invoiceAccessAudit?.metadata).toMatchObject({
      content_sha256: invoiceDocument!.content_sha256,
      signed_url_ttl_seconds: 60,
      invoice_delivered: false,
      external_action_performed: false,
    });

    const collectionControl = page
      .locator(".payment-card")
      .filter({ hasText: "Booking deposit" })
      .locator(".payment-link-readiness");
    await expect(collectionControl).toContainText(
      "Prepare an exact payment request",
    );
    await expect(collectionControl).toContainText(
      "No provider link · no customer message · no charge · no settlement",
    );
    await collectionControl
      .getByRole("button", { name: "Prepare exact payment request" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Payment-request revision 1 prepared",
    );
    await expect(collectionControl).toContainText("Exact balance");
    await expect(collectionControl).toContainText("INV/2027-00043");
    await collectionControl
      .getByLabel("Collection review rationale")
      .fill(
        "Finance verified the permanent invoice, currency, due date, and exact current outstanding balance.",
      );
    await collectionControl
      .getByRole("button", {
        name: "Request human payment-link approval",
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Payment-link review requested",
    );
    await expect(
      collectionControl.getByRole("link", { name: "Open AIOS approval queue" }),
    ).toHaveAttribute("href", "/aios#approval-queue");
    const { data: paymentLinkDraft, error: paymentLinkDraftError } =
      await admin!
        .from("payment_link_drafts")
        .select(
          "id, payment_id, invoice_issuance_id, revision, status, currency, requested_amount, invoice_number, source_issuance_sha256, evidence_sha256",
        )
        .eq("invoice_issuance_id", issuedInvoice!.id)
        .eq("status", "ready")
        .order("created_at")
        .limit(1)
        .single();
    expect(paymentLinkDraftError).toBeNull();
    expect(paymentLinkDraft).toMatchObject({
      invoice_issuance_id: issuedInvoice!.id,
      revision: 1,
      status: "ready",
      currency: "INR",
      requested_amount: 151200,
      invoice_number: "INV/2027-00043",
    });
    expect(paymentLinkDraft?.source_issuance_sha256).toBe(
      issuedInvoice!.issuance_sha256,
    );
    expect(paymentLinkDraft?.evidence_sha256).toHaveLength(64);
    const { data: paymentLinkApproval, error: paymentLinkApprovalError } =
      await admin!
        .from("approval_requests")
        .select("id, action, entity_type, entity_id, status, payload")
        .eq("action", "payment.link.create")
        .eq("entity_id", paymentLinkDraft!.id)
        .single();
    expect(paymentLinkApprovalError).toBeNull();
    expect(paymentLinkApproval).toMatchObject({
      action: "payment.link.create",
      entity_type: "payment_link_draft",
      entity_id: paymentLinkDraft!.id,
      status: "pending",
      payload: {
        payment_link_draft_id: paymentLinkDraft!.id,
        payment_id: paymentLinkDraft!.payment_id,
        invoice_issuance_id: issuedInvoice!.id,
        invoice_number: "INV/2027-00043",
        revision: 1,
        currency: "INR",
        requested_amount: 151200,
        evidence_sha256: paymentLinkDraft!.evidence_sha256,
        provider_link_created: false,
        message_sent: false,
        payment_collected: false,
        external_action_performed: false,
      },
    });
    await page.goto("/aios#approval-queue");
    const paymentLinkApprovalCard = page
      .locator(".aios-approvals article")
      .filter({ hasText: "payment link create" });
    await expect(paymentLinkApprovalCard).toContainText(
      "Finance verified the permanent invoice",
    );
    await paymentLinkApprovalCard
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(page.getByRole("status")).toContainText("Approval approved");
    await page.goto("/finance");
    const approvedCollectionControl = page
      .locator(".payment-card")
      .filter({ hasText: "Booking deposit" })
      .locator(".payment-link-readiness");
    await expect(approvedCollectionControl).toContainText(
      "Human approval recorded for this exact hash",
    );
    await expect(approvedCollectionControl).toContainText(
      "Provider handoff ready",
    );
    await expect(approvedCollectionControl).toContainText(
      "Live payment-link creation remains disabled",
    );
    await expect(approvedCollectionControl).toContainText(
      "No provider link · no customer message · no charge · no settlement",
    );
    const { data: approvedPaymentLinkEvidence } = await admin!
      .from("approval_requests")
      .select("status, payload")
      .eq("id", paymentLinkApproval!.id)
      .single();
    expect(approvedPaymentLinkEvidence).toMatchObject({
      status: "approved",
      payload: {
        provider_link_created: false,
        message_sent: false,
        payment_collected: false,
        external_action_performed: false,
      },
    });

    await page.goto(`/leads/${dealId}`);
    const commercialTruth = page.locator("#commercial-truth");
    await expect(
      commercialTruth.getByRole("heading", {
        name: "Accepted value is linked through issuance",
      }),
    ).toBeVisible();
    const evidenceTrail = commercialTruth.getByRole("list", {
      name: "Commercial evidence trail",
    });
    await expect(evidenceTrail).toContainText(/Proposal.*Version 5.*accepted/s);
    await expect(evidenceTrail).toContainText(/Customer commitment.*Accepted/s);
    await expect(evidenceTrail).toContainText(/Finance evidence.*2 receivables issued/s);
    await expect(evidenceTrail).toContainText(
      /Pipeline decision.*human decision open/s,
    );
    await expect(commercialTruth).toContainText(/Customer total.*5,04,000/s);
    await expect(commercialTruth).toContainText(/Net sell.*4,80,000/s);
    await expect(commercialTruth).toContainText(/Gross margin estimate.*1,10,000.*22\.9%/s);
    await expect(commercialTruth).toContainText(/After commission estimate.*86,000.*17\.9%/s);
    await expect(commercialTruth).toContainText(/2 exact receivables.*5,04,000.*scheduled/s);
    await expect(
      commercialTruth.getByText("Review the Won transition", { exact: true }),
    ).toBeVisible();
    await expect(commercialTruth.getByText(/not prediction/i)).toBeVisible();
    await expect(commercialTruth.getByText(/0 model calls/i)).toBeVisible();

    await page.goto("/quotes");
    await expect(quoteCard.locator(".quote-status")).toHaveText("accepted");

    await quoteCard
      .getByLabel("Revocation reason")
      .fill("Customer requested a revised public proposal");
    await quoteCard
      .getByRole("button", { name: "Revoke public proposal" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Public proposal access revoked",
    );
    await expect(quoteCard.getByText("Public link active")).toHaveCount(0);
    await expect(
      quoteCard.getByRole("button", {
        name: "Request new human sharing review",
      }),
    ).toHaveCount(0);
    await expect(quoteCard.locator(".quote-status")).toHaveText("accepted");
    const revokedResponse = await publicPage.reload();
    expect(revokedResponse?.status()).toBe(404);
    await publicContext.close();

    const { data: revokedShare, error: revokedShareError } = await admin!
      .from("quote_share_links")
      .select("status, revoked_at, revocation_note")
      .eq("id", storedShare!.id)
      .single();
    expect(revokedShareError).toBeNull();
    expect(revokedShare).toMatchObject({
      status: "revoked",
      revocation_note: "Customer requested a revised public proposal",
    });
    expect(revokedShare?.revoked_at).toBeTruthy();
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
    const { data: convertedTrip, error: convertedTripError } = await admin!
      .from("trips")
      .select("deal_id")
      .eq("id", operationalTripId)
      .single();
    expect(convertedTripError).toBeNull();
    expect(convertedTrip?.deal_id).toBeTruthy();
    const { error: stableWonDateError } = await admin!
      .from("deals")
      .update({ won_at: "2026-07-25T12:00:00.000Z" })
      .eq("id", convertedTrip!.deal_id!);
    expect(stableWonDateError).toBeNull();
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
    const catalogProductName = `E2E airport transfer ${suffix}`;
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

    const createSupplierForm = page
      .locator(".supplier-forms details")
      .filter({ hasText: "Create supplier profile" });
    await createSupplierForm.locator("summary").click();
    await expect(createSupplierForm).toHaveAttribute("open", "");
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

    const createCatalogForm = page
      .locator(".quote-catalog details")
      .filter({ hasText: "Create product and first rate" });
    await createCatalogForm.getByText("Create product and first rate").click();
    await createCatalogForm.getByLabel("Product name").fill(catalogProductName);
    await createCatalogForm.getByLabel("Category").selectOption("transport");
    await createCatalogForm
      .getByLabel("Quote description")
      .fill("Private airport transfer");
    await createCatalogForm.getByLabel("Unit label").fill("vehicle");
    await createCatalogForm
      .getByLabel("Supplier")
      .selectOption({ label: supplierName });
    await createCatalogForm.getByLabel("Currency").fill("INR");
    await createCatalogForm.getByLabel("Unit sell").fill("12000");
    await createCatalogForm
      .getByLabel("Unit cost · protected")
      .fill("8000");
    await createCatalogForm.getByLabel("Tax %").fill("5");
    await createCatalogForm
      .getByRole("button", { name: "Create reusable product" })
      .click();
    await expect(
      page.locator(".quote-catalog").getByRole("status"),
    ).toContainText(
      "Reusable product and rate published internally",
    );

    const catalogCard = page
      .locator(".quote-catalog-grid article")
      .filter({ hasText: catalogProductName });
    await expect(catalogCard).toContainText(supplierName);
    await expect(catalogCard).toContainText("₹12,000");
    await expect(catalogCard).toContainText("₹8,000");
    await expect(catalogCard).toContainText("v1");

    const publishCatalogRateForm = page
      .locator(".quote-catalog details")
      .filter({ hasText: "Publish a new immutable rate" });
    await publishCatalogRateForm
      .getByText("Publish a new immutable rate")
      .click();
    await publishCatalogRateForm
      .getByLabel("Product")
      .selectOption({ label: `${catalogProductName} · INR` });
    await publishCatalogRateForm.getByLabel("Unit sell").fill("13000");
    await publishCatalogRateForm
      .getByLabel("Unit cost · protected")
      .fill("8500");
    await publishCatalogRateForm.getByLabel("Tax %").fill("5");
    await publishCatalogRateForm
      .getByRole("button", { name: "Publish rate version" })
      .click();
    await expect(
      page.locator(".quote-catalog").getByRole("status"),
    ).toContainText(
      "Published immutable rate version 2",
    );
    await expect(catalogCard).toContainText("₹13,000");
    await expect(catalogCard).toContainText("₹8,500");
    await expect(catalogCard).toContainText("v2");

    const catalogLifecycleForm = page
      .locator(".quote-catalog details")
      .filter({ hasText: "Archive or restore a product" });
    await catalogLifecycleForm
      .getByText("Archive or restore a product")
      .click();
    await catalogLifecycleForm
      .getByLabel("Product")
      .selectOption({ label: catalogProductName });
    await catalogLifecycleForm.getByLabel("Status").selectOption("archived");
    await catalogLifecycleForm
      .getByLabel("Accountable reason")
      .fill("Temporarily remove this rate from new quote selection.");
    await catalogLifecycleForm
      .getByRole("button", { name: "Update lifecycle" })
      .click();
    await expect(
      page.locator(".quote-catalog").getByRole("status"),
    ).toContainText("is now archived");
    await expect(catalogCard).toContainText("archived");

    await catalogLifecycleForm
      .getByLabel("Product")
      .selectOption({ label: catalogProductName });
    await catalogLifecycleForm.getByLabel("Status").selectOption("active");
    await catalogLifecycleForm
      .getByLabel("Accountable reason")
      .fill("Human review confirmed this product can be quoted again.");
    await catalogLifecycleForm
      .getByRole("button", { name: "Update lifecycle" })
      .click();
    await expect(
      page.locator(".quote-catalog").getByRole("status"),
    ).toContainText("is now active");
    await expect(catalogCard).toContainText("active");
    await page.reload();

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

    const ledgerCreate = page.locator(".ledger-create");
    await ledgerCreate.getByLabel("Payment direction").selectOption("payable");
    await ledgerCreate.getByLabel("Obligation title").fill(paymentTitle);
    await ledgerCreate.getByLabel("Amount", { exact: true }).fill("125000");
    await ledgerCreate.getByLabel("Currency", { exact: true }).fill("INR");
    await ledgerCreate.getByLabel("Due date").fill(overdueDate);
    await ledgerCreate
      .getByLabel("Related trip")
      .selectOption(operationalTripId);
    await ledgerCreate
      .locator('select[name="supplierId"]')
      .selectOption({ label: supplierName });
    await ledgerCreate.getByLabel("Invoice number").fill(invoiceNumber);
    await ledgerCreate
      .getByRole("button", { name: "Create obligation" })
      .click();
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
    const { data: catalogProduct, error: catalogProductError } = await admin!
      .from("quote_catalog_products")
      .select("id, supplier_id, category, currency, status")
      .eq("organization_id", organizationIds[0])
      .eq("name", catalogProductName)
      .single();
    expect(catalogProductError).toBeNull();
    expect(catalogProduct).toMatchObject({
      supplier_id: supplier!.id,
      category: "transport",
      currency: "INR",
      status: "active",
    });
    const { data: catalogRates, error: catalogRatesError } = await admin!
      .from("quote_catalog_rates")
      .select("version, unit_sell_amount, unit_cost_amount, tax_percent")
      .eq("product_id", catalogProduct!.id)
      .order("version");
    expect(catalogRatesError).toBeNull();
    expect(catalogRates).toMatchObject([
      {
        version: 1,
        unit_sell_amount: 12000,
        unit_cost_amount: 8000,
        tax_percent: 5,
      },
      {
        version: 2,
        unit_sell_amount: 13000,
        unit_cost_amount: 8500,
        tax_percent: 5,
      },
    ]);
    const { data: catalogAudits, error: catalogAuditError } = await admin!
      .from("audit_events")
      .select("metadata")
      .eq("organization_id", organizationIds[0])
      .eq("entity_type", "quote_catalog_product")
      .eq("entity_id", catalogProduct!.id);
    expect(catalogAuditError).toBeNull();
    expect(catalogAudits).toHaveLength(4);
    expect(
      catalogAudits?.every(
        (entry) => {
          const metadata = JSON.stringify(entry.metadata);
          return (
            metadata.includes('"external_action_performed":false') &&
            !metadata.includes("13000") &&
            !metadata.includes("8500")
          );
        },
      ),
    ).toBe(true);
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

    const accountingDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download accounting CSV" })
      .click();
    const downloadedAccountingLedger = await accountingDownload;
    expect(downloadedAccountingLedger.suggestedFilename()).toMatch(
      /^aios-accounting-ledger-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const accountingStream = await downloadedAccountingLedger.createReadStream();
    expect(accountingStream).not.toBeNull();
    const accountingChunks: Buffer[] = [];
    for await (const chunk of accountingStream!) {
      accountingChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const accountingCsv = Buffer.concat(accountingChunks).toString("utf8");
    expect(accountingCsv).toContain(
      '"export_metadata","authority_boundary"',
    );
    expect(accountingCsv).toContain(`"payment_obligation","${payment!.id}"`);
    expect(accountingCsv).toContain(paymentTitle);
    expect(accountingCsv).toContain(settlementReference);
    expect(accountingCsv).toContain("INV/2027-00043");
    await expect(page.getByRole("status")).toContainText(
      "No upload, payment, message, or provider action occurred",
    );

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
    const ledgerCreate = page.locator(".ledger-create");
    await ledgerCreate
      .getByLabel("Payment direction")
      .selectOption("receivable");
    await ledgerCreate.getByLabel("Obligation title").fill(receivableTitle);
    await ledgerCreate.getByLabel("Amount", { exact: true }).fill("480000");
    await ledgerCreate.getByLabel("Currency", { exact: true }).fill("INR");
    await ledgerCreate.getByLabel("Due date").fill("2026-09-15");
    await ledgerCreate
      .getByLabel("Related trip")
      .selectOption(operationalTripId);
    await ledgerCreate
      .getByRole("button", { name: "Create obligation" })
      .click();
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
    const competingSourceTitle = `Kyoto supplier bulletin ${Date.now()}`;
    const importedSourceTitle = `Airport playbook ${Date.now()}`;
    await signIn(page);
    await page.goto("/knowledge");
    await expect(
      page.getByRole("heading", {
        name: "Give AIOS trusted material, with a source for every answer.",
      }),
    ).toBeVisible();
    const manualSourceForm = page.locator(".knowledge-create > form");

    await manualSourceForm.getByLabel("Source title").fill(sourceTitle);
    await manualSourceForm
      .getByLabel("Source type")
      .selectOption("destination_guide");
    await manualSourceForm
      .getByLabel("Authority")
      .selectOption("official");
    await manualSourceForm
      .getByLabel("Sensitivity")
      .selectOption("normal");
    await manualSourceForm.getByLabel("Version").fill("2026.1");
    await manualSourceForm
      .getByLabel("HTTPS source link")
      .fill("https://example.com/kyoto-rail-policy");
    await manualSourceForm
      .getByLabel("Curator summary")
      .fill("Human-reviewed rail guidance for itinerary planning.");
    await manualSourceForm
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
      .getByRole("button", { name: "Preview evidence" })
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
        "The Kyoto rail policy requires operator confirmation 48 hours before any traveller-facing commitment.",
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
      .getByRole("button", { name: "Preview evidence" })
      .click();
    await expect(page.getByText("Kyoto rail policy §5")).toBeVisible();
    await expect(
      page.getByText(`${sourceTitle} · v2026.2 · official`),
    ).toBeVisible();

    await manualSourceForm
      .getByLabel("Source title")
      .fill(competingSourceTitle);
    await manualSourceForm
      .getByLabel("Source type")
      .selectOption("destination_guide");
    await manualSourceForm
      .getByLabel("Authority")
      .selectOption("supplier");
    await manualSourceForm
      .getByLabel("Sensitivity")
      .selectOption("normal");
    await manualSourceForm.getByLabel("Version").fill("2026.1");
    await manualSourceForm
      .getByLabel("HTTPS source link")
      .fill("https://example.com/kyoto-supplier-bulletin");
    await manualSourceForm
      .getByLabel("Curator summary")
      .fill("Competing supplier timing for human review.");
    await manualSourceForm
      .getByRole("button", { name: "Create governed draft" })
      .click();
    await page
      .getByLabel("Section heading")
      .fill("Revised cancellation windows");
    await page
      .getByLabel("Evidence content")
      .fill(
        "The supplier bulletin requires operator confirmation 72 hours before any traveller-facing commitment.",
      );
    await page
      .getByLabel("Citation label")
      .fill("Kyoto supplier bulletin §2");
    await page.getByRole("button", { name: "Add cited passage" }).click();
    await page
      .getByRole("button", { name: "Send to human review" })
      .click();
    await page
      .getByRole("button", { name: "Approve for AIOS retrieval" })
      .click();
    await page
      .getByRole("button", { name: "Scan current evidence" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "1 item need human attention",
    );
    const conflictQueue = page.locator(".knowledge-conflict-queue");
    await expect(
      conflictQueue.getByText("Review required", { exact: true }),
    ).toBeVisible();
    await expect(conflictQueue.getByText("48", { exact: true })).toBeVisible();
    await expect(conflictQueue.getByText("72", { exact: true })).toBeVisible();
    await conflictQueue
      .getByLabel("Evidence note")
      .fill(
        "Official policy says 48 hours while the supplier bulletin says 72 hours.",
      );
    await conflictQueue
      .getByRole("button", { name: "Record human review" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Conflict review recorded",
    );
    await expect(
      conflictQueue.getByText("Human confirmed", { exact: true }),
    ).toBeVisible();

    await page.getByLabel("Text or Markdown file").setInputFiles({
      name: "airport-ops.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        [
          "# Arrival support",
          "Meet the traveller at the signed airport desk.",
          "",
          "## Escalation",
          "Call the duty operator when a confirmed service is missing.",
        ].join("\n"),
      ),
    });
    await page
      .getByLabel("Imported source title")
      .fill(importedSourceTitle);
    await page
      .getByLabel("Import review note")
      .fill("Private operating procedure requiring human review.");
    await page
      .getByRole("button", { name: "Import as governed Draft" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Imported 2 reviewable passages into a Draft",
    );
    await expect(page.getByText("PRIVATE FILE PROVENANCE")).toBeVisible();
    await expect(page.getByText("airport-ops.md", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Server-chunked into a Draft. The file itself was not sent to a model or exposed to approved retrieval.",
      ),
    ).toBeVisible();

    await page
      .getByLabel("Question or evidence needed")
      .fill("quantum submarine reimbursement protocol");
    await page
      .getByRole("button", { name: "Ask AIOS with citations" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Unsupported · AIOS refused to guess",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("No approved evidence supports an answer."),
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
    const { data: conflict, error: conflictError } = await admin!
      .from("knowledge_conflicts")
      .select("status, reviewed_by, resolution_note, signal")
      .eq("organization_id", organizationIds[0])
      .eq("status", "confirmed")
      .single();
    expect(conflictError).toBeNull();
    expect(conflict).toMatchObject({
      status: "confirmed",
      reviewed_by: userId,
      resolution_note:
        "Official policy says 48 hours while the supplier bulletin says 72 hours.",
    });
    expect(conflict?.signal).toMatchObject({
      reason: "factual_token_mismatch",
    });
    const { data: importedSource, error: importedSourceError } = await admin!
      .from("knowledge_sources")
      .select(
        "id, status, ingestion_method, ingested_file_name, ingested_file_sha256, ingested_byte_size",
      )
      .eq("organization_id", organizationIds[0])
      .eq("title", importedSourceTitle)
      .single();
    expect(importedSourceError).toBeNull();
    expect(importedSource).toMatchObject({
      status: "draft",
      ingestion_method: "text_file",
      ingested_file_name: "airport-ops.md",
    });
    expect(importedSource?.ingested_file_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(importedSource?.ingested_byte_size).toBeGreaterThan(0);
    const { data: importedSections, error: importedSectionsError } =
      await admin!
        .from("knowledge_sections")
        .select("heading, citation_label, position")
        .eq("source_id", importedSource!.id)
        .order("position");
    expect(importedSectionsError).toBeNull();
    expect(importedSections).toEqual([
      {
        heading: "Arrival support",
        citation_label: `${importedSourceTitle} · airport-ops.md · passage 1`,
        position: 0,
      },
      {
        heading: "Escalation",
        citation_label: `${importedSourceTitle} · airport-ops.md · passage 2`,
        position: 1,
      },
    ]);

    const { data: answerRun, error: answerRunError } = await admin!
      .from("ai_runs")
      .select("id, status, result, input_tokens, output_tokens")
      .eq("organization_id", organizationIds[0])
      .eq("agent_type", "knowledge_answer")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(answerRunError).toBeNull();
    expect(answerRun?.status).toBe("succeeded");
    expect(answerRun?.result).toMatchObject({
      answer_state: "unsupported",
    });
    expect(answerRun?.input_tokens).toBeNull();
    expect(answerRun?.output_tokens).toBeNull();
    const { count: answerJobCount, error: answerJobError } = await admin!
      .from("ai_jobs")
      .select("id", { count: "exact", head: true })
      .eq("ai_run_id", answerRun!.id);
    expect(answerJobError).toBeNull();
    expect(answerJobCount).toBe(0);
  });

  test("explains live management intelligence and links every metric to its source workspace", async ({
    page,
  }) => {
    const forecastSuffix = Date.now();
    const { error: growthFixtureError } = await admin!.from("deals").insert([
      {
        organization_id: organizationIds[0],
        contact_id: contactId,
        owner_id: userId,
        title: `E2E forecast opportunity ${forecastSuffix}`,
        destination: "Kashmir, India",
        stage: "proposal",
        value_amount: 250000,
        currency: "INR",
        probability: 40,
        next_step: "Review the commercial proposal",
        expected_close_at: "2026-09-15",
      },
      {
        organization_id: organizationIds[0],
        contact_id: contactId,
        owner_id: userId,
        title: `E2E returning customer win ${forecastSuffix}`,
        destination: "Goa, India",
        stage: "won",
        value_amount: 180000,
        currency: "INR",
        probability: 100,
        won_at: "2026-07-28T12:00:00.000Z",
      },
    ]);
    expect(growthFixtureError).toBeNull();

    const { data: cohortContacts, error: cohortContactsError } = await admin!
      .from("contacts")
      .insert([
        {
          organization_id: organizationIds[0],
          owner_id: userId,
          first_name: `E2E Return ${forecastSuffix}`,
        },
        {
          organization_id: organizationIds[0],
          owner_id: userId,
          first_name: `E2E One-time ${forecastSuffix}`,
        },
      ])
      .select("id, first_name");
    expect(cohortContactsError).toBeNull();
    const returningCohortContact = cohortContacts?.find((contact) =>
      contact.first_name.startsWith("E2E Return"),
    );
    const oneTimeCohortContact = cohortContacts?.find((contact) =>
      contact.first_name.startsWith("E2E One-time"),
    );
    expect(returningCohortContact).toBeTruthy();
    expect(oneTimeCohortContact).toBeTruthy();
    const { error: cohortDealsError } = await admin!.from("deals").insert([
      {
        organization_id: organizationIds[0],
        contact_id: returningCohortContact!.id,
        owner_id: userId,
        title: `E2E cohort first win ${forecastSuffix}`,
        destination: "Rajasthan, India",
        stage: "won",
        value_amount: 100000,
        currency: "INR",
        probability: 100,
        won_at: "2025-01-01T12:00:00.000Z",
      },
      {
        organization_id: organizationIds[0],
        contact_id: returningCohortContact!.id,
        owner_id: userId,
        title: `E2E cohort return ${forecastSuffix}`,
        destination: "Kerala, India",
        stage: "won",
        value_amount: 120000,
        currency: "INR",
        probability: 100,
        won_at: "2025-03-01T12:00:00.000Z",
      },
      {
        organization_id: organizationIds[0],
        contact_id: oneTimeCohortContact!.id,
        owner_id: userId,
        title: `E2E cohort one-time win ${forecastSuffix}`,
        destination: "Sikkim, India",
        stage: "won",
        value_amount: 90000,
        currency: "INR",
        probability: 100,
        won_at: "2025-01-15T12:00:00.000Z",
      },
    ]);
    expect(cohortDealsError).toBeNull();

    const { data: economicsDeal, error: economicsDealError } = await admin!
      .from("deals")
      .insert({
        organization_id: organizationIds[0],
        contact_id: contactId,
        owner_id: userId,
        title: `E2E completed economics ${forecastSuffix}`,
        destination: "Ladakh, India",
        stage: "won",
        value_amount: 760000,
        currency: "INR",
        probability: 100,
        won_at: "2026-07-20T12:00:00.000Z",
      })
      .select("id")
      .single();
    expect(economicsDealError).toBeNull();
    const { data: economicsQuote, error: economicsQuoteError } = await admin!
      .from("quotes")
      .insert({
        organization_id: organizationIds[0],
        deal_id: economicsDeal!.id,
        owner_id: userId,
        title: `E2E accepted trip quote ${forecastSuffix}`,
        status: "accepted",
        current_version: 1,
        currency: "INR",
        accepted_at: "2026-07-20T13:00:00.000Z",
      })
      .select("id")
      .single();
    expect(economicsQuoteError).toBeNull();
    const { error: economicsVersionError } = await admin!
      .from("quote_versions")
      .insert({
        organization_id: organizationIds[0],
        quote_id: economicsQuote!.id,
        version: 1,
        total_amount: 760000,
        net_amount: 760000,
        tax_amount: 0,
        created_by: userId,
      });
    expect(economicsVersionError).toBeNull();
    const { data: economicsTrip, error: economicsTripError } = await admin!
      .from("trips")
      .insert({
        organization_id: organizationIds[0],
        deal_id: economicsDeal!.id,
        quote_id: economicsQuote!.id,
        owner_id: userId,
        name: `E2E completed Ladakh journey ${forecastSuffix}`,
        status: "completed",
        start_date: "2026-07-10",
        end_date: "2026-07-18",
        currency: "INR",
      })
      .select("id")
      .single();
    expect(economicsTripError).toBeNull();
    const { error: economicsTripHistoryError } = await admin!
      .from("trip_status_history")
      .insert({
        organization_id: organizationIds[0],
        trip_id: economicsTrip!.id,
        from_status: "confirmed",
        to_status: "completed",
        changed_by: userId,
        change_source: "human",
        note: "E2E completed-trip economics fixture",
        changed_at: "2026-07-18T12:00:00.000Z",
      });
    expect(economicsTripHistoryError).toBeNull();
    const { error: economicsBookingError } = await admin!
      .from("bookings")
      .insert({
        organization_id: organizationIds[0],
        trip_id: economicsTrip!.id,
        booking_type: "hotel",
        title: `E2E completed stay ${forecastSuffix}`,
        status: "confirmed",
        confirmation_reference: `ECON-${forecastSuffix}`,
        cost_amount: 520000,
        currency: "INR",
        confirmed_at: "2026-07-09T12:00:00.000Z",
      });
    expect(economicsBookingError).toBeNull();
    const { error: economicsPaymentError } = await admin!
      .from("payments")
      .insert([
        {
          organization_id: organizationIds[0],
          trip_id: economicsTrip!.id,
          deal_id: economicsDeal!.id,
          direction: "receivable",
          status: "partially_paid",
          title: `E2E completed customer balance ${forecastSuffix}`,
          amount: 760000,
          paid_amount: 400000,
          currency: "INR",
          created_by: userId,
        },
        {
          organization_id: organizationIds[0],
          trip_id: economicsTrip!.id,
          deal_id: economicsDeal!.id,
          direction: "payable",
          status: "paid",
          title: `E2E completed supplier balance ${forecastSuffix}`,
          amount: 520000,
          paid_amount: 520000,
          currency: "INR",
          created_by: userId,
        },
      ]);
    expect(economicsPaymentError).toBeNull();

    await signIn(page);
    await page.goto("/analytics");

    await expect(
      page.getByRole("heading", {
        name: "What needs leadership attention now",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Trip readiness" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Service confirmation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Open financial exposure" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AIOS evidence health" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Current quote portfolio" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Data quality watch" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Probability-weighted forecast" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Repeat-customer evidence" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Reconcile margin only when the evidence closes",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "First-win retention cohorts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Compare management activity on equal ground",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Tenant-authorized records · Current workspace · No currencies combined",
      ),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Open Trip Operations →" }),
    ).toHaveAttribute("href", "/trips");
    await expect(
      page.getByRole("link", { name: "Open Suppliers & Finance →" }),
    ).toHaveAttribute("href", "/finance");
    await expect(
      page.getByRole("link", { name: "Review AIOS knowledge →" }),
    ).toHaveAttribute("href", "/knowledge");

    await page
      .getByText("How these management metrics are calculated")
      .click();
    await expect(
      page.getByText(/Financial exposure is obligation amount less recorded/i),
    ).toBeVisible();
    await expect(
      page.getByText(/controls below apply only to sales metrics/i),
    ).toBeVisible();

    const profitabilityTable = page.getByRole("table", {
      name: "Estimated quote profitability separated by currency",
    });
    const inrProfitability = profitabilityTable.getByRole("row", {
      name: /INR/,
    });
    await expect(inrProfitability).toContainText("₹4,80,000");
    await expect(inrProfitability).toContainText("₹3,70,000");
    await expect(inrProfitability).toContainText("₹1,10,000");
    await expect(inrProfitability).toContainText("22.9%");
    await expect(
      page.getByRole("link", { name: "Open quote evidence →" }),
    ).toHaveAttribute("href", "/quotes");
    await expect(
      page.getByRole("link", { name: "Review Inbox →" }),
    ).toHaveAttribute("href", "/inbox");

    await page.getByLabel("Management period").selectOption("custom");
    await page
      .getByLabel("Management period start")
      .fill("2026-07-01");
    await page.getByLabel("Management period end").fill("2026-07-31");
    const periodTable = page.getByRole("table", {
      name: /2026-07-01.*2026-07-31.*2026-05-31.*2026-06-30/,
    });
    const wonPeriodRow = periodTable.getByRole("row", {
      name: /Won opportunities/,
    });
    await expect(wonPeriodRow).toContainText("3");
    await expect(wonPeriodRow).toContainText("New activity");
    const completedPeriodRow = periodTable.getByRole("row", {
      name: /Completed trips/,
    });
    await expect(completedPeriodRow).toContainText("1");
    await expect(
      completedPeriodRow.getByRole("link", {
        name: "Trip lifecycle · Completed transition →",
      }),
    ).toHaveAttribute("href", "/trips");

    await expect(
      page.getByRole("heading", {
        name: "AIOS explains only what the evidence can prove",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/AIOS deterministic evidence rules/),
    ).toBeVisible();
    const anomalyCards = page.getByTestId("aios-anomaly");
    expect(await anomalyCards.count()).toBeGreaterThan(0);
    const firstAnomaly = anomalyCards.first();
    await expect(firstAnomaly.getByRole("link").first()).toHaveAttribute(
      "href",
      /^\//,
    );
    await expect(firstAnomaly.locator("footer")).toContainText(
      /do not|does not|not its cause|does not prove|not bank reconciliation/i,
    );

    const reportSchedule = page.locator(".report-schedule");
    await expect(
      reportSchedule.getByRole("heading", {
        name: "Deliver an immutable management brief on schedule",
      }),
    ).toBeVisible();
    await expect(reportSchedule).toContainText("SCHEDULE PAUSED");
    await reportSchedule
      .getByLabel("Enable scheduled in-app delivery")
      .check();
    await reportSchedule.getByLabel("Cadence").selectOption("monthly");
    await reportSchedule
      .getByLabel("Comparison period")
      .selectOption("90");
    await reportSchedule
      .getByLabel("Forecast horizon")
      .selectOption("30");
    const nextReportAt = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 16);
    await reportSchedule.getByLabel("Next delivery").fill(nextReportAt);
    await reportSchedule
      .getByRole("button", { name: "Save delivery schedule" })
      .click();
    await expect(reportSchedule.getByRole("status")).toContainText(
      "Schedule saved",
    );
    const { data: savedReportSchedule, error: savedReportScheduleError } =
      await admin!
        .from("analytics_report_schedules")
        .select(
          "is_enabled, cadence, period_days, forecast_horizon_days, updated_by",
        )
        .eq("organization_id", organizationIds[0])
        .single();
    expect(savedReportScheduleError).toBeNull();
    expect(savedReportSchedule).toMatchObject({
      is_enabled: true,
      cadence: "monthly",
      period_days: 90,
      forecast_horizon_days: 30,
      updated_by: userId,
    });

    await reportSchedule
      .getByRole("button", { name: "Generate now" })
      .click();
    await expect(reportSchedule.getByRole("status")).toContainText(
      "Aggregate delivery complete: 1 ready, 0 failed",
    );
    const { data: reportDelivery, error: reportDeliveryError } = await admin!
      .from("analytics_report_deliveries")
      .select(
        "id, trigger_type, status, report_filename, report_csv, report_row_count, report_sha256",
      )
      .eq("organization_id", organizationIds[0])
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    expect(reportDeliveryError).toBeNull();
    expect(reportDelivery).toMatchObject({
      trigger_type: "operator",
      status: "ready",
    });
    expect(reportDelivery?.report_row_count).toBeGreaterThan(0);
    expect(reportDelivery?.report_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reportDelivery?.report_csv).toContain(
      '"AIOS anomaly desk","Explanation engine"',
    );
    const scheduledDownload = page.waitForEvent("download");
    await reportSchedule
      .getByRole("button", { name: "Download snapshot" })
      .first()
      .click();
    const scheduledReport = await scheduledDownload;
    expect(scheduledReport.suggestedFilename()).toBe(
      reportDelivery?.report_filename,
    );

    const periodViewName = `E2E July management ${forecastSuffix}`;
    await page.getByLabel("Name this Analytics view").fill(periodViewName);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.locator(".analytics-notice")).toContainText(
      "private Analytics view",
    );
    const { data: periodSavedView, error: periodSavedViewError } = await admin!
      .from("saved_views")
      .select("filters")
      .eq("organization_id", organizationIds[0])
      .eq("name", periodViewName)
      .single();
    expect(periodSavedViewError).toBeNull();
    expect(periodSavedView?.filters).toMatchObject({
      managementPeriod: "custom",
      customPeriodStart: "2026-07-01",
      customPeriodEnd: "2026-07-31",
    });
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.locator(".analytics-notice")).toContainText(
      "Private Analytics view removed",
    );

    const completedEconomicsTable = page.getByRole("table", {
      name: "Completed-trip margin and obligation reconciliation by currency",
    });
    const completedInrEconomics = completedEconomicsTable.getByRole("row", {
      name: /INR/,
    });
    await expect(completedInrEconomics).toContainText("₹7,60,000");
    await expect(completedInrEconomics).toContainText("₹5,20,000");
    await expect(completedInrEconomics).toContainText("₹2,40,000");
    await expect(completedInrEconomics).toContainText("31.6%");
    await expect(completedInrEconomics).toContainText("₹4,00,000");
    await expect(
      page.getByRole("link", {
        name: "Correct trip and booking evidence →",
      }),
    ).toHaveAttribute("href", "/trips");
    await expect(
      page.getByRole("link", {
        name: "Reconcile obligation evidence →",
      }),
    ).toHaveAttribute("href", "/finance");

    const forecastTable = page.getByRole("table", {
      name: "Open pipeline and weighted forecast by currency",
    });
    const inrForecast = forecastTable.getByRole("row", { name: /INR/ });
    await expect(inrForecast).toContainText("₹5,75,000");
    await expect(inrForecast).toContainText("₹1,81,250");
    await expect(page.locator(".retention-panel")).toContainText("67%");
    const cohortTable = page.getByRole("table", {
      name: "Customers returning after their first Won opportunity",
    });
    const matureCohort = cohortTable.getByRole("row", { name: /2025 Q1/ });
    await expect(matureCohort).toContainText("2");
    await expect(matureCohort).toContainText("1 / 2 · 50.0%");
    const collectingCohort = cohortTable.getByRole("row", {
      name: /2026 Q3/,
    });
    await expect(collectingCohort).toContainText("Collecting");
    await expect(page.getByText("Target not configured")).toBeVisible();

    await page.locator(".forecast-horizon select").selectOption("30");
    await expect(inrForecast).toContainText("₹3,25,000");
    await expect(inrForecast).toContainText("₹81,250");
    await page.locator(".forecast-horizon select").selectOption("90");
    await expect(inrForecast).toContainText("₹5,75,000");

    const targetName = `E2E Q3 INR target ${forecastSuffix}`;
    await page.getByLabel("Target name").fill(targetName);
    await page.getByLabel("Currency", { exact: true }).fill("INR");
    await page.getByLabel("Period start", { exact: true }).fill("2026-07-01");
    await page.getByLabel("Period end", { exact: true }).fill("2026-09-30");
    await page.getByLabel("Approved target").fill("1000000");
    await page
      .getByRole("button", { name: "Add approved target" })
      .click();
    await expect(page.locator(".analytics-notice")).toContainText(
      `Approved ${targetName} target added`,
    );

    const targetTable = page.getByRole("table", {
      name: "Active sales targets and matching open pipeline",
    });
    const targetRow = targetTable.getByRole("row", { name: new RegExp(targetName) });
    await expect(targetRow).toContainText("₹10,00,000");
    await expect(targetRow).toContainText("₹5,75,000");
    await expect(targetRow).toContainText("57.5%");
    await expect(targetRow).toContainText("18.1%");

    const { data: analyticsTarget, error: analyticsTargetError } = await admin!
      .from("analytics_targets")
      .select("id, is_active")
      .eq("organization_id", organizationIds[0])
      .eq("label", targetName)
      .single();
    expect(analyticsTargetError).toBeNull();
    expect(analyticsTarget?.is_active).toBe(true);

    const exportDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download aggregate CSV" })
      .click();
    const downloadedReport = await exportDownload;
    expect(downloadedReport.suggestedFilename()).toMatch(
      /^aios-management-report-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const reportStream = await downloadedReport.createReadStream();
    expect(reportStream).not.toBeNull();
    const reportChunks: Buffer[] = [];
    for await (const chunk of reportStream!) {
      reportChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const reportCsv = Buffer.concat(reportChunks).toString("utf8");
    expect(reportCsv).toContain('"Report boundary","Personal data"');
    expect(reportCsv).toContain(
      '"Forecast","Open pipeline within 90 days","INR","575000"',
    );
    expect(reportCsv).toContain(
      '"Forecast","Probability-weighted forecast within 90 days","INR","181250"',
    );
    expect(reportCsv).toContain(
      '"Pipeline coverage","Approved target 1 (2026-07-01 to 2026-09-30): pipeline coverage","INR","57.5"',
    );
    expect(reportCsv).toContain(
      '"Completed-trip economics","Operating margin evidence","INR","240000"',
    );
    expect(reportCsv).toContain(
      '"Retention cohorts","2025 Q1: returned within 90 days","","50"',
    );
    expect(reportCsv).toContain(
      '"Management period","Won opportunities: current","","3"',
    );
    expect(reportCsv).toContain(
      '"AIOS anomaly desk","Explanation engine","","AIOS deterministic evidence rules"',
    );
    expect(reportCsv).toContain('"AIOS anomaly citation"');
    expect(reportCsv).not.toContain(targetName);
    expect(reportCsv).not.toContain(contactId!);
    expect(reportCsv).not.toContain(email);
    await expect(page.locator(".analytics-notice")).toContainText(
      "Raw records, personal data, free-text labels, and cross-currency totals were excluded",
    );

    await targetRow.getByRole("button", { name: "Retire" }).click();
    await expect(page.locator(".analytics-notice")).toContainText(
      `${targetName} was retired`,
    );
    await expect(targetRow).toHaveCount(0);
    const { data: retiredTarget, error: retiredTargetError } = await admin!
      .from("analytics_targets")
      .select("is_active")
      .eq("id", analyticsTarget!.id)
      .single();
    expect(retiredTargetError).toBeNull();
    expect(retiredTarget?.is_active).toBe(false);
    const { count: targetAuditCount, error: targetAuditError } = await admin!
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "analytics_target")
      .eq("entity_id", analyticsTarget!.id);
    expect(targetAuditError).toBeNull();
    expect(targetAuditCount).toBe(2);
  });

  test("wires AIOS budgets, provider pricing, autonomy controls, and deterministic triage", async ({
    page,
  }) => {
    const modelName = `e2e-glm-${Date.now()}`;
    await signIn(page);
    await page.goto("/aios");

    const qualityPanel = page.getByRole("region", {
      name: "Sales Copilot review calibration",
    });
    await expect(
      qualityPanel.getByRole("heading", {
        name: "Review feedback, not guesswork",
      }),
    ).toBeVisible();
    await expect(qualityPanel.getByLabel("Reviewed AI drafts")).toContainText(
      "1",
    );
    await expect(
      qualityPanel.getByLabel("First-pass approval rate"),
    ).toContainText("0%");
    await expect(qualityPanel.getByLabel("Feedback recovery")).toContainText(
      "1 / 1",
    );
    await expect(
      qualityPanel.getByLabel("Current revision approval"),
    ).toContainText("1 / 1");
    await expect(qualityPanel).toContainText(
      "No conversion claim · no draft or feedback content",
    );

    await page.getByLabel("Daily run ceiling").fill("7");
    await page.getByLabel("Selected provider").selectOption("glm");
    await page.getByLabel("Transient fallback").selectOption("qwen");
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
        "daily_model_run_limit, model_execution_enabled, selected_model_provider, fallback_model_provider, allowed_model_providers, updated_by",
      )
      .eq("organization_id", organizationIds[0])
      .single();
    expect(budgetError).toBeNull();
    expect(budget).toMatchObject({
      daily_model_run_limit: 7,
      model_execution_enabled: false,
      selected_model_provider: "glm",
      fallback_model_provider: "qwen",
      updated_by: userId,
    });
    expect(budget?.allowed_model_providers).toContain("glm");
    expect(budget?.allowed_model_providers).toContain("qwen");
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
    await page.waitForLoadState("networkidle");
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
      await page.goto(route, { waitUntil: "networkidle" });
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
