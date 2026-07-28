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
let dealId = "";
let leadCaptureFormToken = "";
let approvalId = "";

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
});
