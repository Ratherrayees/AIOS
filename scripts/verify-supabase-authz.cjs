/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { createClient } = require("@supabase/supabase-js");

let activeVerificationPhase = "startup";

function loadLocalEnv() {
  const localEnv = {};
  if (fs.existsSync(".env.local")) {
    for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      localEnv[line.slice(0, separator)] = line
        .slice(separator + 1)
        .replace(/^"|"$/g, "");
    }
  }
  return { ...localEnv, ...process.env };
}

function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verifyAuthorization() {
  const env = loadLocalEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error("Supabase verification credentials are incomplete.");
  }

  const admin = client(url, secretKey);
  const suffix = randomBytes(8).toString("hex");
  const password = `Authz!${randomBytes(24).toString("base64url")}`;
  const userIds = [];
  const organizationIds = [];
  const storageObjectPaths = [];
  const checks = [];
  let cleanupSucceeded = true;

  function record(name, passed, diagnostic = null) {
    checks.push({
      name,
      passed: Boolean(passed),
      ...(!passed && diagnostic ? { diagnostic } : {}),
    });
  }

  try {
    activeVerificationPhase = "creating temporary identities";
    const createdUsers = [];
    for (const label of ["owner", "viewer"]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `aios-authz-${label}-${suffix}@stateai.invalid`,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Authorization ${label}` },
      });
      if (error || !data.user)
        throw new Error(
          `Temporary authorization user was not created: ${JSON.stringify({
            status: error?.status ?? null,
            code: error?.code ?? null,
            message: error?.message ?? null,
          })}`,
        );
      createdUsers.push(data.user);
      userIds.push(data.user.id);
    }

    activeVerificationPhase = "creating temporary organizations";
    const { data: organizations, error: organizationError } = await admin
      .from("organizations")
      .insert([
        { name: `Authz Alpha ${suffix}`, slug: `authz-alpha-${suffix}` },
        { name: `Authz Beta ${suffix}`, slug: `authz-beta-${suffix}` },
      ])
      .select("id, slug");
    if (organizationError || organizations?.length !== 2)
      throw organizationError ?? new Error("Temporary organizations were not created.");
    organizationIds.push(...organizations.map((organization) => organization.id));

    const organizationA = organizations.find(
      (organization) => organization.slug === `authz-alpha-${suffix}`,
    );
    const organizationB = organizations.find(
      (organization) => organization.slug === `authz-beta-${suffix}`,
    );
    if (!organizationA || !organizationB)
      throw new Error("Temporary organizations could not be identified.");
    const [ownerUser, viewerUser] = createdUsers;
    activeVerificationPhase = "creating temporary memberships";
    const { data: memberships, error: membershipError } = await admin
      .from("memberships")
      .insert([
        {
          organization_id: organizationA.id,
          user_id: ownerUser.id,
          role: "owner",
          status: "active",
        },
        {
          organization_id: organizationB.id,
          user_id: viewerUser.id,
          role: "viewer",
          status: "active",
        },
      ])
      .select("id, organization_id, user_id");
    if (membershipError || memberships?.length !== 2)
      throw membershipError ?? new Error("Temporary memberships were not created.");

    activeVerificationPhase = "creating temporary contacts";
    const { data: contacts, error: contactError } = await admin
      .from("contacts")
      .insert([
        {
          organization_id: organizationA.id,
          first_name: "Alpha traveller",
        },
        {
          organization_id: organizationB.id,
          first_name: "Beta traveller",
        },
      ])
      .select("id, organization_id");
    if (contactError || contacts?.length !== 2)
      throw contactError ?? new Error("Temporary contacts were not created.");
    const alphaContact = contacts.find(
      (contact) => contact.organization_id === organizationA.id,
    );
    const betaContact = contacts.find(
      (contact) => contact.organization_id === organizationB.id,
    );
    if (!alphaContact || !betaContact)
      throw new Error("Temporary contacts could not be identified.");

    activeVerificationPhase = "creating temporary conversations";
    const { data: conversations, error: conversationError } = await admin
      .from("conversations")
      .insert([
        {
          organization_id: organizationA.id,
          contact_id: alphaContact.id,
          channel: "manual",
          subject: "Alpha SLA fixture",
        },
        {
          organization_id: organizationB.id,
          contact_id: betaContact.id,
          channel: "manual",
          subject: "Beta SLA fixture",
        },
      ])
      .select("id, organization_id");
    if (conversationError || conversations?.length !== 2)
      throw conversationError ??
        new Error("Temporary conversations were not created.");
    const alphaConversation = conversations.find(
      (conversation) => conversation.organization_id === organizationA.id,
    );
    const betaConversation = conversations.find(
      (conversation) => conversation.organization_id === organizationB.id,
    );
    if (!alphaConversation || !betaConversation)
      throw new Error("Temporary conversations could not be identified.");

    activeVerificationPhase = "signing in temporary users";
    const owner = client(url, publishableKey);
    const viewer = client(url, publishableKey);
    const [{ error: ownerSignInError }, { error: viewerSignInError }] =
      await Promise.all([
        owner.auth.signInWithPassword({
          email: `aios-authz-owner-${suffix}@stateai.invalid`,
          password,
        }),
        viewer.auth.signInWithPassword({
          email: `aios-authz-viewer-${suffix}@stateai.invalid`,
          password,
        }),
      ]);
    if (ownerSignInError || viewerSignInError)
      throw ownerSignInError ?? viewerSignInError;
    activeVerificationPhase = "core tenant authorization";

    const [
      ownerOrganizations,
      viewerOrganizations,
      ownerOwnContact,
      ownerForeignContact,
    ] = await Promise.all([
      owner.from("organizations").select("id"),
      viewer.from("organizations").select("id"),
      owner
        .from("contacts")
        .select("id")
        .eq("organization_id", organizationA.id),
      owner
        .from("contacts")
        .select("id")
        .eq("organization_id", organizationB.id),
    ]);

    record(
      "owner reads only the assigned tenant",
      !ownerOrganizations.error &&
        ownerOrganizations.data?.length === 1 &&
        ownerOrganizations.data[0].id === organizationA.id,
    );
    record(
      "viewer reads only the assigned tenant",
      !viewerOrganizations.error &&
        viewerOrganizations.data?.length === 1 &&
        viewerOrganizations.data[0].id === organizationB.id,
    );
    record(
      "owner reads an in-tenant contact",
      !ownerOwnContact.error && ownerOwnContact.data?.length === 1,
    );
    record(
      "owner cannot read a foreign-tenant contact",
      !ownerForeignContact.error && ownerForeignContact.data?.length === 0,
    );

    const [ownerQuotePolicy, viewerForeignQuotePolicy] = await Promise.all([
      owner
        .from("quote_approval_policies")
        .select(
          "minimum_margin_percent, minimum_markup_percent, maximum_validity_days, commission_basis, commission_percent, minimum_post_commission_margin_percent",
        )
        .eq("organization_id", organizationA.id)
        .single(),
      viewer
        .from("quote_approval_policies")
        .select("organization_id")
        .eq("organization_id", organizationA.id),
    ]);
    record(
      "new workspaces receive bounded default quote guardrails",
      !ownerQuotePolicy.error &&
        Number(ownerQuotePolicy.data?.minimum_margin_percent) === 15 &&
        Number(ownerQuotePolicy.data?.minimum_markup_percent) === 0 &&
        ownerQuotePolicy.data?.maximum_validity_days === 45 &&
        ownerQuotePolicy.data?.commission_basis === "gross_margin" &&
        Number(ownerQuotePolicy.data?.commission_percent) === 0 &&
        Number(
          ownerQuotePolicy.data?.minimum_post_commission_margin_percent,
        ) === 0,
    );
    record(
      "quote guardrail policies remain tenant isolated",
      !viewerForeignQuotePolicy.error &&
        viewerForeignQuotePolicy.data?.length === 0,
    );

    const directQuotePolicyUpdate = await owner
      .from("quote_approval_policies")
      .update({ minimum_margin_percent: 0 })
      .eq("organization_id", organizationA.id)
      .select("organization_id");
    record(
      "browser writes cannot bypass the quote policy RPC",
      Boolean(directQuotePolicyUpdate.error) ||
        directQuotePolicyUpdate.data?.length === 0,
    );

    const viewerQuotePolicyUpdate = await viewer.rpc(
      "upsert_quote_approval_policy",
      {
        target_organization_id: organizationB.id,
        target_minimum_margin_percent: 0,
        target_require_cost_estimate: false,
        target_require_valid_until: false,
        target_maximum_validity_days: 365,
        target_maximum_discount_percent: 100,
        target_enforce_standard_terms: false,
        target_standard_terms: [],
        target_minimum_markup_percent: 0,
        target_commission_basis: "gross_margin",
        target_commission_percent: 0,
        target_minimum_post_commission_margin_percent: 0,
      },
    );
    record(
      "viewers cannot weaken quote approval policy",
      Boolean(viewerQuotePolicyUpdate.error),
    );

    const foreignQuotePolicyUpdate = await owner.rpc(
      "upsert_quote_approval_policy",
      {
        target_organization_id: organizationB.id,
        target_minimum_margin_percent: 0,
        target_require_cost_estimate: false,
        target_require_valid_until: false,
        target_maximum_validity_days: 365,
        target_maximum_discount_percent: 100,
        target_enforce_standard_terms: false,
        target_standard_terms: [],
        target_minimum_markup_percent: 0,
        target_commission_basis: "gross_margin",
        target_commission_percent: 0,
        target_minimum_post_commission_margin_percent: 0,
      },
    );
    record(
      "owners cannot configure another tenant's quote policy",
      Boolean(foreignQuotePolicyUpdate.error),
    );

    const emptyStandardTermsPolicy = await owner.rpc(
      "upsert_quote_approval_policy",
      {
        target_organization_id: organizationA.id,
        target_minimum_margin_percent: 20,
        target_require_cost_estimate: true,
        target_require_valid_until: true,
        target_maximum_validity_days: 60,
        target_maximum_discount_percent: 3,
        target_enforce_standard_terms: true,
        target_standard_terms: [],
        target_minimum_markup_percent: 25,
        target_commission_basis: "gross_margin",
        target_commission_percent: 5,
        target_minimum_post_commission_margin_percent: 15,
      },
    );
    record(
      "database requires a standard-term set before enforcing it",
      Boolean(emptyStandardTermsPolicy.error),
    );

    const duplicateStandardTermsPolicy = await owner.rpc(
      "upsert_quote_approval_policy",
      {
        target_organization_id: organizationA.id,
        target_minimum_margin_percent: 20,
        target_require_cost_estimate: true,
        target_require_valid_until: true,
        target_maximum_validity_days: 60,
        target_maximum_discount_percent: 3,
        target_enforce_standard_terms: true,
        target_standard_terms: [
          "Subject to availability",
          "subject to availability",
        ],
        target_minimum_markup_percent: 25,
        target_commission_basis: "gross_margin",
        target_commission_percent: 5,
        target_minimum_post_commission_margin_percent: 15,
      },
    );
    record(
      "database rejects duplicate standard terms case-insensitively",
      Boolean(duplicateStandardTermsPolicy.error),
    );

    const updatedQuotePolicy = await owner.rpc(
      "upsert_quote_approval_policy",
      {
        target_organization_id: organizationA.id,
        target_minimum_margin_percent: 20,
        target_require_cost_estimate: true,
        target_require_valid_until: true,
        target_maximum_validity_days: 60,
        target_maximum_discount_percent: 100,
        target_enforce_standard_terms: false,
        target_standard_terms: [],
        target_minimum_markup_percent: 25,
        target_commission_basis: "gross_margin",
        target_commission_percent: 5,
        target_minimum_post_commission_margin_percent: 15,
      },
    );
    record(
      "authorized owners can configure bounded quote guardrails",
      !updatedQuotePolicy.error &&
        updatedQuotePolicy.data?.length === 1 &&
        Number(updatedQuotePolicy.data[0].minimum_margin_percent) === 20 &&
        updatedQuotePolicy.data[0].maximum_validity_days === 60 &&
        Number(updatedQuotePolicy.data[0].maximum_discount_percent) === 100 &&
        Number(updatedQuotePolicy.data[0].minimum_markup_percent) === 25 &&
        updatedQuotePolicy.data[0].commission_basis === "gross_margin" &&
        Number(updatedQuotePolicy.data[0].commission_percent) === 5 &&
        Number(
          updatedQuotePolicy.data[0].minimum_post_commission_margin_percent,
        ) === 15 &&
        updatedQuotePolicy.data[0].enforce_standard_terms === false,
    );
    const { data: quotePolicyAudit } = await owner
      .from("audit_events")
      .select("metadata")
      .eq("organization_id", organizationA.id)
      .eq("event_type", "quote.guardrail_policy_updated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    record(
      "quote policy changes preserve content-free audit evidence",
      quotePolicyAudit?.metadata?.minimum_margin_percent === 20 &&
        quotePolicyAudit.metadata.minimum_markup_percent === 25 &&
        quotePolicyAudit.metadata.maximum_validity_days === 60 &&
        quotePolicyAudit.metadata.commission_basis === "gross_margin" &&
        quotePolicyAudit.metadata.commission_percent === 5 &&
        quotePolicyAudit.metadata.minimum_post_commission_margin_percent ===
          15 &&
        quotePolicyAudit.metadata.standard_term_count === 0 &&
        quotePolicyAudit.metadata.standard_terms_sha256?.length === 64,
    );

    const ownerCrossTenantInsert = await owner.from("contacts").insert({
      organization_id: organizationB.id,
      first_name: "Blocked cross-tenant write",
    });
    record(
      "owner cannot write into a foreign tenant",
      Boolean(ownerCrossTenantInsert.error),
    );

    const ownerSameTenantTask = await owner
      .from("tasks")
      .insert({
        organization_id: organizationA.id,
        contact_id: alphaContact.id,
        title: "Allowed same-tenant relationship",
      })
      .select("id")
      .single();
    record(
      "owner can create a same-tenant relationship",
      !ownerSameTenantTask.error,
    );

    const ownerForeignRelationship = await owner.from("tasks").insert({
      organization_id: organizationA.id,
      contact_id: betaContact.id,
      title: "Blocked foreign-tenant relationship",
    });
    record(
      "database rejects a foreign-tenant relationship",
      Boolean(ownerForeignRelationship.error),
    );

    const ownerSameTenantContactAssignment = await owner
      .from("contacts")
      .update({ owner_id: ownerUser.id })
      .eq("id", alphaContact.id)
      .select("id, owner_id");
    record(
      "owner can assign a contact within the same tenant",
      !ownerSameTenantContactAssignment.error &&
        ownerSameTenantContactAssignment.data?.length === 1 &&
        ownerSameTenantContactAssignment.data[0].owner_id === ownerUser.id,
    );

    const ownerForeignContactAssignment = await owner
      .from("contacts")
      .update({ owner_id: viewerUser.id })
      .eq("id", alphaContact.id)
      .select("id");
    record(
      "database rejects a foreign-tenant contact owner",
      Boolean(ownerForeignContactAssignment.error),
    );

    const ownerForeignTaskAssignee = await owner
      .from("tasks")
      .update({ assignee_id: viewerUser.id })
      .eq("id", ownerSameTenantTask.data.id)
      .select("id");
    record(
      "database rejects a foreign-tenant task assignee",
      Boolean(ownerForeignTaskAssignee.error),
    );

    const ownerForeignDealOwner = await owner.from("deals").insert({
      organization_id: organizationA.id,
      contact_id: alphaContact.id,
      owner_id: viewerUser.id,
      title: "Blocked foreign owner fixture",
    });
    record(
      "database rejects a foreign-tenant deal owner",
      Boolean(ownerForeignDealOwner.error),
    );

    activeVerificationPhase = "governed CRM authorization";
    const { data: governedDeal, error: governedDealError } = await owner
      .from("deals")
      .insert({
        organization_id: organizationA.id,
        contact_id: alphaContact.id,
        owner_id: ownerUser.id,
        title: "Governed pipeline fixture",
        destination: "Kyoto",
        probability: 30,
        value_amount: 450000,
        currency: "INR",
        next_step: "Present a qualified itinerary",
        expected_close_at: "2026-08-31",
      })
      .select("id")
      .single();
    if (governedDealError || !governedDeal)
      throw governedDealError ??
        new Error("Governed opportunity fixture was not created.");

    activeVerificationPhase = "quote commercial guardrail authorization";
    const quoteValidUntil = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const quoteDraft = await owner.rpc("create_quote_draft", {
      target_organization_id: organizationA.id,
      target_deal_id: governedDeal.id,
      quote_title: "Guardrail authorization fixture",
      quote_currency: "INR",
      quote_valid_until: quoteValidUntil,
      quote_total_amount: 545000,
    });
    const guardedQuoteId = quoteDraft.data?.[0]?.quote_id;
    if (quoteDraft.error || !guardedQuoteId)
      throw quoteDraft.error ??
        new Error("Guardrail quote fixture was not created.");
    const readyProposalContent = {
      schema_version: 1,
      inclusions: ["Private airport transfers", "Daily breakfast"],
      exclusions: ["International flights"],
      terms: ["Subject to availability"],
    };

    const missingProposalApproval = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        approver_id: ownerUser.id,
        action: "quote.share",
        entity_type: "quote",
        entity_id: guardedQuoteId,
        payload: { quote_version: 1, guardrail_status: "ready" },
      });
    record(
      "database blocks quote review without current proposal content",
      Boolean(missingProposalApproval.error),
    );
    const { error: proposalFixtureError } = await admin
      .from("quote_versions")
      .update({ terms_snapshot: readyProposalContent })
      .eq("organization_id", organizationA.id)
      .eq("quote_id", guardedQuoteId)
      .eq("version", 1);
    if (proposalFixtureError) throw proposalFixtureError;
    const incompleteQuoteApproval = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        approver_id: ownerUser.id,
        action: "quote.share",
        entity_type: "quote",
        entity_id: guardedQuoteId,
      });
    record(
      "database blocks quote review without required current cost evidence",
      Boolean(incompleteQuoteApproval.error),
    );

    const costedQuoteRevision = await owner.rpc(
      "append_quote_version_with_cost",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        quote_total_amount: 545000,
        quote_estimated_cost_amount: 410000,
      },
    );
    if (
      costedQuoteRevision.error ||
      costedQuoteRevision.data?.[0]?.quote_version !== 2
    )
      throw costedQuoteRevision.error ??
        new Error("Costed quote revision fixture was not created.");

    const guardedQuoteApproval = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        approver_id: ownerUser.id,
        action: "quote.share",
        entity_type: "quote",
        entity_id: guardedQuoteId,
        payload: {
          quote_version: 999,
          guardrail_status: "forged",
          total_amount: 545000,
          estimated_cost_amount: 410000,
        },
      })
      .select("id, status, payload")
      .single();
    if (guardedQuoteApproval.error || !guardedQuoteApproval.data)
      throw guardedQuoteApproval.error ??
        new Error("Guarded quote approval fixture was not created.");
    const canonicalQuotePayload = guardedQuoteApproval.data.payload;
    record(
      "database canonicalizes approval evidence to the exact quote revision",
      canonicalQuotePayload?.quote_version === 2 &&
      canonicalQuotePayload?.guardrail_status === "ready" &&
        canonicalQuotePayload?.external_share_performed === false &&
        canonicalQuotePayload?.proposal_content?.inclusion_count === 2 &&
        canonicalQuotePayload?.proposal_content?.exclusion_count === 1 &&
        canonicalQuotePayload?.proposal_content?.term_count === 1 &&
        typeof canonicalQuotePayload?.proposal_content?.sha256 === "string" &&
        canonicalQuotePayload.proposal_content.sha256.length === 64 &&
        Array.isArray(canonicalQuotePayload?.risk_codes) &&
        canonicalQuotePayload.risk_codes.length === 0,
    );
    record(
      "quote approval evidence never exposes cost, total, or margin amounts",
      !Object.keys(canonicalQuotePayload ?? {}).some((key) =>
        [
          "total_amount",
          "estimated_cost_amount",
          "cost_amount",
          "margin_amount",
          "margin_percent",
        ].includes(key),
      ),
    );
    record(
      "quote approval evidence hashes proposal content instead of copying it",
      !JSON.stringify(canonicalQuotePayload).includes("Private airport") &&
        !JSON.stringify(canonicalQuotePayload).includes("availability"),
    );

    const tightenedQuotePolicy = await owner.rpc(
      "upsert_quote_approval_policy",
      {
        target_organization_id: organizationA.id,
        target_minimum_margin_percent: 21,
        target_require_cost_estimate: true,
        target_require_valid_until: true,
        target_maximum_validity_days: 60,
        target_maximum_discount_percent: 3,
        target_enforce_standard_terms: true,
        target_standard_terms: ["Subject to availability"],
        target_minimum_markup_percent: 25,
        target_commission_basis: "net_sell",
        target_commission_percent: 5,
        target_minimum_post_commission_margin_percent: 15,
      },
    );
    if (tightenedQuotePolicy.error)
      throw tightenedQuotePolicy.error;
    const [policyCancelledApproval, policyCancellationAudit] =
      await Promise.all([
        owner
          .from("approval_requests")
          .select("status, resolved_at")
          .eq("id", guardedQuoteApproval.data.id)
          .single(),
        owner
          .from("audit_events")
          .select("metadata")
          .eq("organization_id", organizationA.id)
          .eq("event_type", "approval.cancelled")
          .eq("entity_id", guardedQuoteApproval.data.id)
          .maybeSingle(),
      ]);
    record(
      "a quote policy change atomically cancels stale pending review",
      !policyCancelledApproval.error &&
        policyCancelledApproval.data?.status === "cancelled" &&
        Boolean(policyCancelledApproval.data?.resolved_at),
    );
    record(
      "quote policy cancellation preserves the authority-change reason",
      !policyCancellationAudit.error &&
        policyCancellationAudit.data?.metadata?.reason ===
          "quote_policy_changed",
    );

    const revisionBoundApproval = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        approver_id: ownerUser.id,
        action: "quote.share",
        entity_type: "quote",
        entity_id: guardedQuoteId,
      })
      .select("id, payload")
      .single();
    if (revisionBoundApproval.error || !revisionBoundApproval.data)
      throw revisionBoundApproval.error ??
        new Error("Revision-bound approval fixture was not created.");
    record(
      "a fresh quote review uses the tightened policy snapshot",
      revisionBoundApproval.data.payload?.quote_version === 2 &&
        Number(
          revisionBoundApproval.data.payload?.guardrail_policy
            ?.minimum_margin_percent,
        ) === 21,
    );
    record(
      "an older quote commission snapshot becomes an explicit exception",
      revisionBoundApproval.data.payload?.guardrail_status ===
        "exception_review" &&
        revisionBoundApproval.data.payload?.risk_codes?.includes(
          "commission_policy_stale",
        ) &&
        revisionBoundApproval.data.payload?.commercial_exceptions
          ?.commission_policy_current === false,
    );

    const supersedingQuoteRevision = await owner.rpc(
      "append_quote_version_with_cost",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        quote_total_amount: 550000,
        quote_estimated_cost_amount: 412000,
      },
    );
    if (
      supersedingQuoteRevision.error ||
      supersedingQuoteRevision.data?.[0]?.quote_version !== 3
    )
      throw supersedingQuoteRevision.error ??
        new Error("Superseding quote revision fixture was not created.");
    const [cancelledQuoteApproval, cancellationAudit] = await Promise.all([
      owner
        .from("approval_requests")
        .select("status, resolved_at")
        .eq("id", revisionBoundApproval.data.id)
        .single(),
      owner
        .from("audit_events")
        .select("metadata")
        .eq("organization_id", organizationA.id)
        .eq("event_type", "approval.cancelled")
        .eq("entity_id", revisionBoundApproval.data.id)
        .maybeSingle(),
    ]);
    record(
      "a new quote revision atomically cancels stale pending review",
      !cancelledQuoteApproval.error &&
        cancelledQuoteApproval.data?.status === "cancelled" &&
        Boolean(cancelledQuoteApproval.data?.resolved_at),
    );
    record(
      "stale quote review cancellation preserves version-change evidence",
      !cancellationAudit.error &&
        cancellationAudit.data?.metadata?.reason ===
          "quote_version_changed" &&
        cancellationAudit.data.metadata.current_quote_version === 3,
    );

    const { data: temporaryViewerMembership, error: temporaryMembershipError } =
      await admin
        .from("memberships")
        .insert({
          organization_id: organizationA.id,
          user_id: viewerUser.id,
          role: "viewer",
          status: "active",
        })
        .select("id")
        .single();
    if (temporaryMembershipError || !temporaryViewerMembership)
      throw temporaryMembershipError ??
        new Error("Temporary same-tenant viewer membership was not created.");
    const viewerCatalogCreate = await viewer.rpc(
      "create_quote_catalog_product",
      {
        target_organization_id: organizationA.id,
        target_supplier_id: null,
        target_category: "accommodation",
        target_name: "Blocked shared rate",
        target_description: "Viewer should not create this rate",
        target_unit_label: "room night",
        target_currency: "INR",
        target_unit_sell_amount: 190000,
        target_unit_cost_amount: 140000,
        target_tax_percent: 5,
        target_valid_from: "2026-08-01",
        target_valid_until: null,
      },
    );
    record(
      "same-tenant viewers cannot create shared quote catalog pricing",
      Boolean(viewerCatalogCreate.error),
    );
    const createdCatalogProduct = await owner.rpc(
      "create_quote_catalog_product",
      {
        target_organization_id: organizationA.id,
        target_supplier_id: null,
        target_category: "accommodation",
        target_name: "Authorization room rate",
        target_description: "Two rooms",
        target_unit_label: "room night",
        target_currency: "INR",
        target_unit_sell_amount: 190000,
        target_unit_cost_amount: 140000,
        target_tax_percent: 5,
        target_valid_from: "2026-08-01",
        target_valid_until: null,
      },
    );
    const catalogProduct = createdCatalogProduct.data?.[0];
    if (createdCatalogProduct.error || !catalogProduct)
      throw createdCatalogProduct.error ??
        new Error("Quote catalog authorization fixture was not created.");
    record(
      "authorized catalog creation publishes immutable rate version one",
      catalogProduct.rate_version === 1 &&
        Boolean(catalogProduct.product_id) &&
        Boolean(catalogProduct.rate_id),
    );
    const publishedCatalogRate = await owner.rpc(
      "publish_quote_catalog_rate",
      {
        target_organization_id: organizationA.id,
        target_product_id: catalogProduct.product_id,
        target_unit_sell_amount: 200000,
        target_unit_cost_amount: 150000,
        target_tax_percent: 5,
        target_valid_from: "2026-08-01",
        target_valid_until: null,
      },
    );
    const catalogRate = publishedCatalogRate.data?.[0];
    if (publishedCatalogRate.error || !catalogRate)
      throw publishedCatalogRate.error ??
        new Error("Quote catalog rate version was not published.");
    record(
      "catalog rate changes append history instead of rewriting version one",
      catalogRate.rate_version === 2 &&
        catalogRate.rate_id !== catalogProduct.rate_id,
    );
    const [ownerCatalogRates, viewerCatalogProducts, viewerCatalogRates] =
      await Promise.all([
        owner
          .from("quote_catalog_rates")
          .select("id, version, unit_sell_amount, unit_cost_amount")
          .eq("product_id", catalogProduct.product_id)
          .order("version"),
        viewer
          .from("quote_catalog_products")
          .select("id")
          .eq("id", catalogProduct.product_id),
        viewer
          .from("quote_catalog_rates")
          .select("id")
          .eq("product_id", catalogProduct.product_id),
      ]);
    record(
      "catalog rate history preserves every published sell and cost version",
      !ownerCatalogRates.error &&
        ownerCatalogRates.data?.length === 2 &&
        Number(ownerCatalogRates.data[0]?.unit_sell_amount) === 190000 &&
        Number(ownerCatalogRates.data[1]?.unit_sell_amount) === 200000,
    );
    record(
      "same-tenant viewers see reusable products but never protected rates",
      !viewerCatalogProducts.error &&
        viewerCatalogProducts.data?.length === 1 &&
        !viewerCatalogRates.error &&
        viewerCatalogRates.data?.length === 0,
    );
    const directCatalogRewrite = await owner
      .from("quote_catalog_rates")
      .update({ unit_cost_amount: 1 })
      .eq("id", catalogRate.rate_id)
      .select("id");
    record(
      "browser sessions cannot rewrite immutable catalog rates",
      Boolean(directCatalogRewrite.error),
    );
    const archivedCatalogProduct = await owner.rpc(
      "set_quote_catalog_product_status",
      {
        target_organization_id: organizationA.id,
        target_product_id: catalogProduct.product_id,
        target_status: "archived",
        target_reason: "Authorization lifecycle archive evidence",
      },
    );
    const archivedRateUse = await owner.rpc(
      "append_structured_quote_version",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_items: [
          {
            category: "accommodation",
            description: "Archived rate attempt",
            quantity: 1,
            unit_price_amount: 200000,
            unit_cost_amount: 150000,
            discount_amount: 0,
            tax_percent: 5,
            catalog_rate_id: catalogRate.rate_id,
          },
        ],
      },
    );
    record(
      "archived catalog products cannot seed new quote versions",
      !archivedCatalogProduct.error && Boolean(archivedRateUse.error),
    );
    const restoredCatalogProduct = await owner.rpc(
      "set_quote_catalog_product_status",
      {
        target_organization_id: organizationA.id,
        target_product_id: catalogProduct.product_id,
        target_status: "active",
        target_reason: "Authorization lifecycle restore evidence",
      },
    );
    if (restoredCatalogProduct.error) throw restoredCatalogProduct.error;
    const [staleCatalogRateUse, forgedCatalogRateUse] = await Promise.all([
      owner.rpc("append_structured_quote_version", {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_items: [
          {
            category: "accommodation",
            description: "Stale rate attempt",
            quantity: 1,
            unit_price_amount: 190000,
            unit_cost_amount: 140000,
            discount_amount: 0,
            tax_percent: 5,
            catalog_rate_id: catalogProduct.rate_id,
          },
        ],
      }),
      owner.rpc("append_structured_quote_version", {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_items: [
          {
            category: "accommodation",
            description: "Forged rate attempt",
            quantity: 1,
            unit_price_amount: 1,
            unit_cost_amount: 1,
            discount_amount: 0,
            tax_percent: 5,
            catalog_rate_id: catalogRate.rate_id,
          },
        ],
      }),
    ]);
    record(
      "quote composition rejects stale and forged catalog rate values",
      Boolean(staleCatalogRateUse.error) && Boolean(forgedCatalogRateUse.error),
    );
    const structuredItems = [
      {
        category: "accommodation",
        description: "Two rooms",
        quantity: 2,
        unit_price_amount: 200000,
        unit_cost_amount: 150000,
        discount_amount: 20000,
        tax_percent: 5,
        catalog_rate_id: catalogRate.rate_id,
      },
      {
        category: "activity",
        description: "Private experiences",
        quantity: 1,
        unit_price_amount: 100000,
        unit_cost_amount: 70000,
        discount_amount: 0,
        tax_percent: 5,
      },
    ];
    const viewerStructuredRevision = await viewer.rpc(
      "append_structured_quote_version",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_items: structuredItems,
      },
    );
    record(
      "same-tenant viewers cannot compose protected quote pricing",
      Boolean(viewerStructuredRevision.error),
    );
    const viewerProposalRevision = await viewer.rpc(
      "append_quote_proposal_content_version",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_content: readyProposalContent,
      },
    );
    record(
      "same-tenant viewers cannot revise customer proposal content",
      Boolean(viewerProposalRevision.error),
    );
    const malformedProposalRevision = await owner.rpc(
      "append_quote_proposal_content_version",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_content: {
          ...readyProposalContent,
          inclusions: ["Daily breakfast", "daily breakfast"],
        },
      },
    );
    record(
      "proposal revisions reject noncanonical duplicate customer content",
      Boolean(malformedProposalRevision.error),
    );
    const [coercedStructuredRevision, oversizedStructuredRevision] =
      await Promise.all([
        owner.rpc("append_structured_quote_version", {
          target_organization_id: organizationA.id,
          target_quote_id: guardedQuoteId,
          target_items: [{ ...structuredItems[0], quantity: "2" }],
        }),
        owner.rpc("append_structured_quote_version", {
          target_organization_id: organizationA.id,
          target_quote_id: guardedQuoteId,
          target_items: [
            {
              ...structuredItems[0],
              quantity: 100000,
              unit_price_amount: 999999999999.99,
            },
          ],
        }),
      ]);
    record(
      "database rejects type-coerced and overflowing structured quote lines",
      Boolean(coercedStructuredRevision.error) &&
        Boolean(oversizedStructuredRevision.error),
    );
    const structuredRevision = await owner.rpc(
      "append_structured_quote_version",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_items: structuredItems,
      },
    );
    const structuredSummary = structuredRevision.data?.[0];
    if (structuredRevision.error || !structuredSummary)
      throw structuredRevision.error ??
        new Error("Structured quote authorization fixture was not created.");
    record(
      "authorized composition reconciles net sell tax cost and margin",
      structuredSummary.quote_version === 4 &&
        Number(structuredSummary.customer_total_amount) === 504000 &&
        Number(structuredSummary.net_sell_amount) === 480000 &&
        Number(structuredSummary.tax_total_amount) === 24000 &&
        Number(structuredSummary.estimated_cost_amount) === 370000 &&
        Number(structuredSummary.gross_margin_amount) === 110000,
    );
    const [
      ownerLines,
      ownerCosts,
      ownerCommercialTerms,
      viewerLines,
      viewerCosts,
      viewerCommercialTerms,
    ] = await Promise.all([
      owner
        .from("quote_line_items")
        .select(
          "id, description, total_amount, catalog_product_id, catalog_rate_id, supplier_id",
        )
        .eq("quote_version_id", structuredSummary.quote_version_id)
        .order("position"),
      owner
        .from("quote_line_costs")
        .select("quote_line_item_id, unit_cost_amount, cost_amount")
        .eq("organization_id", organizationA.id),
      owner
        .from("quote_version_commercial_terms")
        .select(
          "gross_markup_amount, gross_markup_percent, commission_basis, commission_percent, commission_base_amount, estimated_commission_amount, post_commission_margin_amount, post_commission_margin_percent",
        )
        .eq("organization_id", organizationA.id)
        .eq("quote_version_id", structuredSummary.quote_version_id)
        .single(),
      viewer
        .from("quote_line_items")
        .select("id")
        .eq("organization_id", organizationA.id),
      viewer
        .from("quote_line_costs")
        .select("quote_line_item_id")
        .eq("organization_id", organizationA.id),
      viewer
        .from("quote_version_commercial_terms")
        .select("quote_version_id")
        .eq("organization_id", organizationA.id),
    ]);
    record(
      "customer quote lines omit protected unit costs by construction",
      !ownerLines.error &&
        ownerLines.data?.length === 2 &&
        ownerLines.data.every((line) => !("unit_cost_amount" in line)),
    );
    record(
      "catalog-backed quote lines preserve exact product and rate provenance",
      ownerLines.data?.[0]?.catalog_product_id === catalogProduct.product_id &&
        ownerLines.data?.[0]?.catalog_rate_id === catalogRate.rate_id &&
        ownerLines.data?.[0]?.supplier_id === null &&
        ownerLines.data?.[1]?.catalog_rate_id === null,
    );
    record(
      "commercial roles can read separately protected line costs",
      !ownerCosts.error &&
        ownerCosts.data?.length === 2 &&
        ownerCosts.data.reduce(
          (sum, cost) => sum + Number(cost.cost_amount),
          0,
        ) === 370000,
    );
    record(
      "same-tenant viewers read sell lines but never protected costs",
      !viewerLines.error &&
        viewerLines.data?.length === 2 &&
        !viewerCosts.error &&
        viewerCosts.data?.length === 0 &&
        !viewerCommercialTerms.error &&
        viewerCommercialTerms.data?.length === 0,
    );
    record(
      "costed quote versions freeze exact markup and commission evidence",
      !ownerCommercialTerms.error &&
        Number(ownerCommercialTerms.data?.gross_markup_amount) === 110000 &&
        Number(ownerCommercialTerms.data?.gross_markup_percent) === 29.7297 &&
        ownerCommercialTerms.data?.commission_basis === "net_sell" &&
        Number(ownerCommercialTerms.data?.commission_percent) === 5 &&
        Number(ownerCommercialTerms.data?.commission_base_amount) === 480000 &&
        Number(ownerCommercialTerms.data?.estimated_commission_amount) ===
          24000 &&
        Number(ownerCommercialTerms.data?.post_commission_margin_amount) ===
          86000 &&
        Number(ownerCommercialTerms.data?.post_commission_margin_percent) ===
          17.9167,
    );
    const directCommercialTermsRewrite = await owner
      .from("quote_version_commercial_terms")
      .update({ commission_percent: 0 })
      .eq("quote_version_id", structuredSummary.quote_version_id)
      .select("quote_version_id");
    record(
      "browser sessions cannot rewrite immutable quote economics",
      Boolean(directCommercialTermsRewrite.error) ||
        directCommercialTermsRewrite.data?.length === 0,
    );
    const { error: temporaryMembershipDeleteError } = await admin
      .from("memberships")
      .delete()
      .eq("id", temporaryViewerMembership.id);
    if (temporaryMembershipDeleteError) throw temporaryMembershipDeleteError;
    const [
      foreignLines,
      foreignCosts,
      foreignCommercialTerms,
      foreignProducts,
      foreignRates,
    ] =
      await Promise.all([
      viewer
        .from("quote_line_items")
        .select("id")
        .eq("organization_id", organizationA.id),
      viewer
        .from("quote_line_costs")
        .select("quote_line_item_id")
        .eq("organization_id", organizationA.id),
      viewer
        .from("quote_version_commercial_terms")
        .select("quote_version_id")
        .eq("organization_id", organizationA.id),
      viewer
        .from("quote_catalog_products")
        .select("id")
        .eq("organization_id", organizationA.id),
      viewer
        .from("quote_catalog_rates")
        .select("id")
        .eq("organization_id", organizationA.id),
    ]);
    record(
      "foreign tenants cannot read structured quote sell or cost lines",
      !foreignLines.error &&
        foreignLines.data?.length === 0 &&
        !foreignCosts.error &&
        foreignCosts.data?.length === 0 &&
        !foreignCommercialTerms.error &&
        foreignCommercialTerms.data?.length === 0 &&
        !foreignProducts.error &&
        foreignProducts.data?.length === 0 &&
        !foreignRates.error &&
        foreignRates.data?.length === 0,
    );
    const directLineWrite = await owner.from("quote_line_items").insert({
      organization_id: organizationA.id,
      quote_version_id: structuredSummary.quote_version_id,
      position: 2,
      category: "fee",
      description: "Forged browser line",
      quantity: 1,
      unit_price_amount: 1,
      net_amount: 1,
      tax_amount: 0,
      total_amount: 1,
    });
    record(
      "browser sessions cannot forge immutable structured quote lines",
      Boolean(directLineWrite.error),
    );
    const structuredApproval = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        approver_id: ownerUser.id,
        action: "quote.share",
        entity_type: "quote",
        entity_id: guardedQuoteId,
      })
      .select("id, payload")
      .single();
    record(
      "sharing guardrails expose the exact itemized discount exception",
      !structuredApproval.error &&
        structuredApproval.data?.payload?.quote_version === 4 &&
        structuredApproval.data.payload.guardrail_status ===
          "exception_review" &&
        structuredApproval.data.payload.risk_codes?.length === 1 &&
        structuredApproval.data.payload.risk_codes[0] ===
          "discount_above_policy" &&
        Number(
          structuredApproval.data.payload.commercial_exceptions
            ?.discount_percent,
        ) === 4 &&
        structuredApproval.data.payload.commercial_exceptions
          ?.standard_terms_match === true &&
        Number(
          structuredApproval.data.payload.commercial_exceptions
            ?.gross_markup_percent,
        ) === 29.7297 &&
        structuredApproval.data.payload.commercial_exceptions
          ?.commission_basis === "net_sell" &&
        Number(
          structuredApproval.data.payload.commercial_exceptions
            ?.commission_percent,
        ) === 5 &&
        Number(
          structuredApproval.data.payload.commercial_exceptions
            ?.post_commission_margin_percent,
        ) === 17.9167 &&
        structuredApproval.data.payload.commercial_exceptions
          ?.commission_policy_current === true &&
        Number(
          structuredApproval.data.payload.guardrail_policy
            ?.maximum_discount_percent,
        ) === 3 &&
        structuredApproval.data.payload.guardrail_policy
          ?.standard_term_count === 1 &&
        structuredApproval.data.payload.guardrail_policy
          ?.standard_terms_sha256?.length === 64,
    );
    record(
      "approval evidence exposes commercial rates but no protected amounts",
      !JSON.stringify(structuredApproval.data?.payload).includes("110000") &&
        !JSON.stringify(structuredApproval.data?.payload).includes("24000") &&
        !JSON.stringify(structuredApproval.data?.payload).includes("86000"),
    );
    const revisedProposalContent = {
      schema_version: 1,
      inclusions: [
        "Private airport transfers",
        "Daily breakfast",
        "Reviewed local experiences",
      ],
      exclusions: ["International flights"],
      terms: ["Subject to availability", "Valid only until quote expiry"],
    };
    const proposalRevision = await owner.rpc(
      "append_quote_proposal_content_version",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_content: revisedProposalContent,
      },
    );
    const proposalSummary = proposalRevision.data?.[0];
    if (proposalRevision.error || !proposalSummary)
      throw proposalRevision.error ??
        new Error("Proposal-content authorization fixture was not created.");
    const [
      proposalVersion,
      copiedProposalLines,
      copiedProposalCosts,
      cancelledStructuredApproval,
      proposalAudit,
    ] = await Promise.all([
      owner
        .from("quote_versions")
        .select(
          "terms_snapshot, total_amount, net_amount, tax_amount, margin_amount",
        )
        .eq("id", proposalSummary.quote_version_id)
        .single(),
      owner
        .from("quote_line_items")
        .select("catalog_rate_id, total_amount")
        .eq("quote_version_id", proposalSummary.quote_version_id)
        .order("position"),
      owner
        .from("quote_line_costs")
        .select("cost_amount, quote_line_items!inner(quote_version_id)")
        .eq("quote_line_items.quote_version_id", proposalSummary.quote_version_id),
      owner
        .from("approval_requests")
        .select("status")
        .eq("id", structuredApproval.data.id)
        .single(),
      owner
        .from("audit_events")
        .select("metadata")
        .eq("organization_id", organizationA.id)
        .eq("event_type", "record.updated")
        .eq("entity_id", guardedQuoteId)
        .eq("metadata->>event", "quote.proposal_content_version_created")
        .single(),
    ]);
    record(
      "proposal edits append an exact immutable commercial revision",
      proposalSummary.quote_version === 5 &&
        !proposalVersion.error &&
        Number(proposalVersion.data?.total_amount) === 504000 &&
        Number(proposalVersion.data?.net_amount) === 480000 &&
        Number(proposalVersion.data?.tax_amount) === 24000 &&
        Number(proposalVersion.data?.margin_amount) === 110000 &&
        proposalVersion.data?.terms_snapshot?.inclusions?.length === 3,
    );
    record(
      "proposal revisions copy sell, protected cost, and catalog provenance",
      !copiedProposalLines.error &&
        copiedProposalLines.data?.length === 2 &&
        copiedProposalLines.data[0]?.catalog_rate_id === catalogRate.rate_id &&
        !copiedProposalCosts.error &&
        copiedProposalCosts.data?.length === 2 &&
        copiedProposalCosts.data.reduce(
          (sum, cost) => sum + Number(cost.cost_amount),
          0,
        ) === 370000,
    );
    record(
      "proposal edits cancel review of the superseded content revision",
      !cancelledStructuredApproval.error &&
        cancelledStructuredApproval.data?.status === "cancelled",
    );
    record(
      "proposal audit stores counts and a hash instead of customer content",
      !proposalAudit.error &&
        proposalAudit.data?.metadata?.inclusion_count === 3 &&
        proposalAudit.data.metadata.term_count === 2 &&
        proposalAudit.data.metadata.content_sha256?.length === 64 &&
        proposalAudit.data.metadata.external_share_performed === false &&
        !JSON.stringify(proposalAudit.data.metadata).includes("breakfast"),
    );

    activeVerificationPhase = "quote payment schedule authorization";
    const firstPaymentSchedule = [
      {
        kind: "deposit",
        label: "Booking deposit",
        amount: 151200,
        due_date: new Date().toISOString().slice(0, 10),
      },
      {
        kind: "balance",
        label: "Final balance",
        amount: 352800,
        due_date: quoteValidUntil,
      },
    ];
    const [foreignScheduleWrite, forgedScheduleWrite, duplicateSchedule, unreconciledSchedule] =
      await Promise.all([
        viewer.rpc("append_quote_payment_schedule", {
          target_organization_id: organizationA.id,
          target_quote_id: guardedQuoteId,
          target_items: firstPaymentSchedule,
        }),
        owner.from("quote_payment_schedules").insert({
          organization_id: organizationA.id,
          quote_id: guardedQuoteId,
          quote_version_id: proposalSummary.quote_version_id,
          revision: 99,
          currency: "INR",
          total_amount: 504000,
          items: firstPaymentSchedule,
          content_sha256: "0".repeat(64),
        }),
        owner.rpc("append_quote_payment_schedule", {
          target_organization_id: organizationA.id,
          target_quote_id: guardedQuoteId,
          target_items: [
            firstPaymentSchedule[0],
            {
              ...firstPaymentSchedule[1],
              label: " booking deposit ",
            },
          ],
        }),
        owner.rpc("append_quote_payment_schedule", {
          target_organization_id: organizationA.id,
          target_quote_id: guardedQuoteId,
          target_items: [
            firstPaymentSchedule[0],
            { ...firstPaymentSchedule[1], amount: 352799 },
          ],
        }),
      ]);
    record(
      "foreign tenants cannot configure another workspace payment schedule",
      Boolean(foreignScheduleWrite.error),
    );
    record(
      "browser sessions cannot forge immutable payment schedule rows",
      Boolean(forgedScheduleWrite.error),
    );
    record(
      "database rejects duplicate customer payment milestone labels",
      Boolean(duplicateSchedule.error),
    );
    record(
      "database rejects payment milestones that do not reconcile exactly",
      Boolean(unreconciledSchedule.error),
    );

    const createdPaymentSchedule = await owner.rpc(
      "append_quote_payment_schedule",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_items: firstPaymentSchedule,
      },
    );
    const firstScheduleRow = createdPaymentSchedule.data?.[0];
    if (createdPaymentSchedule.error || !firstScheduleRow)
      throw createdPaymentSchedule.error ??
        new Error("Payment schedule authorization fixture was not created.");
    const [storedPaymentSchedule, paymentScheduleAudit] = await Promise.all([
      owner
        .from("quote_payment_schedules")
        .select(
          "quote_version_id, revision, status, total_amount, items, item_count, content_sha256",
        )
        .eq("id", firstScheduleRow.id)
        .single(),
      owner
        .from("audit_events")
        .select("metadata")
        .eq("organization_id", organizationA.id)
        .eq("entity_id", guardedQuoteId)
        .eq("metadata->>event", "quote.payment_schedule_created")
        .single(),
    ]);
    record(
      "authorized payment terms bind to the exact current commercial version",
      !storedPaymentSchedule.error &&
        storedPaymentSchedule.data?.quote_version_id ===
          proposalSummary.quote_version_id &&
        storedPaymentSchedule.data.revision === 1 &&
        storedPaymentSchedule.data.status === "active" &&
        Number(storedPaymentSchedule.data.total_amount) === 504000 &&
        storedPaymentSchedule.data.item_count === 2 &&
        storedPaymentSchedule.data.content_sha256?.length === 64,
    );
    record(
      "payment schedule audit stores a hash and explicit zero-side-effect boundaries",
      !paymentScheduleAudit.error &&
        paymentScheduleAudit.data?.metadata?.item_count === 2 &&
        paymentScheduleAudit.data.metadata.content_sha256?.length === 64 &&
        paymentScheduleAudit.data.metadata.invoice_created === false &&
        paymentScheduleAudit.data.metadata.receivable_created === false &&
        paymentScheduleAudit.data.metadata.external_delivery_performed ===
          false &&
        !JSON.stringify(paymentScheduleAudit.data.metadata).includes(
          "Booking deposit",
        ),
    );

    const scheduleChangeApproval = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        approver_id: ownerUser.id,
        action: "quote.share",
        entity_type: "quote",
        entity_id: guardedQuoteId,
      })
      .select("id")
      .single();
    if (scheduleChangeApproval.error || !scheduleChangeApproval.data)
      throw scheduleChangeApproval.error ??
        new Error("Schedule-change approval fixture was not created.");
    const revisedPaymentSchedule = await owner.rpc(
      "append_quote_payment_schedule",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
        target_items: [
          { ...firstPaymentSchedule[0], amount: 200000 },
          { ...firstPaymentSchedule[1], amount: 304000 },
        ],
      },
    );
    const revisedScheduleRow = revisedPaymentSchedule.data?.[0];
    if (revisedPaymentSchedule.error || !revisedScheduleRow)
      throw revisedPaymentSchedule.error ??
        new Error("Revised payment schedule fixture was not created.");
    const [cancelledScheduleApproval, scheduleCancellationAudit] =
      await Promise.all([
        owner
          .from("approval_requests")
          .select("status")
          .eq("id", scheduleChangeApproval.data.id)
          .single(),
        owner
          .from("audit_events")
          .select("metadata")
          .eq("entity_id", scheduleChangeApproval.data.id)
          .eq("event_type", "approval.cancelled")
          .single(),
      ]);
    record(
      "payment term changes supersede prior terms and cancel stale sharing review",
      revisedScheduleRow.revision === 2 &&
        revisedScheduleRow.status === "active" &&
        cancelledScheduleApproval.data?.status === "cancelled" &&
        scheduleCancellationAudit.data?.metadata?.reason ===
          "quote_payment_schedule_changed",
    );

    activeVerificationPhase = "approval-gated quote publishing authorization";
    const publishApproval = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        approver_id: ownerUser.id,
        action: "quote.share",
        entity_type: "quote",
        entity_id: guardedQuoteId,
      })
      .select("id, status, payload")
      .single();
    if (publishApproval.error || !publishApproval.data)
      throw publishApproval.error ??
        new Error("Public proposal approval fixture was not created.");
    const publishApprovalPayload = JSON.stringify(publishApproval.data.payload);
    record(
      "approval evidence flags discount and term exceptions without wording",
      publishApproval.data.status === "pending" &&
        publishApproval.data.payload?.guardrail_status === "exception_review" &&
        publishApproval.data.payload.risk_codes?.includes(
          "discount_above_policy",
        ) &&
        publishApproval.data.payload.risk_codes?.includes(
          "non_standard_terms",
        ) &&
        Number(
          publishApproval.data.payload.commercial_exceptions
            ?.discount_percent,
        ) === 4 &&
      publishApproval.data.payload.commercial_exceptions
          ?.standard_terms_match === false &&
        publishApproval.data.payload.payment_schedule?.configured === true &&
        publishApproval.data.payload.payment_schedule?.revision === 2 &&
        publishApproval.data.payload.payment_schedule?.item_count === 2 &&
        publishApproval.data.payload.payment_schedule?.content_sha256?.length ===
          64 &&
        !/(Booking deposit|Final balance|151200|352800|200000|304000)/i.test(
          publishApprovalPayload,
        ) &&
        !publishApprovalPayload.includes("Subject to availability") &&
        !publishApprovalPayload.includes("Valid only until quote expiry"),
    );
    const rawProposalToken = randomBytes(32).toString("base64url");
    const proposalTokenHash = createHash("sha256")
      .update(rawProposalToken)
      .digest("hex");
    const proposalExpiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const unresolvedPublish = await owner.rpc("publish_quote_share", {
      target_organization_id: organizationA.id,
      target_quote_id: guardedQuoteId,
      target_approval_id: publishApproval.data.id,
      target_token_hash: proposalTokenHash,
      target_expires_at: proposalExpiresAt,
    });
    record(
      "public proposal publishing requires a resolved exact-version approval",
      Boolean(unresolvedPublish.error),
    );
    const directProposalLinkWrite = await owner.from("quote_share_links").insert({
      organization_id: organizationA.id,
      quote_id: guardedQuoteId,
      quote_version_id: proposalSummary.quote_version_id,
      approval_request_id: publishApproval.data.id,
      token_hash: proposalTokenHash,
      snapshot: {},
      expires_at: proposalExpiresAt,
    });
    record(
      "browser clients cannot forge public proposal links",
      Boolean(directProposalLinkWrite.error),
    );
    const approvedPublish = await owner.rpc("resolve_approval_request", {
      target_organization_id: organizationA.id,
      target_approval_id: publishApproval.data.id,
      target_decision: "approved",
    });
    if (
      approvedPublish.error ||
      approvedPublish.data?.[0]?.resolved_status !== "approved"
    )
      throw approvedPublish.error ??
        new Error("Public proposal approval was not resolved.");
    const foreignProposalPublish = await viewer.rpc("publish_quote_share", {
      target_organization_id: organizationA.id,
      target_quote_id: guardedQuoteId,
      target_approval_id: publishApproval.data.id,
      target_token_hash: proposalTokenHash,
      target_expires_at: proposalExpiresAt,
    });
    record(
      "foreign tenants cannot publish another workspace proposal",
      Boolean(foreignProposalPublish.error),
    );
    const invalidCredentialPublish = await owner.rpc("publish_quote_share", {
      target_organization_id: organizationA.id,
      target_quote_id: guardedQuoteId,
      target_approval_id: publishApproval.data.id,
      target_token_hash: "not-a-sha256-token",
      target_expires_at: proposalExpiresAt,
    });
    record(
      "proposal publishing rejects malformed bearer-token hashes",
      Boolean(invalidCredentialPublish.error),
    );
    const publishedProposal = await owner.rpc("publish_quote_share", {
      target_organization_id: organizationA.id,
      target_quote_id: guardedQuoteId,
      target_approval_id: publishApproval.data.id,
      target_token_hash: proposalTokenHash,
      target_expires_at: proposalExpiresAt,
    });
    const publishedProposalLink = publishedProposal.data?.[0];
    if (publishedProposal.error || !publishedProposalLink)
      throw publishedProposal.error ??
        new Error("Approved public proposal was not published.");
    record(
      "authorized human publishes one expiring exact-version proposal",
      publishedProposalLink.share_status === "active" &&
        publishedProposalLink.quote_version === 5 &&
        Boolean(publishedProposalLink.share_link_id),
    );
    const [directProposalRead, listedProposalLinks, storedProposal, quotePublicSnapshot] =
      await Promise.all([
        owner
          .from("quote_share_links")
          .select("id, token_hash, snapshot")
          .eq("organization_id", organizationA.id),
        owner.rpc("list_quote_share_links", {
          target_organization_id: organizationA.id,
        }),
        admin
          .from("quote_share_links")
          .select("token_hash, snapshot, quote_version_id")
          .eq("id", publishedProposalLink.share_link_id)
          .single(),
        admin.rpc("get_quote_share_snapshot", {
          target_token_hash: proposalTokenHash,
        }),
      ]);
    record(
      "browser clients receive proposal metadata but never hashes or snapshots",
      Boolean(directProposalRead.error) &&
        !listedProposalLinks.error &&
        listedProposalLinks.data?.length === 1 &&
        !Object.prototype.hasOwnProperty.call(
          listedProposalLinks.data[0] ?? {},
          "token_hash",
        ) &&
        !Object.prototype.hasOwnProperty.call(
          listedProposalLinks.data[0] ?? {},
          "snapshot",
        ),
    );
    const storedSnapshotText = JSON.stringify(storedProposal.data?.snapshot ?? {});
    record(
      "database stores only the bearer-token hash and a customer-safe snapshot",
      !storedProposal.error &&
        storedProposal.data?.token_hash === proposalTokenHash &&
        !storedSnapshotText.includes(rawProposalToken) &&
        !/(unit_cost|estimated_cost|margin|supplier|catalog|deal_id|contact_id)/i.test(
          storedSnapshotText,
        ),
    );
    record(
      "service-only proposal lookup returns exact approved customer evidence",
      !quotePublicSnapshot.error &&
        quotePublicSnapshot.data?.quote?.version === 5 &&
        Number(quotePublicSnapshot.data?.quote?.total_amount) === 504000 &&
        quotePublicSnapshot.data?.quote?.line_items?.length === 2 &&
        quotePublicSnapshot.data?.quote?.payment_schedule?.length === 2 &&
        quotePublicSnapshot.data.quote.payment_schedule.reduce(
          (sum, item) => sum + Number(item.amount),
          0,
        ) === 504000 &&
        quotePublicSnapshot.data?.quote?.content?.inclusions?.length === 3,
    );
    record(
      "new public proposals expose pending acceptance without customer identity",
      quotePublicSnapshot.data?.acceptance?.status === "pending" &&
        !JSON.stringify(quotePublicSnapshot.data?.acceptance).includes(
          "signatory",
        ),
    );
    const browserAcceptance = await owner.rpc("accept_quote_share", {
      target_token_hash: proposalTokenHash,
      target_signatory_name: "Browser user cannot self-authorize",
      target_statement_version: 1,
    });
    record(
      "authenticated browser clients cannot invoke customer acceptance directly",
      Boolean(browserAcceptance.error),
    );
    const directAcceptanceWrite = await owner.from("quote_acceptances").insert({
      organization_id: organizationA.id,
      quote_id: guardedQuoteId,
      quote_version_id: storedProposal.data?.quote_version_id,
      quote_share_link_id: publishedProposalLink.share_link_id,
      signatory_name: "Browser user cannot insert evidence",
      statement_version: 1,
      snapshot_sha256: "a".repeat(64),
    });
    record(
      "browser clients cannot forge customer acceptance rows",
      Boolean(directAcceptanceWrite.error),
    );
    const invalidAcceptance = await admin.rpc("accept_quote_share", {
      target_token_hash: proposalTokenHash,
      target_signatory_name: "A",
      target_statement_version: 1,
    });
    record(
      "customer acceptance rejects incomplete identity evidence",
      Boolean(invalidAcceptance.error),
    );
    const acceptedProposal = await admin.rpc("accept_quote_share", {
      target_token_hash: proposalTokenHash,
      target_signatory_name: "Aarav Sharma",
      target_statement_version: 1,
    });
    const acceptedProposalRow = acceptedProposal.data?.[0];
    if (acceptedProposal.error || !acceptedProposalRow)
      throw acceptedProposal.error ??
        new Error("Public proposal acceptance was not recorded.");
    const retriedAcceptance = await admin.rpc("accept_quote_share", {
      target_token_hash: proposalTokenHash,
      target_signatory_name: "Aarav Sharma",
      target_statement_version: 1,
    });
    const [
      acceptanceEvidence,
      acceptedQuote,
      acceptanceAudit,
      acceptedPublicSnapshot,
      acceptanceCount,
    ] = await Promise.all([
      owner
        .from("quote_acceptances")
        .select(
          "id, quote_id, quote_version_id, quote_share_link_id, signatory_name, statement_version, snapshot_sha256, accepted_at",
        )
        .eq("quote_id", guardedQuoteId)
        .single(),
      owner.from("quotes").select("status, accepted_at").eq("id", guardedQuoteId).single(),
      owner
        .from("audit_events")
        .select("metadata")
        .eq("organization_id", organizationA.id)
        .eq("entity_id", guardedQuoteId)
        .eq("metadata->>event", "quote.customer_accepted")
        .single(),
      admin.rpc("get_quote_share_snapshot", {
        target_token_hash: proposalTokenHash,
      }),
      admin
        .from("quote_acceptances")
        .select("id", { count: "exact", head: true })
        .eq("quote_id", guardedQuoteId),
    ]);
    record(
      "customer acceptance binds one immutable row to the exact shared version",
      !acceptanceEvidence.error &&
        acceptanceEvidence.data?.id === acceptedProposalRow.acceptance_id &&
        acceptanceEvidence.data?.quote_version_id ===
          storedProposal.data?.quote_version_id &&
        acceptanceEvidence.data?.quote_share_link_id ===
          publishedProposalLink.share_link_id &&
        acceptanceEvidence.data?.signatory_name === "Aarav Sharma" &&
        acceptanceEvidence.data?.snapshot_sha256?.length === 64 &&
        acceptedQuote.data?.status === "accepted" &&
        Boolean(acceptedQuote.data?.accepted_at),
    );
    record(
      "customer acceptance retries are idempotent",
      !retriedAcceptance.error &&
        retriedAcceptance.data?.[0]?.already_accepted === true &&
        retriedAcceptance.data?.[0]?.acceptance_id ===
          acceptedProposalRow.acceptance_id &&
        acceptanceCount.count === 1,
    );
    const acceptanceAuditText = JSON.stringify(
      acceptanceAudit.data?.metadata ?? {},
    );
    record(
      "customer acceptance audit is privacy-safe and side-effect explicit",
      !acceptanceAudit.error &&
        !acceptanceAuditText.includes("Aarav Sharma") &&
        acceptanceAudit.data?.metadata?.opportunity_marked_won === false &&
        acceptanceAudit.data?.metadata?.booking_created === false &&
        acceptanceAudit.data?.metadata?.invoice_created === false &&
        acceptanceAudit.data?.metadata?.receivable_created === false &&
        acceptanceAudit.data?.metadata?.payment_collected === false &&
        acceptanceAudit.data?.metadata?.external_delivery_performed === false,
    );
    record(
      "public acceptance status excludes signatory identity and evidence hashes",
      !acceptedPublicSnapshot.error &&
        acceptedPublicSnapshot.data?.acceptance?.status === "accepted" &&
        acceptedPublicSnapshot.data?.acceptance?.statement_version === 1 &&
        Boolean(acceptedPublicSnapshot.data?.acceptance?.accepted_at) &&
        !/Aarav Sharma|snapshot_sha256|acceptance_id/.test(
          JSON.stringify(acceptedPublicSnapshot.data?.acceptance),
        ),
    );
    const foreignReceivableCreation = await viewer.rpc(
      "create_accepted_quote_receivables",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
      },
    );
    record(
      "foreign tenants cannot materialize another workspace quote receivables",
      Boolean(foreignReceivableCreation.error),
    );
    const unacceptedReceivableCreation = await owner.rpc(
      "create_accepted_quote_receivables",
      {
        target_organization_id: organizationA.id,
        target_quote_id: randomUUID(),
      },
    );
    record(
      "receivable handoff requires a real accepted quote",
      Boolean(unacceptedReceivableCreation.error),
    );
    const forgedQuoteReceivable = await owner.from("payments").insert({
      organization_id: organizationA.id,
      deal_id: governedDeal.id,
      direction: "receivable",
      status: "pending",
      title: "Forged accepted quote receivable",
      amount: 200000,
      paid_amount: 0,
      currency: "INR",
      due_at: firstPaymentSchedule[0].due_date,
      quote_id: guardedQuoteId,
      quote_version_id: storedProposal.data?.quote_version_id,
      quote_acceptance_id: acceptedProposalRow.acceptance_id,
      quote_payment_schedule_id: revisedScheduleRow.id,
      quote_schedule_item_position: 0,
    });
    record(
      "browser clients cannot forge accepted quote receivable provenance",
      Boolean(forgedQuoteReceivable.error),
    );
    const createdReceivables = await owner.rpc(
      "create_accepted_quote_receivables",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
      },
    );
    const receivableSummary = createdReceivables.data?.[0];
    if (createdReceivables.error || !receivableSummary)
      throw createdReceivables.error ??
        new Error("Accepted quote receivables were not created.");
    const retriedReceivables = await owner.rpc(
      "create_accepted_quote_receivables",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
      },
    );
    const [quoteReceivables, receivableAudit, retainedQuote, retainedDeal] =
      await Promise.all([
        owner
          .from("payments")
          .select(
            "quote_id, quote_version_id, quote_acceptance_id, quote_payment_schedule_id, quote_schedule_item_position, direction, status, title, invoice_number, supplier_id, amount, paid_amount, currency, due_at",
          )
          .eq("organization_id", organizationA.id)
          .eq("quote_acceptance_id", acceptedProposalRow.acceptance_id)
          .order("quote_schedule_item_position"),
        owner
          .from("audit_events")
          .select("metadata")
          .eq("organization_id", organizationA.id)
          .eq("entity_id", guardedQuoteId)
          .eq("metadata->>event", "quote.receivables_created"),
        owner.from("quotes").select("status").eq("id", guardedQuoteId).single(),
        owner.from("deals").select("stage").eq("id", governedDeal.id).single(),
      ]);
    record(
      "accepted milestones create exact reconciled internal receivables",
      !quoteReceivables.error &&
        quoteReceivables.data?.length === 2 &&
        quoteReceivables.data[0]?.title === "Booking deposit" &&
        Number(quoteReceivables.data[0]?.amount) === 200000 &&
        quoteReceivables.data[1]?.title === "Final balance" &&
        Number(quoteReceivables.data[1]?.amount) === 304000 &&
        quoteReceivables.data.reduce(
          (sum, receivable) => sum + Number(receivable.amount),
          0,
        ) === 504000 &&
        quoteReceivables.data.every(
          (receivable, position) =>
            receivable.quote_id === guardedQuoteId &&
            receivable.quote_version_id === storedProposal.data?.quote_version_id &&
            receivable.quote_acceptance_id ===
              acceptedProposalRow.acceptance_id &&
            receivable.quote_payment_schedule_id === revisedScheduleRow.id &&
            receivable.quote_schedule_item_position === position &&
            receivable.direction === "receivable" &&
            receivable.invoice_number === null &&
            receivable.supplier_id === null &&
            Number(receivable.paid_amount) === 0,
        ),
    );
    const receivableAuditMetadata = receivableAudit.data?.[0]?.metadata;
    record(
      "receivable handoff audit is exact and external-effect explicit",
      !receivableAudit.error &&
        receivableAudit.data?.length === 1 &&
        receivableAuditMetadata?.receivable_count === 2 &&
        Number(receivableAuditMetadata?.total_amount) === 504000 &&
        receivableAuditMetadata?.invoice_issued === false &&
        receivableAuditMetadata?.invoice_delivered === false &&
        receivableAuditMetadata?.payment_collected === false &&
        receivableAuditMetadata?.booking_created === false &&
        receivableAuditMetadata?.opportunity_marked_won === false &&
        receivableAuditMetadata?.external_action_performed === false,
    );
    record(
      "receivable handoff preserves accepted quote and open opportunity state",
      retainedQuote.data?.status === "accepted" &&
        retainedDeal.data?.stage !== "won",
    );
    record(
      "accepted quote receivable retries are idempotent",
      !retriedReceivables.error &&
        retriedReceivables.data?.[0]?.already_created === true &&
        retriedReceivables.data?.[0]?.receivable_count === 2 &&
        quoteReceivables.data?.length === 2 &&
        receivableAudit.data?.length === 1,
    );
    const defaultInvoicePolicy = await owner
      .from("invoice_number_policies")
      .select("number_prefix, next_number, number_padding")
      .eq("organization_id", organizationA.id)
      .single();
    record(
      "new workspaces receive a bounded invoice number preview policy",
      !defaultInvoicePolicy.error &&
        defaultInvoicePolicy.data?.number_prefix === "INV-" &&
        Number(defaultInvoicePolicy.data?.next_number) === 1 &&
        defaultInvoicePolicy.data?.number_padding === 4,
    );
    const foreignInvoicePolicyWrite = await viewer.rpc(
      "upsert_invoice_number_policy",
      {
        target_organization_id: organizationA.id,
        target_number_prefix: "EVIL-",
        target_next_number: 1,
        target_number_padding: 4,
      },
    );
    record(
      "foreign tenants cannot configure invoice number previews",
      Boolean(foreignInvoicePolicyWrite.error),
    );
    const configuredInvoicePolicy = await owner.rpc(
      "upsert_invoice_number_policy",
      {
        target_organization_id: organizationA.id,
        target_number_prefix: "INV/2027-",
        target_next_number: 42,
        target_number_padding: 5,
      },
    );
    record(
      "finance authority configures bounded invoice preview identity",
      !configuredInvoicePolicy.error &&
        configuredInvoicePolicy.data?.[0]?.number_prefix === "INV/2027-" &&
        Number(configuredInvoicePolicy.data?.[0]?.next_number) === 42 &&
        configuredInvoicePolicy.data?.[0]?.number_padding === 5,
    );
    const foreignInvoicePreparation = await viewer.rpc(
      "prepare_accepted_quote_invoice_draft",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
      },
    );
    record(
      "foreign tenants cannot prepare another workspace invoice draft",
      Boolean(foreignInvoicePreparation.error),
    );
    const forgedInvoiceDraft = await owner.from("invoice_drafts").insert({
      organization_id: organizationA.id,
      quote_id: guardedQuoteId,
      quote_version_id: storedProposal.data?.quote_version_id,
      quote_acceptance_id: acceptedProposalRow.acceptance_id,
      quote_payment_schedule_id: revisedScheduleRow.id,
      deal_id: governedDeal.id,
      revision: 1,
      number_preview: "FORGED-0001",
      number_policy_updated_at: new Date().toISOString(),
      bill_to_name: "Forged Customer",
      currency: "INR",
      net_amount: 480000,
      tax_amount: 24000,
      total_amount: 504000,
      line_items: [],
      payment_terms: revisedScheduleRow.items,
    });
    record(
      "browser clients cannot forge invoice draft evidence",
      Boolean(forgedInvoiceDraft.error),
    );
    const preparedInvoice = await owner.rpc(
      "prepare_accepted_quote_invoice_draft",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
      },
    );
    const preparedInvoiceRow = preparedInvoice.data?.[0];
    if (preparedInvoice.error || !preparedInvoiceRow)
      throw preparedInvoice.error ?? new Error("Invoice draft was not prepared.");
    const [storedInvoiceDraft, invoiceDraftAudit, hiddenForeignInvoiceDraft] =
      await Promise.all([
        owner
          .from("invoice_drafts")
          .select(
            "id, quote_id, quote_version_id, quote_acceptance_id, quote_payment_schedule_id, deal_id, contact_id, revision, status, number_preview, number_policy_updated_at, bill_to_name, currency, net_amount, tax_amount, total_amount, line_items, payment_terms, line_count, payment_term_count, content_sha256",
          )
          .eq("id", preparedInvoiceRow.invoice_draft_id)
          .single(),
        owner
          .from("audit_events")
          .select("metadata")
          .eq("entity_id", preparedInvoiceRow.invoice_draft_id)
          .eq("metadata->>event", "finance.invoice_draft_prepared")
          .single(),
        viewer
          .from("invoice_drafts")
          .select("id")
          .eq("organization_id", organizationA.id),
      ]);
    record(
      "accepted quote evidence creates an exact pre-issuance invoice draft",
      !storedInvoiceDraft.error &&
        storedInvoiceDraft.data?.quote_id === guardedQuoteId &&
        storedInvoiceDraft.data?.quote_version_id ===
          storedProposal.data?.quote_version_id &&
        storedInvoiceDraft.data?.quote_acceptance_id ===
          acceptedProposalRow.acceptance_id &&
        storedInvoiceDraft.data?.quote_payment_schedule_id ===
          revisedScheduleRow.id &&
        storedInvoiceDraft.data?.deal_id === governedDeal.id &&
        storedInvoiceDraft.data?.revision === 1 &&
        storedInvoiceDraft.data?.status === "ready" &&
        storedInvoiceDraft.data?.number_preview === "INV/2027-00042" &&
        storedInvoiceDraft.data?.bill_to_name === "Alpha traveller" &&
        Number(storedInvoiceDraft.data?.net_amount) === 480000 &&
        Number(storedInvoiceDraft.data?.tax_amount) === 24000 &&
        Number(storedInvoiceDraft.data?.total_amount) === 504000 &&
        storedInvoiceDraft.data?.line_count === 2 &&
        storedInvoiceDraft.data?.payment_term_count === 2 &&
        storedInvoiceDraft.data?.line_items?.[0]?.description === "Two rooms" &&
        storedInvoiceDraft.data?.payment_terms?.[1]?.label === "Final balance" &&
        storedInvoiceDraft.data?.content_sha256?.length === 64,
    );
    record(
      "invoice draft evidence remains hidden from foreign tenants",
      !hiddenForeignInvoiceDraft.error &&
        hiddenForeignInvoiceDraft.data?.length === 0,
    );
    const forgedInvoiceRewrite = await owner
      .from("invoice_drafts")
      .update({ total_amount: 1 })
      .eq("id", preparedInvoiceRow.invoice_draft_id);
    record(
      "browser clients cannot rewrite immutable invoice draft evidence",
      Boolean(forgedInvoiceRewrite.error),
    );
    const retriedInvoiceDraft = await owner.rpc(
      "prepare_accepted_quote_invoice_draft",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
      },
    );
    record(
      "exact invoice draft preparation is idempotent",
      !retriedInvoiceDraft.error &&
        retriedInvoiceDraft.data?.[0]?.already_prepared === true &&
        retriedInvoiceDraft.data?.[0]?.invoice_draft_id ===
          preparedInvoiceRow.invoice_draft_id,
    );
    await owner.rpc("upsert_invoice_number_policy", {
      target_organization_id: organizationA.id,
      target_number_prefix: "INV/2027-",
      target_next_number: 43,
      target_number_padding: 5,
    });
    const revisedInvoiceDraft = await owner.rpc(
      "prepare_accepted_quote_invoice_draft",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
      },
    );
    const invoiceDraftHistory = await owner
      .from("invoice_drafts")
      .select("id, revision, status, number_preview, superseded_at")
      .eq("quote_acceptance_id", acceptedProposalRow.acceptance_id)
      .order("revision");
    record(
      "invoice preview policy changes append rather than rewrite draft evidence",
      !revisedInvoiceDraft.error &&
        revisedInvoiceDraft.data?.[0]?.revision === 2 &&
        revisedInvoiceDraft.data?.[0]?.number_preview === "INV/2027-00043" &&
        invoiceDraftHistory.data?.length === 2 &&
        invoiceDraftHistory.data?.[0]?.status === "superseded" &&
        Boolean(invoiceDraftHistory.data?.[0]?.superseded_at) &&
        invoiceDraftHistory.data?.[1]?.status === "ready",
    );
    const invoicePolicyAfterDrafts = await owner
      .from("invoice_number_policies")
      .select("next_number")
      .eq("organization_id", organizationA.id)
      .single();
    const quoteReceivablesAfterDraft = await owner
      .from("payments")
      .select("invoice_number")
      .eq("quote_acceptance_id", acceptedProposalRow.acceptance_id);
    record(
      "invoice drafts allocate no number and alter no receivable",
      Number(invoicePolicyAfterDrafts.data?.next_number) === 43 &&
        quoteReceivablesAfterDraft.data?.every(
          (receivable) => receivable.invoice_number === null,
        ),
    );
    const invoiceAuditMetadata = invoiceDraftAudit.data?.metadata;
    record(
      "invoice draft audit is content-safe and external-effect explicit",
      !invoiceDraftAudit.error &&
        invoiceAuditMetadata?.line_count === 2 &&
        invoiceAuditMetadata?.payment_term_count === 2 &&
        invoiceAuditMetadata?.content_sha256?.length === 64 &&
        invoiceAuditMetadata?.invoice_number_allocated === false &&
        invoiceAuditMetadata?.invoice_issued === false &&
        invoiceAuditMetadata?.invoice_delivered === false &&
        invoiceAuditMetadata?.payment_collected === false &&
        invoiceAuditMetadata?.external_action_performed === false &&
        !/Alpha traveller|Two rooms|Final balance/.test(
          JSON.stringify(invoiceAuditMetadata),
        ),
    );
    const revisedInvoiceDraftRow = revisedInvoiceDraft.data?.[0];
    if (!revisedInvoiceDraftRow)
      throw new Error("Revised invoice draft evidence is unavailable.");
    const approvalWithoutIssuer = await owner.rpc(
      "request_invoice_issuance_approval",
      {
        target_organization_id: organizationA.id,
        target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
        target_rationale:
          "Finance reviewed the exact accepted quote before issuance.",
      },
    );
    record(
      "invoice issuance approval requires configured issuer identity",
      Boolean(approvalWithoutIssuer.error),
    );
    const foreignIssuerUpdate = await viewer.rpc(
      "upsert_invoice_issuer_profile",
      {
        target_organization_id: organizationA.id,
        target_legal_name: "Foreign issuer",
        target_registered_address: "Foreign registered address",
        target_jurisdiction_country_code: "IN",
        target_tax_registration_id: "29ABCDE1234F1Z5",
      },
    );
    record(
      "foreign tenants cannot configure another invoice issuer identity",
      Boolean(foreignIssuerUpdate.error),
    );
    const configuredIssuer = await owner.rpc("upsert_invoice_issuer_profile", {
      target_organization_id: organizationA.id,
      target_legal_name: "Alpha Travel Private Limited",
      target_registered_address:
        "12 Fictional Market Road, Bengaluru, Karnataka 560001",
      target_jurisdiction_country_code: "IN",
      target_tax_registration_id: "29ABCDE1234F1Z5",
    });
    record(
      "finance authority configures bounded invoice issuer identity",
      !configuredIssuer.error &&
        configuredIssuer.data?.[0]?.legal_name ===
          "Alpha Travel Private Limited" &&
        configuredIssuer.data?.[0]?.jurisdiction_country_code === "IN" &&
        configuredIssuer.data?.[0]?.tax_registration_id ===
          "29ABCDE1234F1Z5",
    );
    const hiddenForeignIssuer = await viewer
      .from("invoice_issuer_profiles")
      .select("organization_id")
      .eq("organization_id", organizationA.id);
    record(
      "invoice issuer identity remains hidden from foreign tenants",
      !hiddenForeignIssuer.error && hiddenForeignIssuer.data?.length === 0,
    );
    const forgedIssuance = await owner.from("invoice_issuances").insert({
      organization_id: organizationA.id,
      invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
      approval_request_id: publishApproval.data.id,
      quote_id: guardedQuoteId,
      quote_version_id: storedProposal.data?.quote_version_id,
      quote_acceptance_id: acceptedProposalRow.acceptance_id,
      quote_payment_schedule_id: revisedScheduleRow.id,
      deal_id: governedDeal.id,
      draft_revision: 2,
      source_content_sha256: "0".repeat(64),
      invoice_number: "INV/2027-00043",
      sequence_value: 43,
      number_prefix: "INV/2027-",
      number_padding: 5,
      number_policy_updated_at: new Date().toISOString(),
      issuer_profile_updated_at: new Date().toISOString(),
      issuer_legal_name: "Forged issuer",
      issuer_registered_address: "Forged registered address",
      issuer_jurisdiction_country_code: "IN",
      issuer_tax_registration_id: "29ABCDE1234F1Z5",
      bill_to_name: "Forged bill to",
      currency: "INR",
      net_amount: 480000,
      tax_amount: 24000,
      total_amount: 504000,
      line_items: storedInvoiceDraft.data?.line_items,
      payment_terms: storedInvoiceDraft.data?.payment_terms,
      approved_by: ownerUser.id,
      approved_at: new Date().toISOString(),
      issued_by: ownerUser.id,
    });
    record(
      "browser clients cannot forge immutable invoice issuance evidence",
      Boolean(forgedIssuance.error),
    );
    const issuanceApproval = await owner.rpc(
      "request_invoice_issuance_approval",
      {
        target_organization_id: organizationA.id,
        target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
        target_rationale:
          "Finance verified the exact quote, customer totals, payment terms, and issuer identity.",
      },
    );
    const issuanceApprovalRow = issuanceApproval.data?.[0];
    if (issuanceApproval.error || !issuanceApprovalRow)
      throw issuanceApproval.error ??
        new Error("Invoice issuance approval was not requested.");
    const [storedIssuanceApproval, issuanceApprovalAudit] = await Promise.all([
      owner
        .from("approval_requests")
        .select("status, action, entity_type, entity_id, payload, expires_at")
        .eq("id", issuanceApprovalRow.approval_request_id)
        .single(),
      owner
        .from("audit_events")
        .select("metadata")
        .eq("entity_id", issuanceApprovalRow.approval_request_id)
        .eq("metadata->>event", "finance.invoice_issuance_requested")
        .single(),
    ]);
    record(
      "invoice issuance review is canonical and exact-draft bound",
      !storedIssuanceApproval.error &&
        storedIssuanceApproval.data?.status === "pending" &&
        storedIssuanceApproval.data?.action === "invoice.issue" &&
        storedIssuanceApproval.data?.entity_type === "invoice_draft" &&
        storedIssuanceApproval.data?.entity_id ===
          revisedInvoiceDraftRow.invoice_draft_id &&
        storedIssuanceApproval.data?.payload?.draft_revision === 2 &&
        storedIssuanceApproval.data?.payload?.draft_content_sha256?.length ===
          64 &&
        storedIssuanceApproval.data?.payload?.issuer_profile_sha256?.length ===
          64 &&
        storedIssuanceApproval.data?.payload?.number_preview ===
          "INV/2027-00043" &&
        storedIssuanceApproval.data?.payload?.invoice_number_allocated ===
          false &&
        storedIssuanceApproval.data?.payload?.invoice_issued === false &&
        storedIssuanceApproval.data?.payload?.invoice_delivered === false &&
        storedIssuanceApproval.data?.payload?.external_action_performed ===
          false,
    );
    const retriedIssuanceApproval = await owner.rpc(
      "request_invoice_issuance_approval",
      {
        target_organization_id: organizationA.id,
        target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
        target_rationale:
          "Finance verified the exact quote, customer totals, payment terms, and issuer identity.",
      },
    );
    record(
      "exact invoice issuance review retries are idempotent",
      !retriedIssuanceApproval.error &&
        retriedIssuanceApproval.data?.[0]?.already_requested === true &&
        retriedIssuanceApproval.data?.[0]?.approval_request_id ===
          issuanceApprovalRow.approval_request_id,
    );
    const prematureIssuance = await owner.rpc("issue_approved_invoice", {
      target_organization_id: organizationA.id,
      target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
      target_approval_request_id: issuanceApprovalRow.approval_request_id,
    });
    record(
      "invoice numbering cannot execute before the human approval",
      Boolean(prematureIssuance.error),
    );
    const resolvedIssuanceApproval = await owner.rpc(
      "resolve_approval_request",
      {
        target_organization_id: organizationA.id,
        target_approval_id: issuanceApprovalRow.approval_request_id,
        target_decision: "approved",
      },
    );
    record(
      "human resolution approves one exact invoice draft",
      !resolvedIssuanceApproval.error &&
        resolvedIssuanceApproval.data?.[0]?.resolved_status === "approved",
    );
    await owner.rpc("upsert_invoice_issuer_profile", {
      target_organization_id: organizationA.id,
      target_legal_name: "Alpha Travel Private Limited",
      target_registered_address:
        "14 Fictional Market Road, Bengaluru, Karnataka 560001",
      target_jurisdiction_country_code: "IN",
      target_tax_registration_id: "29ABCDE1234F1Z5",
    });
    const expiredApprovedIssuance = await owner
      .from("approval_requests")
      .select("status")
      .eq("id", issuanceApprovalRow.approval_request_id)
      .single();
    record(
      "issuer changes expire an approved but unexecuted invoice gate",
      expiredApprovedIssuance.data?.status === "expired",
    );
    const staleApprovedIssuance = await owner.rpc("issue_approved_invoice", {
      target_organization_id: organizationA.id,
      target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
      target_approval_request_id: issuanceApprovalRow.approval_request_id,
    });
    record(
      "stale approved issuer evidence cannot allocate an invoice number",
      Boolean(staleApprovedIssuance.error),
    );
    const renewedIssuanceApproval = await owner.rpc(
      "request_invoice_issuance_approval",
      {
        target_organization_id: organizationA.id,
        target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
        target_rationale:
          "Finance rechecked the exact draft after the issuer identity update.",
      },
    );
    const executableApprovalId =
      renewedIssuanceApproval.data?.[0]?.approval_request_id;
    if (renewedIssuanceApproval.error || !executableApprovalId)
      throw renewedIssuanceApproval.error ??
        new Error("Renewed invoice approval is unavailable.");
    const resolvedRenewedIssuance = await owner.rpc(
      "resolve_approval_request",
      {
        target_organization_id: organizationA.id,
        target_approval_id: executableApprovalId,
        target_decision: "approved",
      },
    );
    record(
      "changed issuer evidence requires a fresh human approval",
      !resolvedRenewedIssuance.error &&
        resolvedRenewedIssuance.data?.[0]?.resolved_status === "approved",
    );
    const foreignIssuance = await viewer.rpc("issue_approved_invoice", {
      target_organization_id: organizationA.id,
      target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
      target_approval_request_id: executableApprovalId,
    });
    record(
      "foreign tenants cannot execute another workspace invoice approval",
      Boolean(foreignIssuance.error),
    );
    const issuedInvoice = await owner.rpc("issue_approved_invoice", {
      target_organization_id: organizationA.id,
      target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
      target_approval_request_id: executableApprovalId,
    });
    const issuedInvoiceRow = issuedInvoice.data?.[0];
    if (issuedInvoice.error || !issuedInvoiceRow)
      throw issuedInvoice.error ?? new Error("Invoice was not issued.");
    const [
      storedIssuance,
      issuedDraft,
      policyAfterIssuance,
      linkedReceivables,
      hiddenForeignIssuance,
      issuanceAudit,
    ] = await Promise.all([
      owner
        .from("invoice_issuances")
        .select(
          "id, invoice_draft_id, approval_request_id, quote_id, quote_version_id, quote_acceptance_id, quote_payment_schedule_id, draft_revision, source_content_sha256, invoice_number, sequence_value, number_prefix, number_padding, issuer_legal_name, issuer_jurisdiction_country_code, issuer_tax_registration_id, bill_to_name, currency, net_amount, tax_amount, total_amount, line_count, payment_term_count, issuance_sha256",
        )
        .eq("id", issuedInvoiceRow.invoice_issuance_id)
        .single(),
      owner
        .from("invoice_drafts")
        .select("status")
        .eq("id", revisedInvoiceDraftRow.invoice_draft_id)
        .single(),
      owner
        .from("invoice_number_policies")
        .select("next_number")
        .eq("organization_id", organizationA.id)
        .single(),
      owner
        .from("payments")
        .select("invoice_issuance_id, invoice_number")
        .eq("quote_acceptance_id", acceptedProposalRow.acceptance_id),
      viewer
        .from("invoice_issuances")
        .select("id")
        .eq("organization_id", organizationA.id),
      owner
        .from("audit_events")
        .select("metadata")
        .eq("entity_id", issuedInvoiceRow.invoice_issuance_id)
        .eq("metadata->>event", "finance.invoice_issued")
        .single(),
    ]);
    record(
      "approved issuance atomically freezes exact invoice evidence",
      !storedIssuance.error &&
        storedIssuance.data?.invoice_draft_id ===
          revisedInvoiceDraftRow.invoice_draft_id &&
        storedIssuance.data?.approval_request_id ===
          executableApprovalId &&
        storedIssuance.data?.quote_id === guardedQuoteId &&
        storedIssuance.data?.quote_acceptance_id ===
          acceptedProposalRow.acceptance_id &&
        storedIssuance.data?.draft_revision === 2 &&
        storedIssuance.data?.invoice_number === "INV/2027-00043" &&
        Number(storedIssuance.data?.sequence_value) === 43 &&
        storedIssuance.data?.issuer_legal_name ===
          "Alpha Travel Private Limited" &&
        storedIssuance.data?.issuer_jurisdiction_country_code === "IN" &&
        storedIssuance.data?.bill_to_name === "Alpha traveller" &&
        Number(storedIssuance.data?.net_amount) === 480000 &&
        Number(storedIssuance.data?.tax_amount) === 24000 &&
        Number(storedIssuance.data?.total_amount) === 504000 &&
        storedIssuance.data?.line_count === 2 &&
        storedIssuance.data?.payment_term_count === 2 &&
        storedIssuance.data?.source_content_sha256?.length === 64 &&
        storedIssuance.data?.issuance_sha256?.length === 64,
    );
    record(
      "issuance consumes one number and links every exact receivable atomically",
      issuedDraft.data?.status === "issued" &&
        Number(policyAfterIssuance.data?.next_number) === 44 &&
        linkedReceivables.data?.length === 2 &&
        linkedReceivables.data?.every(
          (receivable) =>
            receivable.invoice_issuance_id ===
              issuedInvoiceRow.invoice_issuance_id &&
            receivable.invoice_number === null,
        ),
    );
    record(
      "issued invoice evidence remains hidden from foreign tenants",
      !hiddenForeignIssuance.error && hiddenForeignIssuance.data?.length === 0,
    );
    const forgedIssuanceRewrite = await owner
      .from("invoice_issuances")
      .update({ invoice_number: "FORGED-999" })
      .eq("id", issuedInvoiceRow.invoice_issuance_id);
    record(
      "browser clients cannot rewrite issued invoice evidence",
      Boolean(forgedIssuanceRewrite.error),
    );
    const issuanceRetry = await owner.rpc("issue_approved_invoice", {
      target_organization_id: organizationA.id,
      target_invoice_draft_id: revisedInvoiceDraftRow.invoice_draft_id,
      target_approval_request_id: executableApprovalId,
    });
    record(
      "approved invoice issuance retries consume no second number",
      !issuanceRetry.error &&
        issuanceRetry.data?.[0]?.already_issued === true &&
        issuanceRetry.data?.[0]?.invoice_issuance_id ===
          issuedInvoiceRow.invoice_issuance_id &&
        issuanceRetry.data?.[0]?.invoice_number === "INV/2027-00043",
    );
    const rewoundInvoicePolicy = await owner.rpc(
      "upsert_invoice_number_policy",
      {
        target_organization_id: organizationA.id,
        target_number_prefix: "INV/2027-",
        target_next_number: 43,
        target_number_padding: 5,
      },
    );
    record(
      "issued invoice sequences cannot be rewound",
      Boolean(rewoundInvoicePolicy.error),
    );
    const postIssuanceDraft = await owner.rpc(
      "prepare_accepted_quote_invoice_draft",
      {
        target_organization_id: organizationA.id,
        target_quote_id: guardedQuoteId,
      },
    );
    record(
      "an issued acceptance cannot create a competing invoice draft",
      Boolean(postIssuanceDraft.error),
    );
    const issuanceAuditMetadata = issuanceAudit.data?.metadata;
    record(
      "invoice issuance audit is exact and delivery-safe",
      !issuanceApprovalAudit.error &&
        !issuanceAudit.error &&
        issuanceAuditMetadata?.invoice_number === "INV/2027-00043" &&
        issuanceAuditMetadata?.invoice_number_allocated === true &&
        issuanceAuditMetadata?.invoice_issued === true &&
        issuanceAuditMetadata?.invoice_rendered === false &&
        issuanceAuditMetadata?.invoice_delivered === false &&
        issuanceAuditMetadata?.payment_link_created === false &&
        issuanceAuditMetadata?.payment_collected === false &&
        issuanceAuditMetadata?.external_action_performed === false &&
        !/Alpha Travel|Alpha traveller|Two rooms|Final balance|29ABCDE/.test(
          JSON.stringify(issuanceAuditMetadata),
        ),
    );
    const reusedApproval = await owner.rpc("publish_quote_share", {
      target_organization_id: organizationA.id,
      target_quote_id: guardedQuoteId,
      target_approval_id: publishApproval.data.id,
      target_token_hash: createHash("sha256")
        .update(randomBytes(32).toString("base64url"))
        .digest("hex"),
      target_expires_at: proposalExpiresAt,
    });
    record(
      "one human approval cannot produce competing proposal links",
      Boolean(reusedApproval.error),
    );
    const weakRevocation = await owner.rpc("revoke_quote_share", {
      target_organization_id: organizationA.id,
      target_share_link_id: publishedProposalLink.share_link_id,
      target_note: "short",
    });
    record(
      "proposal revocation requires accountable human evidence",
      Boolean(weakRevocation.error),
    );
    const foreignRevocation = await viewer.rpc("revoke_quote_share", {
      target_organization_id: organizationA.id,
      target_share_link_id: publishedProposalLink.share_link_id,
      target_note: "Foreign tenant must not revoke this proposal",
    });
    record(
      "foreign tenants cannot revoke another workspace proposal",
      Boolean(foreignRevocation.error),
    );
    const revokedProposal = await owner.rpc("revoke_quote_share", {
      target_organization_id: organizationA.id,
      target_share_link_id: publishedProposalLink.share_link_id,
      target_note: "Customer requested a revised proposal",
    });
    const [revokedProposalSnapshot, retainedAcceptedQuote, proposalLifecycleAudit] =
      await Promise.all([
        admin.rpc("get_quote_share_snapshot", {
          target_token_hash: proposalTokenHash,
        }),
        owner
          .from("quotes")
          .select("status")
          .eq("id", guardedQuoteId)
          .single(),
        owner
          .from("audit_events")
          .select("metadata")
          .eq("organization_id", organizationA.id)
          .eq("entity_type", "quote_share_link")
          .eq("entity_id", publishedProposalLink.share_link_id)
          .order("created_at"),
      ]);
    record(
      "authorized revocation immediately invalidates public proposal access",
      !revokedProposal.error &&
        revokedProposal.data?.[0]?.share_status === "revoked" &&
        revokedProposalSnapshot.data === null &&
        retainedAcceptedQuote.data?.status === "accepted",
    );
    record(
      "revoking public access does not erase recorded customer acceptance",
      retainedAcceptedQuote.data?.status === "accepted",
    );
    record(
      "proposal lifecycle audit excludes tokens snapshots and commercial values",
      !proposalLifecycleAudit.error &&
        proposalLifecycleAudit.data?.length === 2 &&
        !proposalLifecycleAudit.data.some((event) =>
          new RegExp(
            `${proposalTokenHash}|${rawProposalToken}|504000|370000|Private airport`,
            "i",
          ).test(JSON.stringify(event.metadata)),
        ),
    );
    const { data: structuredAudit, error: structuredAuditError } = await owner
      .from("audit_events")
      .select("metadata")
      .eq("organization_id", organizationA.id)
      .eq("event_type", "pricing.changed")
      .eq("entity_id", guardedQuoteId)
      .eq("metadata->>event", "quote.structured_version_created")
      .single();
    record(
      "structured quote audit evidence is content-free and side-effect explicit",
      !structuredAuditError &&
        structuredAudit?.metadata?.line_count === 2 &&
        structuredAudit.metadata.external_share_performed === false &&
        !JSON.stringify(structuredAudit.metadata).includes("480000") &&
        !JSON.stringify(structuredAudit.metadata).includes("370000"),
    );
    const { data: catalogAudit, error: catalogAuditError } = await owner
      .from("audit_events")
      .select("metadata")
      .eq("organization_id", organizationA.id)
      .eq("entity_type", "quote_catalog_product")
      .eq("entity_id", catalogProduct.product_id);
    record(
      "catalog pricing audit preserves lifecycle evidence without amounts",
      !catalogAuditError &&
        catalogAudit?.length === 4 &&
        catalogAudit.every(
          (event) =>
            event.metadata?.external_action_performed === false &&
            !JSON.stringify(event.metadata).includes("190000") &&
            !JSON.stringify(event.metadata).includes("200000") &&
            !JSON.stringify(event.metadata).includes("150000"),
        ),
    );
    activeVerificationPhase = "governed CRM authorization";

    const directStageMutation = await owner
      .from("deals")
      .update({ stage: "qualified" })
      .eq("id", governedDeal.id)
      .select("id");
    record(
      "direct browser writes cannot bypass governed stage transitions",
      Boolean(directStageMutation.error),
    );

    const governedTransition = await owner.rpc("transition_deal_stage", {
      target_organization_id: organizationA.id,
      target_deal_id: governedDeal.id,
      target_stage: "qualified",
      target_lost_reason: null,
    });
    record(
      "authorized owner can execute a valid atomic stage transition",
      !governedTransition.error &&
        governedTransition.data?.length === 1 &&
        governedTransition.data[0].stage === "qualified",
    );

    const [ownerStageHistory, viewerForeignStageHistory] = await Promise.all([
      owner
        .from("deal_stage_history")
        .select("from_stage, to_stage")
        .eq("deal_id", governedDeal.id),
      viewer
        .from("deal_stage_history")
        .select("id")
        .eq("deal_id", governedDeal.id),
    ]);
    record(
      "governed transitions preserve append-only stage history",
      !ownerStageHistory.error &&
        (ownerStageHistory.data?.length ?? 0) === 2,
    );
    record(
      "foreign tenants cannot read stage history",
      !viewerForeignStageHistory.error &&
        viewerForeignStageHistory.data?.length === 0,
    );

    const forgedDocumentId = randomUUID();
    const forgedDocumentRecord = await owner.rpc("record_travel_document", {
      target_organization_id: organizationA.id,
      target_deal_id: governedDeal.id,
      target_contact_id: alphaContact.id,
      target_document_id: forgedDocumentId,
      target_storage_path: `${organizationA.id}/${forgedDocumentId}/missing.pdf`,
      target_file_name: "missing.pdf",
      target_mime_type: "application/pdf",
      target_byte_size: 10,
    });
    record(
      "document metadata cannot be forged without a private storage object",
      Boolean(forgedDocumentRecord.error),
    );

    activeVerificationPhase = "operational trip authorization";
    const { data: tripDeal, error: tripDealError } = await owner
      .from("deals")
      .insert({
        organization_id: organizationA.id,
        contact_id: alphaContact.id,
        owner_id: ownerUser.id,
        title: `Operational trip fixture ${suffix}`,
        destination: "Osaka",
        probability: 70,
        value_amount: 520000,
        currency: "INR",
        next_step: "Complete operational handoff",
        expected_close_at: "2026-09-30",
      })
      .select("id")
      .single();
    if (tripDealError || !tripDeal)
      throw (
        tripDealError ??
        new Error("Operational trip opportunity fixture was not created.")
      );
    for (const targetStage of [
      "qualified",
      "proposal",
      "decision",
      "won",
    ]) {
      const transition = await owner.rpc("transition_deal_stage", {
        target_organization_id: organizationA.id,
        target_deal_id: tripDeal.id,
        target_stage: targetStage,
        target_lost_reason: null,
      });
      if (transition.error)
        throw new Error(
          `Operational trip deal could not move to ${targetStage}: ${transition.error.message}`,
        );
    }

    const firstConversion = await owner
      .rpc("convert_won_deal_to_trip", {
        target_organization_id: organizationA.id,
        target_deal_id: tripDeal.id,
      })
      .single();
    record(
      "authorized owner can convert a won deal into one operational trip",
      !firstConversion.error &&
        firstConversion.data?.status === "confirmed" &&
        firstConversion.data?.converted_by === ownerUser.id,
      firstConversion.error?.message ?? null,
    );
    if (firstConversion.error || !firstConversion.data)
      throw (
        firstConversion.error ??
        new Error("Operational trip fixture was not converted.")
      );

    const repeatedConversion = await owner
      .rpc("convert_won_deal_to_trip", {
        target_organization_id: organizationA.id,
        target_deal_id: tripDeal.id,
      })
      .single();
    const { count: conversionCount } = await admin
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", tripDeal.id);
    record(
      "won-deal conversion is idempotent",
      !repeatedConversion.error &&
        repeatedConversion.data?.id === firstConversion.data.id &&
        conversionCount === 1,
      repeatedConversion.error?.message ?? null,
    );

    const directTripStatusMutation = await owner
      .from("trips")
      .update({ status: "in_travel" })
      .eq("id", firstConversion.data.id)
      .select("id");
    record(
      "direct browser writes cannot bypass governed trip transitions",
      Boolean(directTripStatusMutation.error),
    );

    const tripDates = await owner
      .from("trips")
      .update({ start_date: "2026-10-10", end_date: "2026-10-18" })
      .eq("id", firstConversion.data.id)
      .select("id")
      .single();
    if (tripDates.error)
      throw new Error(
        `Operational trip dates could not be prepared: ${tripDates.error.message}`,
      );
    const validTripTransition = await owner
      .rpc("transition_trip_status", {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_status: "in_travel",
        target_note: "Authorization lifecycle fixture",
      })
      .single();
    record(
      "authorized operator can execute a valid trip transition",
      !validTripTransition.error &&
        validTripTransition.data?.status === "in_travel",
      validTripTransition.error?.message ?? null,
    );

    const { data: governedBooking, error: governedBookingError } = await owner
      .from("bookings")
      .insert({
        organization_id: organizationA.id,
        trip_id: firstConversion.data.id,
        title: "Governed hotel fixture",
        booking_type: "hotel",
        currency: "INR",
      })
      .select("id")
      .single();
    if (governedBookingError || !governedBooking)
      throw (
        governedBookingError ??
        new Error("Governed booking fixture was not created.")
      );
    const directBookingStatusMutation = await owner
      .from("bookings")
      .update({ status: "requested" })
      .eq("id", governedBooking.id)
      .select("id");
    record(
      "direct browser writes cannot bypass governed booking transitions",
      Boolean(directBookingStatusMutation.error),
    );
    const requestedBooking = await owner
      .rpc("transition_booking_status", {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_booking_id: governedBooking.id,
        target_status: "requested",
        target_confirmation_reference: null,
      })
      .single();
    record(
      "authorized operator can move internal booking tracking",
      !requestedBooking.error &&
        requestedBooking.data?.status === "requested",
      requestedBooking.error?.message ?? null,
    );
    const missingBookingReference = await owner.rpc(
      "transition_booking_status",
      {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_booking_id: governedBooking.id,
        target_status: "confirmed",
        target_confirmation_reference: null,
      },
    );
    record(
      "booking confirmation requires a supplier reference",
      Boolean(missingBookingReference.error),
    );
    const confirmedBooking = await owner
      .rpc("transition_booking_status", {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_booking_id: governedBooking.id,
        target_status: "confirmed",
        target_confirmation_reference: "AUTHZ-HOTEL-42",
      })
      .single();
    record(
      "guarded booking confirmation preserves supplier evidence",
      !confirmedBooking.error &&
        confirmedBooking.data?.status === "confirmed" &&
        confirmedBooking.data?.confirmation_reference === "AUTHZ-HOTEL-42" &&
        Boolean(confirmedBooking.data?.confirmed_at),
      confirmedBooking.error?.message ?? null,
    );

    const firstRadarScan = await owner
      .rpc("refresh_operational_exceptions", {
        target_organization_id: organizationA.id,
      })
      .single();
    record(
      "authorized operator can scan bounded internal trip risks",
      !firstRadarScan.error &&
        firstRadarScan.data?.active_count >= 1 &&
        firstRadarScan.data?.critical_count >= 1,
      firstRadarScan.error?.message ?? null,
    );

    const { data: bookingException, error: bookingExceptionError } =
      await owner
        .from("operational_exceptions")
        .select(
          "id, status, severity, source_entity_id, acknowledged_by, resolved_by, operator_note",
        )
        .eq("organization_id", organizationA.id)
        .eq("trip_id", firstConversion.data.id)
        .eq("exception_type", "booking_schedule_missing")
        .single();
    record(
      "Operations Radar persists one deduplicated critical booking exception",
      !bookingExceptionError &&
        bookingException?.status === "open" &&
        bookingException?.severity === "critical" &&
        bookingException?.source_entity_id === governedBooking.id,
      bookingExceptionError?.message ?? null,
    );
    if (bookingExceptionError || !bookingException)
      throw (
        bookingExceptionError ??
        new Error("Operational exception fixture was not detected.")
      );

    const directExceptionMutation = await owner
      .from("operational_exceptions")
      .update({ status: "resolved" })
      .eq("id", bookingException.id)
      .select("id");
    record(
      "browser clients cannot bypass the exception lifecycle",
      Boolean(directExceptionMutation.error) ||
        directExceptionMutation.data?.length === 0,
    );

    const [viewerForeignException, viewerRadarScan] = await Promise.all([
      viewer
        .from("operational_exceptions")
        .select("id")
        .eq("id", bookingException.id),
      viewer.rpc("refresh_operational_exceptions", {
        target_organization_id: organizationA.id,
      }),
    ]);
    record(
      "foreign tenants cannot read or refresh another workspace radar",
      !viewerForeignException.error &&
        viewerForeignException.data?.length === 0 &&
        Boolean(viewerRadarScan.error),
    );

    const acknowledgedException = await owner
      .rpc("set_operational_exception_status", {
        target_organization_id: organizationA.id,
        target_exception_id: bookingException.id,
        target_status: "acknowledged",
        target_note: null,
      })
      .single();
    record(
      "authorized operator can acknowledge an exception with actor evidence",
      !acknowledgedException.error &&
        acknowledgedException.data?.status === "acknowledged" &&
        acknowledgedException.data?.acknowledged_by === ownerUser.id &&
        Boolean(acknowledgedException.data?.acknowledged_at),
      acknowledgedException.error?.message ?? null,
    );

    const unsupportedResolution = await owner.rpc(
      "set_operational_exception_status",
      {
        target_organization_id: organizationA.id,
        target_exception_id: bookingException.id,
        target_status: "resolved",
        target_note: null,
      },
    );
    record(
      "human resolution requires accountable evidence",
      Boolean(unsupportedResolution.error),
    );

    const resolvedException = await owner
      .rpc("set_operational_exception_status", {
        target_organization_id: organizationA.id,
        target_exception_id: bookingException.id,
        target_status: "resolved",
        target_note: "Booking timing reviewed by operations.",
      })
      .single();
    record(
      "authorized operator can resolve an exception with a note",
      !resolvedException.error &&
        resolvedException.data?.status === "resolved" &&
        resolvedException.data?.resolved_by === ownerUser.id &&
        resolvedException.data?.operator_note ===
          "Booking timing reviewed by operations.",
      resolvedException.error?.message ?? null,
    );

    const recurringRadarScan = await owner
      .rpc("refresh_operational_exceptions", {
        target_organization_id: organizationA.id,
      })
      .single();
    const { data: reopenedException } = await owner
      .from("operational_exceptions")
      .select("status, resolved_at")
      .eq("id", bookingException.id)
      .single();
    record(
      "a recurring risk reopens after the next objective scan",
      !recurringRadarScan.error &&
        reopenedException?.status === "open" &&
        reopenedException?.resolved_at === null,
      recurringRadarScan.error?.message ?? null,
    );

    const fixedBookingSchedule = await owner
      .from("bookings")
      .update({
        service_start_at: "2026-10-10T12:00:00.000Z",
        service_end_at: "2026-10-18T10:00:00.000Z",
      })
      .eq("id", governedBooking.id)
      .select("id")
      .single();
    if (fixedBookingSchedule.error)
      throw new Error(
        `Booking schedule risk could not be corrected: ${fixedBookingSchedule.error.message}`,
      );
    const clearedRadarScan = await owner
      .rpc("refresh_operational_exceptions", {
        target_organization_id: organizationA.id,
      })
      .single();
    const { data: clearedException } = await owner
      .from("operational_exceptions")
      .select("status, resolved_by, resolved_at, operator_note")
      .eq("id", bookingException.id)
      .single();
    record(
      "Operations Radar auto-clears a corrected objective condition",
      !clearedRadarScan.error &&
        clearedRadarScan.data?.resolved_count >= 1 &&
        clearedException?.status === "resolved" &&
        clearedException?.resolved_by === null &&
        Boolean(clearedException?.resolved_at) &&
        clearedException?.operator_note ===
          "Condition cleared by Operations Radar.",
      clearedRadarScan.error?.message ?? null,
    );

    activeVerificationPhase = "traveler entry-readiness authorization";
    const { data: alphaTraveler, error: alphaTravelerError } = await owner
      .from("travelers")
      .select("id")
      .eq("organization_id", organizationA.id)
      .eq("trip_id", firstConversion.data.id)
      .single();
    if (alphaTravelerError || !alphaTraveler)
      throw (
        alphaTravelerError ??
        new Error("Converted traveler fixture was not available.")
      );

    const [missingEntryReview, missingItineraryReview] = await Promise.all([
      owner
        .from("operational_exceptions")
        .select("id, severity, status")
        .eq("organization_id", organizationA.id)
        .eq("trip_id", firstConversion.data.id)
        .eq("exception_type", "traveler_entry_review_missing")
        .single(),
      owner
        .from("operational_exceptions")
        .select("id, severity, status")
        .eq("organization_id", organizationA.id)
        .eq("trip_id", firstConversion.data.id)
        .eq("exception_type", "itinerary_readiness_at_risk")
        .single(),
    ]);
    record(
      "Operations Radar detects missing entry and itinerary readiness",
      !missingEntryReview.error &&
        missingEntryReview.data?.severity === "critical" &&
        missingEntryReview.data?.status === "open" &&
        !missingItineraryReview.error &&
        missingItineraryReview.data?.severity === "critical" &&
        missingItineraryReview.data?.status === "open",
      missingEntryReview.error?.message ??
        missingItineraryReview.error?.message ??
        null,
    );

    const directEntryCheckWrite = await owner
      .from("traveler_entry_checks")
      .insert({
        organization_id: organizationA.id,
        trip_id: firstConversion.data.id,
        traveler_id: alphaTraveler.id,
        destination_country_code: "JP",
        citizenship_country_code: "IN",
        passport_validity_months_required: 6,
        visa_requirement: "unknown",
        visa_status: "unknown",
        reviewed_by: ownerUser.id,
      });
    record(
      "browser clients cannot write entry-readiness evidence directly",
      Boolean(directEntryCheckWrite.error),
    );

    const viewerEntryCheckWrite = await viewer.rpc(
      "upsert_traveler_entry_check",
      {
        target_organization_id: organizationB.id,
        target_trip_id: firstConversion.data.id,
        target_traveler_id: alphaTraveler.id,
        target_destination_country_code: "JP",
        target_citizenship_country_code: "IN",
        target_passport_validity_months_required: 6,
        target_visa_requirement: "unknown",
        target_visa_status: "unknown",
      },
    );
    record(
      "viewers cannot record traveler entry-readiness conclusions",
      Boolean(viewerEntryCheckWrite.error),
    );

    const unsupportedVisaConclusion = await owner.rpc(
      "upsert_traveler_entry_check",
      {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_traveler_id: alphaTraveler.id,
        target_destination_country_code: "JP",
        target_citizenship_country_code: "IN",
        target_passport_validity_months_required: 6,
        target_visa_requirement: "required",
        target_visa_status: "researching",
      },
    );
    record(
      "visa conclusions require a named human-reviewed evidence source",
      Boolean(unsupportedVisaConclusion.error),
    );

    const initialEntryCheck = await owner
      .rpc("upsert_traveler_entry_check", {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_traveler_id: alphaTraveler.id,
        target_destination_country_code: "JP",
        target_citizenship_country_code: "IN",
        target_passport_issuing_country_code: "IN",
        target_passport_expires_on: "2026-09-01",
        target_passport_validity_months_required: 6,
        target_visa_requirement: "required",
        target_visa_status: "researching",
        target_action_due_on: "2026-08-01",
        target_evidence_source_label:
          "Embassy advisory reviewed by authorization fixture",
        target_evidence_source_url: "https://official.example/entry",
      })
      .single();
    record(
      "authorized operators can record minimal reviewed readiness evidence",
      !initialEntryCheck.error &&
        initialEntryCheck.data?.reviewed_by === ownerUser.id &&
        initialEntryCheck.data?.destination_country_code === "JP" &&
        initialEntryCheck.data?.visa_status === "researching",
      initialEntryCheck.error?.message ?? null,
    );
    if (initialEntryCheck.error || !initialEntryCheck.data)
      throw (
        initialEntryCheck.error ??
        new Error("Entry-readiness fixture was not created.")
      );

    const [
      viewerForeignEntryChecks,
      directEntryCheckUpdate,
      entryRiskScan,
    ] = await Promise.all([
      viewer
        .from("traveler_entry_checks")
        .select("id")
        .eq("organization_id", organizationA.id),
      owner
        .from("traveler_entry_checks")
        .update({ visa_status: "granted" })
        .eq("id", initialEntryCheck.data.id)
        .select("id"),
      owner
        .rpc("refresh_operational_exceptions", {
          target_organization_id: organizationA.id,
        })
        .single(),
    ]);
    record(
      "entry-readiness rows remain tenant isolated and guarded",
      !viewerForeignEntryChecks.error &&
        viewerForeignEntryChecks.data?.length === 0 &&
        (Boolean(directEntryCheckUpdate.error) ||
          directEntryCheckUpdate.data?.length === 0),
      viewerForeignEntryChecks.error?.message ??
        directEntryCheckUpdate.error?.message ??
        null,
    );

    const { data: entryRiskExceptions, error: entryRiskError } = await owner
      .from("operational_exceptions")
      .select("exception_type, severity, status")
      .eq("organization_id", organizationA.id)
      .eq("trip_id", firstConversion.data.id)
      .in("exception_type", [
        "traveler_passport_at_risk",
        "traveler_visa_at_risk",
      ])
      .in("status", ["open", "acknowledged"]);
    record(
      "Operations Radar routes passport and visa risks without external action",
      !entryRiskScan.error &&
        !entryRiskError &&
        entryRiskExceptions?.length === 2 &&
        entryRiskExceptions.every(
          (exception) => exception.severity === "critical",
        ),
      entryRiskScan.error?.message ?? entryRiskError?.message ?? null,
    );

    const clearedEntryCheck = await owner
      .rpc("upsert_traveler_entry_check", {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_traveler_id: alphaTraveler.id,
        target_destination_country_code: "JP",
        target_citizenship_country_code: "IN",
        target_passport_issuing_country_code: "IN",
        target_passport_expires_on: "2028-12-31",
        target_passport_validity_months_required: 6,
        target_visa_requirement: "required",
        target_visa_status: "granted",
        target_visa_valid_until: "2027-12-31",
        target_evidence_source_label:
          "Embassy advisory reviewed by authorization fixture",
        target_evidence_source_url: "https://official.example/entry",
      })
      .single();
    if (clearedEntryCheck.error)
      throw new Error(
        `Entry-readiness risk could not be corrected: ${clearedEntryCheck.error.message}`,
      );

    const itineraryFixtures = Array.from({ length: 9 }, (_, index) => ({
      organization_id: organizationA.id,
      trip_id: firstConversion.data.id,
      day_number: index + 1,
      position: 1,
      item_type: "note",
      title: `Authorization itinerary day ${index + 1}`,
    }));
    const { error: itineraryFixtureError } = await owner
      .from("itinerary_items")
      .insert(itineraryFixtures);
    if (itineraryFixtureError)
      throw new Error(
        `Itinerary coverage fixture could not be created: ${itineraryFixtureError.message}`,
      );

    const readinessClearScan = await owner
      .rpc("refresh_operational_exceptions", {
        target_organization_id: organizationA.id,
      })
      .single();
    const { data: clearedReadinessExceptions } = await owner
      .from("operational_exceptions")
      .select("exception_type, status, operator_note")
      .eq("organization_id", organizationA.id)
      .eq("trip_id", firstConversion.data.id)
      .in("exception_type", [
        "traveler_entry_review_missing",
        "traveler_passport_at_risk",
        "traveler_visa_at_risk",
        "itinerary_readiness_at_risk",
      ]);
    record(
      "corrected traveler and itinerary evidence auto-clears readiness risks",
      !readinessClearScan.error &&
        clearedReadinessExceptions?.length === 4 &&
        clearedReadinessExceptions.every(
          (exception) =>
            exception.status === "resolved" &&
            exception.operator_note ===
              "Condition cleared by Operations Radar.",
        ),
      readinessClearScan.error?.message ?? null,
    );

    activeVerificationPhase = "durable Operations Radar authorization";
    const [
      ownerRadarPolicy,
      ownerForeignRadarPolicy,
      viewerRadarPolicy,
    ] = await Promise.all([
      owner
        .from("operations_radar_policies")
        .select("*")
        .eq("organization_id", organizationA.id)
        .single(),
      owner
        .from("operations_radar_policies")
        .select("organization_id")
        .eq("organization_id", organizationB.id),
      viewer
        .from("operations_radar_policies")
        .select("*")
        .eq("organization_id", organizationB.id)
        .single(),
    ]);
    record(
      "new workspaces receive one tenant-isolated Radar schedule",
      !ownerRadarPolicy.error &&
        ownerRadarPolicy.data?.scan_interval_minutes === 60 &&
        !viewerRadarPolicy.error &&
        ownerForeignRadarPolicy.data?.length === 0,
      ownerRadarPolicy.error?.message ??
        viewerRadarPolicy.error?.message ??
        ownerForeignRadarPolicy.error?.message ??
        null,
    );

    const directRadarPolicyUpdate = await owner
      .from("operations_radar_policies")
      .update({ scan_interval_minutes: 15 })
      .eq("organization_id", organizationA.id)
      .select("organization_id");
    record(
      "browser clients cannot mutate Radar schedules directly",
      Boolean(directRadarPolicyUpdate.error) ||
        directRadarPolicyUpdate.data?.length === 0,
    );

    const viewerRadarPolicyUpdate = await viewer.rpc(
      "upsert_operations_radar_policy",
      {
        target_organization_id: organizationB.id,
        target_is_enabled: true,
        target_scan_interval_minutes: 30,
        target_confirmation_watch_days: 14,
        target_confirmation_critical_hours: 48,
        target_confirmation_high_days: 7,
        target_document_expiry_days: 30,
        target_document_high_days: 7,
        target_payment_due_days: 7,
        target_payment_high_days: 2,
        target_task_critical_hours: 24,
      },
    );
    record(
      "viewer cannot configure durable Radar automation",
      Boolean(viewerRadarPolicyUpdate.error),
    );

    const foreignRadarAssignee = await owner.rpc(
      "upsert_operations_radar_policy",
      {
        target_organization_id: organizationA.id,
        target_is_enabled: true,
        target_scan_interval_minutes: 30,
        target_confirmation_watch_days: 14,
        target_confirmation_critical_hours: 48,
        target_confirmation_high_days: 7,
        target_document_expiry_days: 21,
        target_document_high_days: 5,
        target_payment_due_days: 5,
        target_payment_high_days: 2,
        target_task_critical_hours: 36,
        target_default_assignee_id: viewerUser.id,
      },
    );
    record(
      "Radar fallback ownership cannot cross tenant boundaries",
      Boolean(foreignRadarAssignee.error),
    );

    const governedRadarPolicy = await owner
      .rpc("upsert_operations_radar_policy", {
        target_organization_id: organizationA.id,
        target_is_enabled: true,
        target_scan_interval_minutes: 30,
        target_confirmation_watch_days: 10,
        target_confirmation_critical_hours: 36,
        target_confirmation_high_days: 5,
        target_document_expiry_days: 21,
        target_document_high_days: 5,
        target_payment_due_days: 5,
        target_payment_high_days: 2,
        target_task_critical_hours: 36,
        target_default_assignee_id: ownerUser.id,
      })
      .single();
    record(
      "authorized owner can save bounded Radar thresholds and ownership",
      !governedRadarPolicy.error &&
        governedRadarPolicy.data?.scan_interval_minutes === 30 &&
        governedRadarPolicy.data?.document_expiry_days === 21 &&
        governedRadarPolicy.data?.default_assignee_id === ownerUser.id,
      governedRadarPolicy.error?.message ?? null,
    );

    const ownerRadarClaim = await owner.rpc(
      "claim_operations_radar_runs",
      {
        target_worker_id: `owner-radar-${suffix}`,
        target_limit: 1,
      },
    );
    record(
      "ordinary authenticated clients cannot claim worker leases",
      Boolean(ownerRadarClaim.error),
    );

    const radarWorkerId = `authz-radar-worker-${suffix}`;
    const claimedRadarRun = await admin
      .rpc("claim_operations_radar_runs", {
        target_worker_id: radarWorkerId,
        target_limit: 1,
        target_organization_id: organizationA.id,
        target_force: true,
      })
      .single();
    record(
      "service worker claims one durable tenant-scoped Radar lease",
      !claimedRadarRun.error &&
        claimedRadarRun.data?.organization_id === organizationA.id &&
        claimedRadarRun.data?.trigger_type === "operator",
      claimedRadarRun.error?.message ?? null,
    );
    if (claimedRadarRun.error || !claimedRadarRun.data)
      throw (
        claimedRadarRun.error ??
        new Error("Durable Radar run was not claimed.")
      );

    const duplicateRadarClaim = await admin.rpc(
      "claim_operations_radar_runs",
      {
        target_worker_id: `${radarWorkerId}-duplicate`,
        target_limit: 1,
        target_organization_id: organizationA.id,
        target_force: true,
      },
    );
    record(
      "an active workspace lease prevents a duplicate Radar run",
      !duplicateRadarClaim.error &&
        (duplicateRadarClaim.data?.length ?? 0) === 0,
      duplicateRadarClaim.error?.message ?? null,
    );

    const wrongRadarSettlement = await admin.rpc(
      "settle_operations_radar_run",
      {
        target_run_id: claimedRadarRun.data.run_id,
        target_worker_id: `${radarWorkerId}-wrong`,
        target_status: "failed",
        target_error_code: "wrong_worker",
      },
    );
    record(
      "a Radar run can be settled only by its lease owner",
      Boolean(wrongRadarSettlement.error),
    );

    const scheduledRadarScan = await admin
      .rpc("refresh_operational_exceptions", {
        target_organization_id: organizationA.id,
      })
      .single();
    if (scheduledRadarScan.error || !scheduledRadarScan.data)
      throw (
        scheduledRadarScan.error ??
        new Error("Service Radar scan did not return a result.")
      );
    const settledRadarRun = await admin
      .rpc("settle_operations_radar_run", {
        target_run_id: claimedRadarRun.data.run_id,
        target_worker_id: radarWorkerId,
        target_status: "succeeded",
        target_active_count: scheduledRadarScan.data.active_count,
        target_critical_count: scheduledRadarScan.data.critical_count,
        target_resolved_count: scheduledRadarScan.data.resolved_count,
      })
      .single();
    record(
      "lease-owned Radar settlement preserves bounded run evidence",
      !settledRadarRun.error &&
        settledRadarRun.data?.status === "succeeded" &&
        settledRadarRun.data?.active_count ===
          scheduledRadarScan.data.active_count &&
        Boolean(settledRadarRun.data?.finished_at),
      settledRadarRun.error?.message ?? null,
    );

    const [
      ownerRadarRuns,
      viewerForeignRadarRuns,
      completedRadarPolicy,
    ] = await Promise.all([
      owner
        .from("operations_radar_runs")
        .select("id, status")
        .eq("organization_id", organizationA.id),
      viewer
        .from("operations_radar_runs")
        .select("id")
        .eq("organization_id", organizationA.id),
      owner
        .from("operations_radar_policies")
        .select("last_run_status, last_run_at")
        .eq("organization_id", organizationA.id)
        .single(),
    ]);
    record(
      "Radar run history and terminal policy state remain tenant isolated",
      !ownerRadarRuns.error &&
        ownerRadarRuns.data?.length === 1 &&
        ownerRadarRuns.data[0].status === "succeeded" &&
        !viewerForeignRadarRuns.error &&
        viewerForeignRadarRuns.data?.length === 0 &&
        !completedRadarPolicy.error &&
        completedRadarPolicy.data?.last_run_status === "succeeded" &&
        Boolean(completedRadarPolicy.data?.last_run_at),
      ownerRadarRuns.error?.message ??
        viewerForeignRadarRuns.error?.message ??
        completedRadarPolicy.error?.message ??
        null,
    );

    activeVerificationPhase = "supplier and finance authorization";
    const { data: alphaSupplier, error: alphaSupplierError } = await owner
      .from("suppliers")
      .insert({
        organization_id: organizationA.id,
        name: `Authorization supplier ${suffix}`,
        category: "hotel",
        preferred_currency: "INR",
        payment_terms_days: 14,
      })
      .select("id")
      .single();
    record(
      "authorized operations roles can create supplier profiles",
      !alphaSupplierError && Boolean(alphaSupplier?.id),
      alphaSupplierError?.message ?? null,
    );
    if (alphaSupplierError || !alphaSupplier)
      throw alphaSupplierError ?? new Error("Supplier fixture was not created.");

    const { data: betaSupplier, error: betaSupplierError } = await admin
      .from("suppliers")
      .insert({
        organization_id: organizationB.id,
        name: `Foreign supplier ${suffix}`,
        preferred_currency: "USD",
      })
      .select("id")
      .single();
    if (betaSupplierError || !betaSupplier)
      throw betaSupplierError ??
        new Error("Foreign supplier fixture was not created.");

    const ownerSupplierContact = await owner
      .from("supplier_contacts")
      .insert({
        organization_id: organizationA.id,
        supplier_id: alphaSupplier.id,
        name: "Authorization Supplier Contact",
        email: "supplier-contact@stateai.invalid",
        is_primary: true,
      })
      .select("id")
      .single();
    record(
      "authorized roles can add a same-tenant supplier contact",
      !ownerSupplierContact.error &&
        Boolean(ownerSupplierContact.data?.id),
      ownerSupplierContact.error?.message ?? null,
    );

    const foreignSupplierContact = await owner
      .from("supplier_contacts")
      .insert({
        organization_id: organizationA.id,
        supplier_id: betaSupplier.id,
        name: "Blocked foreign supplier contact",
        email: "blocked@stateai.invalid",
      });
    record(
      "database rejects a foreign-tenant supplier contact relationship",
      Boolean(foreignSupplierContact.error),
    );

    const ownerSupplierContract = await owner
      .from("supplier_contracts")
      .insert({
        organization_id: organizationA.id,
        supplier_id: alphaSupplier.id,
        title: "Authorization rate agreement",
        status: "active",
        starts_on: "2026-01-01",
        ends_on: "2027-01-01",
        currency: "INR",
        created_by: ownerUser.id,
      })
      .select("id")
      .single();
    record(
      "authorized roles can record same-tenant supplier terms",
      !ownerSupplierContract.error &&
        Boolean(ownerSupplierContract.data?.id),
      ownerSupplierContract.error?.message ?? null,
    );

    const viewerSupplierContract = await viewer
      .from("supplier_contracts")
      .insert({
        organization_id: organizationB.id,
        supplier_id: betaSupplier.id,
        title: "Blocked viewer contract",
        currency: "USD",
        created_by: viewerUser.id,
      });
    record(
      "viewer cannot record supplier contract terms",
      Boolean(viewerSupplierContract.error),
    );

    const directPaymentInsert = await owner.from("payments").insert({
      organization_id: organizationA.id,
      trip_id: firstConversion.data.id,
      supplier_id: alphaSupplier.id,
      direction: "payable",
      title: "Blocked direct payable",
      amount: 100,
      currency: "INR",
    });
    record(
      "browser clients cannot create payment obligations directly",
      Boolean(directPaymentInsert.error),
    );

    const foreignPaymentRelationship = await owner.rpc(
      "create_payment_obligation",
      {
        target_organization_id: organizationA.id,
        target_direction: "payable",
        target_title: "Blocked foreign supplier payable",
        target_amount: 100,
        target_currency: "INR",
        target_trip_id: firstConversion.data.id,
        target_supplier_id: betaSupplier.id,
      },
    );
    record(
      "database rejects a foreign-tenant supplier payment relationship",
      Boolean(foreignPaymentRelationship.error),
    );

    const dueYesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const governedPayment = await owner
      .rpc("create_payment_obligation", {
        target_organization_id: organizationA.id,
        target_direction: "payable",
        target_title: "Governed supplier deposit",
        target_amount: 1000,
        target_currency: "INR",
        target_due_at: dueYesterday,
        target_trip_id: firstConversion.data.id,
        target_supplier_id: alphaSupplier.id,
        target_invoice_number: `AUTHZ-${suffix}`,
      })
      .single();
    record(
      "finance role creates an overdue obligation through the guarded ledger",
      !governedPayment.error &&
        governedPayment.data?.status === "overdue" &&
        governedPayment.data?.created_by === ownerUser.id &&
        governedPayment.data?.paid_amount === 0,
      governedPayment.error?.message ?? null,
    );
    if (governedPayment.error || !governedPayment.data)
      throw governedPayment.error ??
        new Error("Governed payment fixture was not created.");

    const viewerForeignPayments = await viewer
      .from("payments")
      .select("id")
      .eq("id", governedPayment.data.id);
    record(
      "foreign tenant cannot read another workspace payment obligation",
      !viewerForeignPayments.error &&
        viewerForeignPayments.data?.length === 0,
    );

    const directPaymentMutation = await owner
      .from("payments")
      .update({ status: "paid", paid_amount: 1000 })
      .eq("id", governedPayment.data.id)
      .select("id");
    record(
      "browser clients cannot forge payment settlement state",
      Boolean(directPaymentMutation.error) ||
        directPaymentMutation.data?.length === 0,
    );

    const paymentRadarScan = await owner.rpc(
      "refresh_operational_exceptions",
      { target_organization_id: organizationA.id },
    );
    const paymentException = await owner
      .from("operational_exceptions")
      .select("id, status, severity, source_entity_id")
      .eq("organization_id", organizationA.id)
      .eq("exception_type", "payment_due")
      .eq("source_entity_id", governedPayment.data.id)
      .single();
    record(
      "Operations Radar detects a critical overdue payment obligation",
      !paymentRadarScan.error &&
        !paymentException.error &&
        paymentException.data?.status === "open" &&
        paymentException.data?.severity === "critical",
      paymentException.error?.message ?? paymentRadarScan.error?.message ?? null,
    );

    const partialSettlement = await owner
      .rpc("record_payment_allocation", {
        target_organization_id: organizationA.id,
        target_payment_id: governedPayment.data.id,
        target_amount: 400,
        target_occurred_at: new Date().toISOString(),
        target_reference: `AUTHZ-SETTLEMENT-${suffix}-1`,
      })
      .single();
    record(
      "finance role records immutable partial-settlement evidence",
      !partialSettlement.error &&
        partialSettlement.data?.status === "overdue" &&
        partialSettlement.data?.paid_amount === 400,
      partialSettlement.error?.message ?? null,
    );

    const excessiveSettlement = await owner.rpc(
      "record_payment_allocation",
      {
        target_organization_id: organizationA.id,
        target_payment_id: governedPayment.data.id,
        target_amount: 700,
        target_occurred_at: new Date().toISOString(),
        target_reference: `AUTHZ-SETTLEMENT-${suffix}-OVER`,
      },
    );
    record(
      "ledger rejects settlement beyond the outstanding balance",
      Boolean(excessiveSettlement.error),
    );

    const allocationMutation = await owner
      .from("payment_allocations")
      .update({ amount: 1 })
      .eq("payment_id", governedPayment.data.id)
      .select("id");
    record(
      "browser clients cannot rewrite settlement evidence",
      Boolean(allocationMutation.error) ||
        allocationMutation.data?.length === 0,
    );

    const finalSettlement = await owner
      .rpc("record_payment_allocation", {
        target_organization_id: organizationA.id,
        target_payment_id: governedPayment.data.id,
        target_amount: 600,
        target_occurred_at: new Date().toISOString(),
        target_reference: `AUTHZ-SETTLEMENT-${suffix}-2`,
      })
      .single();
    const settlementEvidence = await owner
      .from("payment_allocations")
      .select("amount, recorded_by")
      .eq("payment_id", governedPayment.data.id);
    record(
      "complete settlement reconciles the obligation with actor evidence",
      !finalSettlement.error &&
        finalSettlement.data?.status === "paid" &&
        finalSettlement.data?.paid_amount === 1000 &&
        Boolean(finalSettlement.data?.paid_at) &&
        !settlementEvidence.error &&
        settlementEvidence.data?.length === 2 &&
        settlementEvidence.data.every(
          (allocation) => allocation.recorded_by === ownerUser.id,
        ),
      finalSettlement.error?.message ?? settlementEvidence.error?.message ?? null,
    );

    await owner.rpc("refresh_operational_exceptions", {
      target_organization_id: organizationA.id,
    });
    const clearedPaymentException = await owner
      .from("operational_exceptions")
      .select("status, resolved_by, operator_note")
      .eq("id", paymentException.data?.id ?? randomUUID())
      .single();
    record(
      "Operations Radar auto-clears payment risk after reconciliation",
      !clearedPaymentException.error &&
        clearedPaymentException.data?.status === "resolved" &&
        clearedPaymentException.data?.resolved_by === null &&
        clearedPaymentException.data?.operator_note ===
          "Condition cleared by Operations Radar.",
      clearedPaymentException.error?.message ?? null,
    );

    const voidablePayment = await owner
      .rpc("create_payment_obligation", {
        target_organization_id: organizationA.id,
        target_direction: "receivable",
        target_title: "Voidable customer balance",
        target_amount: 250,
        target_currency: "INR",
        target_trip_id: firstConversion.data.id,
      })
      .single();
    if (voidablePayment.error || !voidablePayment.data)
      throw voidablePayment.error ??
        new Error("Voidable payment fixture was not created.");
    const missingVoidEvidence = await owner.rpc(
      "void_payment_obligation",
      {
        target_organization_id: organizationA.id,
        target_payment_id: voidablePayment.data.id,
        target_reason: " ",
      },
    );
    record(
      "voiding an obligation requires human evidence",
      Boolean(missingVoidEvidence.error),
    );
    const governedVoid = await owner
      .rpc("void_payment_obligation", {
        target_organization_id: organizationA.id,
        target_payment_id: voidablePayment.data.id,
        target_reason: "Duplicate internal obligation.",
      })
      .single();
    record(
      "finance role can void an unsettled obligation with actor evidence",
      !governedVoid.error &&
        governedVoid.data?.status === "void" &&
        governedVoid.data?.voided_by === ownerUser.id &&
        Boolean(governedVoid.data?.voided_at),
      governedVoid.error?.message ?? null,
    );

    activeVerificationPhase = "traveler portal authorization";
    const portalReceivable = await owner
      .rpc("create_payment_obligation", {
        target_organization_id: organizationA.id,
        target_direction: "receivable",
        target_title: "Traveler journey balance",
        target_amount: 5000,
        target_currency: "INR",
        target_trip_id: firstConversion.data.id,
      })
      .single();
    if (portalReceivable.error || !portalReceivable.data)
      throw portalReceivable.error ??
        new Error("Traveler portal receivable fixture was not created.");

    const portalExpiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const approvalExpiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const { data: portalApproval, error: portalApprovalError } = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        approver_id: ownerUser.id,
        action: "document.share",
        entity_type: "trip",
        entity_id: firstConversion.data.id,
        payload: {
          schema_version: 1,
          document_ids: [],
          include_payment_status: true,
          portal_expires_at: portalExpiresAt,
        },
        rationale: "Authorization traveler portal fixture.",
        expires_at: approvalExpiresAt,
      })
      .select("id")
      .single();
    if (portalApprovalError || !portalApproval)
      throw portalApprovalError ??
        new Error("Traveler portal approval fixture was not created.");

    const directPortalInsert = await owner.from("trip_portal_links").insert({
      organization_id: organizationA.id,
      trip_id: firstConversion.data.id,
      approval_request_id: portalApproval.id,
      token_hash: randomBytes(32).toString("hex"),
      snapshot: {},
      expires_at: portalExpiresAt,
    });
    record(
      "browser clients cannot publish traveler links directly",
      Boolean(directPortalInsert.error),
    );

    const pendingPortalPublish = await owner.rpc(
      "publish_traveler_portal",
      {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_approval_id: portalApproval.id,
        target_token_hash: randomBytes(32).toString("hex"),
      },
    );
    record(
      "traveler portal publishing requires a resolved human approval",
      Boolean(pendingPortalPublish.error),
    );

    const resolvedPortalApproval = await owner
      .rpc("resolve_approval_request", {
        target_organization_id: organizationA.id,
        target_approval_id: portalApproval.id,
        target_decision: "approved",
      })
      .single();
    record(
      "authorized human can approve the exact traveler portal scope",
      !resolvedPortalApproval.error &&
        resolvedPortalApproval.data?.resolved_status === "approved",
      resolvedPortalApproval.error?.message ?? null,
    );

    const blockedViewerPortalPublish = await viewer.rpc(
      "publish_traveler_portal",
      {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_approval_id: portalApproval.id,
        target_token_hash: randomBytes(32).toString("hex"),
      },
    );
    record(
      "foreign viewers cannot publish another workspace traveler portal",
      Boolean(blockedViewerPortalPublish.error),
    );

    const firstPortalTokenHash = randomBytes(32).toString("hex");
    const publishedPortal = await owner
      .rpc("publish_traveler_portal", {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_approval_id: portalApproval.id,
        target_token_hash: firstPortalTokenHash,
      })
      .single();
    record(
      "authorized operator publishes one expiring approved snapshot",
      !publishedPortal.error &&
        publishedPortal.data?.status === "active" &&
        publishedPortal.data?.created_by === ownerUser.id &&
        publishedPortal.data?.approved_by === ownerUser.id &&
        publishedPortal.data?.token_hash === firstPortalTokenHash,
      publishedPortal.error?.message ?? null,
    );
    if (publishedPortal.error || !publishedPortal.data)
      throw publishedPortal.error ??
        new Error("Traveler portal fixture was not published.");

    const [viewerPortalRead, publicSnapshot] = await Promise.all([
      viewer
        .from("trip_portal_links")
        .select("id")
        .eq("id", publishedPortal.data.id),
      admin.rpc("get_traveler_portal_snapshot", {
        target_token_hash: firstPortalTokenHash,
      }),
    ]);
    const snapshot =
      publicSnapshot.data &&
      typeof publicSnapshot.data === "object" &&
      !Array.isArray(publicSnapshot.data)
        ? publicSnapshot.data
        : null;
    record(
      "foreign tenants cannot inspect traveler portal metadata",
      !viewerPortalRead.error && viewerPortalRead.data?.length === 0,
    );
    record(
      "service-only snapshot excludes internal context and supplier payables",
      !publicSnapshot.error &&
        snapshot?.trip?.name === firstConversion.data.name &&
        snapshot?.operations_notes === undefined &&
        snapshot?.supplier_terms === undefined &&
        Array.isArray(snapshot?.receivables) &&
        snapshot.receivables.length === 1 &&
        snapshot.receivables[0].title === "Traveler journey balance" &&
        snapshot.receivables[0].direction === undefined &&
        Array.isArray(snapshot?.confirmed_services) &&
        snapshot.confirmed_services.some(
          (service) =>
            service.confirmation_reference === "AUTHZ-HOTEL-42",
        ),
      publicSnapshot.error?.message ?? null,
    );

    const directPortalMutation = await owner
      .from("trip_portal_links")
      .update({ status: "revoked" })
      .eq("id", publishedPortal.data.id)
      .select("id");
    record(
      "browser clients cannot bypass traveler portal lifecycle",
      Boolean(directPortalMutation.error) ||
        directPortalMutation.data?.length === 0,
    );

    const replacementPortalTokenHash = randomBytes(32).toString("hex");
    const rotatedPortal = await owner
      .rpc("publish_traveler_portal", {
        target_organization_id: organizationA.id,
        target_trip_id: firstConversion.data.id,
        target_approval_id: portalApproval.id,
        target_token_hash: replacementPortalTokenHash,
      })
      .single();
    const [oldSnapshot, replacementSnapshot] = await Promise.all([
      admin.rpc("get_traveler_portal_snapshot", {
        target_token_hash: firstPortalTokenHash,
      }),
      admin.rpc("get_traveler_portal_snapshot", {
        target_token_hash: replacementPortalTokenHash,
      }),
    ]);
    record(
      "replacement link rotation invalidates the earlier raw token",
      !rotatedPortal.error &&
        rotatedPortal.data?.id === publishedPortal.data.id &&
        oldSnapshot.data === null &&
        Boolean(replacementSnapshot.data),
      rotatedPortal.error?.message ?? oldSnapshot.error?.message ?? null,
    );

    const viewerPortalRevoke = await viewer.rpc(
      "revoke_traveler_portal",
      {
        target_organization_id: organizationA.id,
        target_portal_link_id: publishedPortal.data.id,
        target_note: "Blocked foreign revocation.",
      },
    );
    record(
      "foreign viewers cannot revoke another workspace traveler portal",
      Boolean(viewerPortalRevoke.error),
    );

    const missingRevocationEvidence = await owner.rpc(
      "revoke_traveler_portal",
      {
        target_organization_id: organizationA.id,
        target_portal_link_id: publishedPortal.data.id,
        target_note: " ",
      },
    );
    record(
      "traveler portal revocation requires human evidence",
      Boolean(missingRevocationEvidence.error),
    );

    const revokedPortal = await owner
      .rpc("revoke_traveler_portal", {
        target_organization_id: organizationA.id,
        target_portal_link_id: publishedPortal.data.id,
        target_note: "Authorization access window closed.",
      })
      .single();
    const revokedSnapshot = await admin.rpc(
      "get_traveler_portal_snapshot",
      { target_token_hash: replacementPortalTokenHash },
    );
    record(
      "authorized operator revokes traveler access immediately",
      !revokedPortal.error &&
        revokedPortal.data?.status === "revoked" &&
        revokedPortal.data?.revoked_by === ownerUser.id &&
        Boolean(revokedPortal.data?.revoked_at) &&
        revokedSnapshot.data === null,
      revokedPortal.error?.message ?? revokedSnapshot.error?.message ?? null,
    );

    const [ownerTripHistory, viewerForeignTrip, viewerTripHistory] =
      await Promise.all([
        owner
          .from("trip_status_history")
          .select("from_status, to_status")
          .eq("trip_id", firstConversion.data.id),
        viewer
          .from("trips")
          .select("id")
          .eq("id", firstConversion.data.id),
        viewer
          .from("trip_status_history")
          .select("id")
          .eq("trip_id", firstConversion.data.id),
      ]);
    record(
      "trip lifecycle preserves append-only status history",
      !ownerTripHistory.error &&
        ownerTripHistory.data?.length === 2 &&
        ownerTripHistory.data.some(
          (item) =>
            item.from_status === "confirmed" && item.to_status === "in_travel",
        ),
      ownerTripHistory.error?.message ?? null,
    );
    record(
      "foreign tenants cannot read operational trips or their history",
      !viewerForeignTrip.error &&
        viewerForeignTrip.data?.length === 0 &&
        !viewerTripHistory.error &&
        viewerTripHistory.data?.length === 0,
    );

    const viewerTripConversion = await viewer.rpc(
      "convert_won_deal_to_trip",
      {
        target_organization_id: organizationA.id,
        target_deal_id: tripDeal.id,
      },
    );
    record(
      "foreign viewers cannot convert another tenant's won deal",
      Boolean(viewerTripConversion.error),
    );

    const forgedTripDocumentId = randomUUID();
    const forgedTripDocument = await owner.rpc("record_trip_document", {
      target_organization_id: organizationA.id,
      target_trip_id: firstConversion.data.id,
      target_document_id: forgedTripDocumentId,
      target_storage_path: `${organizationA.id}/${forgedTripDocumentId}/missing.pdf`,
      target_file_name: "missing.pdf",
      target_mime_type: "application/pdf",
      target_byte_size: 10,
      target_expires_at: "2027-01-01",
    });
    record(
      "trip document metadata cannot be forged without a private object",
      Boolean(forgedTripDocument.error),
    );

    activeVerificationPhase = "governed knowledge authorization";
    const knowledgeReviewDueOn = new Date(
      Date.now() + 365 * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const directKnowledgeInsert = await owner.from("knowledge_sources").insert({
      organization_id: organizationA.id,
      title: `Bypass knowledge ${suffix}`,
      source_kind: "sop",
      authority: "internal",
      sensitivity: "normal",
      version_label: "1",
      review_due_on: knowledgeReviewDueOn,
      created_by: ownerUser.id,
    });
    record(
      "browser clients cannot bypass guarded knowledge creation",
      Boolean(directKnowledgeInsert.error),
    );

    const governedKnowledgeSource = await owner
      .rpc("upsert_knowledge_source", {
        target_organization_id: organizationA.id,
        target_title: `Kyoto rail policy ${suffix}`,
        target_source_kind: "destination_guide",
        target_authority: "official",
        target_sensitivity: "normal",
        target_version_label: "2026.1",
        target_source_url: "https://example.com/kyoto-rail-policy",
        target_summary: "Human-curated cancellation guidance.",
        target_review_due_on: knowledgeReviewDueOn,
      })
      .single();
    record(
      "authorized curators create versioned knowledge as a draft",
      !governedKnowledgeSource.error &&
        governedKnowledgeSource.data?.status === "draft" &&
        governedKnowledgeSource.data?.created_by === ownerUser.id,
      governedKnowledgeSource.error?.message ?? null,
    );
    if (governedKnowledgeSource.error || !governedKnowledgeSource.data)
      throw governedKnowledgeSource.error ??
        new Error("Governed knowledge fixture was not created.");

    const governedKnowledgeSection = await owner
      .rpc("add_knowledge_section", {
        target_organization_id: organizationA.id,
        target_source_id: governedKnowledgeSource.data.id,
        target_heading: "Cancellation windows",
        target_content:
          "Kyoto rail cancellation windows require operator review before any traveller-facing commitment.",
        target_citation_label: "Kyoto rail policy §4",
        target_position: 0,
      })
      .single();
    record(
      "authorized curators add citation-ready evidence to a draft",
      !governedKnowledgeSection.error &&
        governedKnowledgeSection.data?.source_id ===
          governedKnowledgeSource.data.id,
      governedKnowledgeSection.error?.message ?? null,
    );

    const directKnowledgeMutation = await owner
      .from("knowledge_sources")
      .update({ status: "approved" })
      .eq("id", governedKnowledgeSource.data.id)
      .select("id");
    record(
      "browser clients cannot approve knowledge with a direct write",
      Boolean(directKnowledgeMutation.error) ||
        directKnowledgeMutation.data?.length === 0,
    );

    const submittedKnowledge = await owner
      .rpc("transition_knowledge_source", {
        target_organization_id: organizationA.id,
        target_source_id: governedKnowledgeSource.data.id,
        target_status: "in_review",
      })
      .single();
    record(
      "curators explicitly submit knowledge for human review",
      !submittedKnowledge.error &&
        submittedKnowledge.data?.status === "in_review",
      submittedKnowledge.error?.message ?? null,
    );

    const inReviewMutation = await owner.rpc("add_knowledge_section", {
      target_organization_id: organizationA.id,
      target_source_id: governedKnowledgeSource.data.id,
      target_heading: "Late review mutation",
      target_content: "This passage must not enter an active review.",
      target_citation_label: "Blocked late citation",
      target_position: 1,
    });
    record(
      "in-review evidence is frozen until a curator returns it to draft",
      Boolean(inReviewMutation.error),
    );

    const { error: temporaryViewerMembershipError } = await admin
      .from("memberships")
      .insert({
        organization_id: organizationA.id,
        user_id: viewerUser.id,
        role: "viewer",
        status: "active",
      });
    if (temporaryViewerMembershipError) throw temporaryViewerMembershipError;

    const [viewerDraftRead, viewerDraftSearch, viewerApprovalAttempt] =
      await Promise.all([
        viewer
          .from("knowledge_sources")
          .select("id")
          .eq("id", governedKnowledgeSource.data.id),
        viewer.rpc("search_approved_knowledge", {
          target_organization_id: organizationA.id,
          target_query: "cancellation windows",
          target_limit: 8,
        }),
        viewer.rpc("transition_knowledge_source", {
          target_organization_id: organizationA.id,
          target_source_id: governedKnowledgeSource.data.id,
          target_status: "approved",
        }),
      ]);
    record(
      "ordinary members cannot read drafts or retrieve them through AIOS search",
      !viewerDraftRead.error &&
        viewerDraftRead.data?.length === 0 &&
        !viewerDraftSearch.error &&
        viewerDraftSearch.data?.length === 0,
      viewerDraftRead.error?.message ?? viewerDraftSearch.error?.message ?? null,
    );
    record(
      "ordinary members cannot approve knowledge",
      Boolean(viewerApprovalAttempt.error),
    );

    const approvedKnowledge = await owner
      .rpc("transition_knowledge_source", {
        target_organization_id: organizationA.id,
        target_source_id: governedKnowledgeSource.data.id,
        target_status: "approved",
      })
      .single();
    record(
      "authorized human approval records reviewer and review time",
      !approvedKnowledge.error &&
        approvedKnowledge.data?.status === "approved" &&
        approvedKnowledge.data?.reviewed_by === ownerUser.id &&
        Boolean(approvedKnowledge.data?.reviewed_at),
      approvedKnowledge.error?.message ?? null,
    );

    const [viewerApprovedRead, viewerApprovedSections, viewerCitedSearch] =
      await Promise.all([
        viewer
          .from("knowledge_sources")
          .select("id, status, sensitivity")
          .eq("id", governedKnowledgeSource.data.id),
        viewer
          .from("knowledge_sections")
          .select("id, citation_label")
          .eq("source_id", governedKnowledgeSource.data.id),
        viewer.rpc("search_approved_knowledge", {
          target_organization_id: organizationA.id,
          target_query: "cancellation windows",
          target_limit: 8,
        }),
      ]);
    record(
      "ordinary members read approved normal sources and their sections",
      !viewerApprovedRead.error &&
        viewerApprovedRead.data?.length === 1 &&
        !viewerApprovedSections.error &&
        viewerApprovedSections.data?.length === 1,
      viewerApprovedRead.error?.message ??
        viewerApprovedSections.error?.message ??
        null,
    );
    record(
      "approved retrieval returns a source-linked citation and freshness state",
      !viewerCitedSearch.error &&
        viewerCitedSearch.data?.length === 1 &&
        viewerCitedSearch.data[0].source_id ===
          governedKnowledgeSource.data.id &&
        viewerCitedSearch.data[0].citation_label ===
          "Kyoto rail policy §4" &&
        viewerCitedSearch.data[0].is_stale === false,
      viewerCitedSearch.error?.message ?? null,
    );

    const restrictedKnowledge = await owner
      .rpc("upsert_knowledge_source", {
        target_organization_id: organizationA.id,
        target_title: `Supplier allotment ${suffix}`,
        target_source_kind: "supplier_terms",
        target_authority: "supplier",
        target_sensitivity: "restricted",
        target_version_label: "2026.1",
        target_review_due_on: knowledgeReviewDueOn,
      })
      .single();
    if (restrictedKnowledge.error || !restrictedKnowledge.data)
      throw restrictedKnowledge.error ??
        new Error("Restricted knowledge fixture was not created.");
    const restrictedSection = await owner.rpc("add_knowledge_section", {
      target_organization_id: organizationA.id,
      target_source_id: restrictedKnowledge.data.id,
      target_heading: "Confidential allotment",
      target_content:
        "Secret supplier allotment details are restricted to curators.",
      target_citation_label: "Supplier allotment §1",
      target_position: 0,
    });
    if (restrictedSection.error) throw restrictedSection.error;
    const restrictedReview = await owner.rpc("transition_knowledge_source", {
      target_organization_id: organizationA.id,
      target_source_id: restrictedKnowledge.data.id,
      target_status: "in_review",
    });
    if (restrictedReview.error) throw restrictedReview.error;
    const restrictedApproval = await owner.rpc(
      "transition_knowledge_source",
      {
        target_organization_id: organizationA.id,
        target_source_id: restrictedKnowledge.data.id,
        target_status: "approved",
      },
    );
    if (restrictedApproval.error) throw restrictedApproval.error;
    const [viewerRestrictedRead, viewerRestrictedSearch, ownerRestrictedSearch] =
      await Promise.all([
        viewer
          .from("knowledge_sources")
          .select("id")
          .eq("id", restrictedKnowledge.data.id),
        viewer.rpc("search_approved_knowledge", {
          target_organization_id: organizationA.id,
          target_query: "secret supplier allotment",
          target_limit: 8,
        }),
        owner.rpc("search_approved_knowledge", {
          target_organization_id: organizationA.id,
          target_query: "secret supplier allotment",
          target_limit: 8,
        }),
      ]);
    record(
      "restricted knowledge is excluded from ordinary member reads and search",
      !viewerRestrictedRead.error &&
        viewerRestrictedRead.data?.length === 0 &&
        !viewerRestrictedSearch.error &&
        viewerRestrictedSearch.data?.length === 0 &&
        !ownerRestrictedSearch.error &&
        ownerRestrictedSearch.data?.length === 1,
      viewerRestrictedRead.error?.message ??
        viewerRestrictedSearch.error?.message ??
        ownerRestrictedSearch.error?.message ??
        null,
    );

    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const staleKnowledgeUpdate = await admin
      .from("knowledge_sources")
      .update({ review_due_on: yesterday })
      .eq("id", governedKnowledgeSource.data.id);
    if (staleKnowledgeUpdate.error) throw staleKnowledgeUpdate.error;
    const staleKnowledgeSearch = await viewer.rpc(
      "search_approved_knowledge",
      {
        target_organization_id: organizationA.id,
        target_query: "cancellation windows",
        target_limit: 8,
      },
    );
    record(
      "retrieval exposes expired review freshness instead of hiding it",
      !staleKnowledgeSearch.error &&
        staleKnowledgeSearch.data?.length === 1 &&
        staleKnowledgeSearch.data[0].is_stale === true,
      staleKnowledgeSearch.error?.message ?? null,
    );

    const viewerRenewalAttempt = await viewer.rpc("renew_knowledge_source", {
      target_organization_id: organizationA.id,
      target_source_id: governedKnowledgeSource.data.id,
      target_version_label: "2026.2",
      target_review_due_on: knowledgeReviewDueOn,
      target_valid_from: new Date().toISOString().slice(0, 10),
    });
    record(
      "ordinary members cannot prepare replacement knowledge",
      Boolean(viewerRenewalAttempt.error),
    );

    const renewedKnowledge = await owner
      .rpc("renew_knowledge_source", {
        target_organization_id: organizationA.id,
        target_source_id: governedKnowledgeSource.data.id,
        target_version_label: "2026.2",
        target_review_due_on: knowledgeReviewDueOn,
        target_valid_from: new Date().toISOString().slice(0, 10),
      })
      .single();
    record(
      "curators prepare an immutable successor draft with lineage",
      !renewedKnowledge.error &&
        renewedKnowledge.data?.status === "draft" &&
        renewedKnowledge.data?.version_label === "2026.2" &&
        renewedKnowledge.data?.supersedes_source_id ===
          governedKnowledgeSource.data.id,
      renewedKnowledge.error?.message ?? null,
    );
    if (renewedKnowledge.error || !renewedKnowledge.data)
      throw renewedKnowledge.error ??
        new Error("Renewed knowledge fixture was not created.");

    const [clonedKnowledgeSections, duplicateRenewal, draftSafeSearch] =
      await Promise.all([
        owner
          .from("knowledge_sections")
          .select("id, heading, citation_label, position")
          .eq("source_id", renewedKnowledge.data.id),
        owner.rpc("renew_knowledge_source", {
          target_organization_id: organizationA.id,
          target_source_id: governedKnowledgeSource.data.id,
          target_version_label: "2026.3",
          target_review_due_on: knowledgeReviewDueOn,
          target_valid_from: new Date().toISOString().slice(0, 10),
        }),
        viewer.rpc("search_approved_knowledge", {
          target_organization_id: organizationA.id,
          target_query: "cancellation windows",
          target_limit: 8,
        }),
      ]);
    record(
      "replacement drafts clone citation-ready passages without a retrieval gap",
      !clonedKnowledgeSections.error &&
        clonedKnowledgeSections.data?.length === 1 &&
        !draftSafeSearch.error &&
        draftSafeSearch.data?.length === 1 &&
        draftSafeSearch.data[0].source_id === governedKnowledgeSource.data.id,
      clonedKnowledgeSections.error?.message ??
        draftSafeSearch.error?.message ??
        null,
    );
    record(
      "one source cannot accumulate competing active successors",
      Boolean(duplicateRenewal.error),
    );

    const revisedKnowledgeSection = await owner
      .rpc("update_knowledge_section", {
        target_organization_id: organizationA.id,
        target_source_id: renewedKnowledge.data.id,
        target_section_id: clonedKnowledgeSections.data[0].id,
        target_heading: "Revised cancellation windows",
        target_content:
          "The Kyoto rail policy requires operator confirmation 48 hours before any traveller-facing commitment.",
        target_citation_label: "Kyoto rail policy §5",
        target_position: 0,
      })
      .single();
    record(
      "curators revise cloned passages only inside the replacement draft",
      !revisedKnowledgeSection.error &&
        revisedKnowledgeSection.data?.heading ===
          "Revised cancellation windows" &&
        revisedKnowledgeSection.data?.citation_label ===
          "Kyoto rail policy §5",
      revisedKnowledgeSection.error?.message ?? null,
    );

    const temporaryRenewalSection = await owner
      .rpc("add_knowledge_section", {
        target_organization_id: organizationA.id,
        target_source_id: renewedKnowledge.data.id,
        target_heading: "Temporary passage",
        target_content: "This draft-only passage will be removed.",
        target_citation_label: "Temporary citation",
        target_position: 1,
      })
      .single();
    if (temporaryRenewalSection.error || !temporaryRenewalSection.data)
      throw temporaryRenewalSection.error ??
        new Error("Temporary renewal passage was not created.");
    const removedRenewalSection = await owner.rpc(
      "delete_knowledge_section",
      {
        target_organization_id: organizationA.id,
        target_source_id: renewedKnowledge.data.id,
        target_section_id: temporaryRenewalSection.data.id,
      },
    );
    record(
      "curators remove obsolete passages before replacement review",
      !removedRenewalSection.error && removedRenewalSection.data === true,
      removedRenewalSection.error?.message ?? null,
    );

    const replacementReview = await owner.rpc(
      "transition_knowledge_source",
      {
        target_organization_id: organizationA.id,
        target_source_id: renewedKnowledge.data.id,
        target_status: "in_review",
      },
    );
    if (replacementReview.error) throw replacementReview.error;
    const frozenReplacementRevision = await owner.rpc(
      "update_knowledge_section",
      {
        target_organization_id: organizationA.id,
        target_source_id: renewedKnowledge.data.id,
        target_section_id: clonedKnowledgeSections.data[0].id,
        target_heading: "Late replacement change",
        target_content: "This must remain blocked during review.",
        target_citation_label: "Blocked replacement citation",
        target_position: 0,
      },
    );
    record(
      "replacement passages freeze during human review",
      Boolean(frozenReplacementRevision.error),
    );

    const approvedReplacement = await owner
      .rpc("transition_knowledge_source", {
        target_organization_id: organizationA.id,
        target_source_id: renewedKnowledge.data.id,
        target_status: "approved",
      })
      .single();
    const [replacementStates, replacementSearch] = await Promise.all([
      owner
        .from("knowledge_sources")
        .select("id, status, retired_at")
        .in("id", [
          governedKnowledgeSource.data.id,
          renewedKnowledge.data.id,
        ]),
      viewer.rpc(
      "search_approved_knowledge",
      {
        target_organization_id: organizationA.id,
        target_query: "cancellation windows",
        target_limit: 8,
      },
      ),
    ]);
    const originalState = replacementStates.data?.find(
      (source) => source.id === governedKnowledgeSource.data.id,
    );
    const successorState = replacementStates.data?.find(
      (source) => source.id === renewedKnowledge.data.id,
    );
    record(
      "human approval atomically retires the old source and activates its successor",
      !approvedReplacement.error &&
        approvedReplacement.data?.status === "approved" &&
        !replacementStates.error &&
        originalState?.status === "retired" &&
        Boolean(originalState?.retired_at) &&
        successorState?.status === "approved" &&
        !replacementSearch.error &&
        replacementSearch.data?.length === 1 &&
        replacementSearch.data[0].source_id === renewedKnowledge.data.id &&
        replacementSearch.data[0].version_label === "2026.2" &&
        replacementSearch.data[0].citation_label === "Kyoto rail policy §5",
      approvedReplacement.error?.message ??
        replacementStates.error?.message ??
        replacementSearch.error?.message ??
        null,
    );

    const [knowledgeAudit, renewalAudit] = await Promise.all([
      owner
      .from("audit_events")
      .select("event_type")
      .eq("entity_id", governedKnowledgeSource.data.id)
        .order("created_at"),
      owner
        .from("audit_events")
        .select("event_type")
        .eq("entity_id", renewedKnowledge.data.id)
        .order("created_at"),
    ]);
    record(
      "knowledge lifecycle and renewal decisions preserve an audit trail",
      !knowledgeAudit.error &&
        !renewalAudit.error &&
        knowledgeAudit.data?.some(
          (event) => event.event_type === "knowledge.source.created",
        ) &&
        knowledgeAudit.data?.filter(
          (event) => event.event_type === "knowledge.source.transitioned",
        ).length === 3 &&
        renewalAudit.data?.some(
          (event) => event.event_type === "knowledge.source.renewal_started",
        ) &&
        renewalAudit.data?.some(
          (event) => event.event_type === "knowledge.source.transitioned",
        ),
      knowledgeAudit.error?.message ?? renewalAudit.error?.message ?? null,
    );

    activeVerificationPhase = "knowledge conflict authorization";
    const competingKnowledgeSource = await owner
      .rpc("upsert_knowledge_source", {
        target_organization_id: organizationA.id,
        target_title: `Kyoto rail supplier bulletin ${suffix}`,
        target_source_kind: "destination_guide",
        target_authority: "supplier",
        target_sensitivity: "normal",
        target_version_label: "2026.1",
        target_source_url: "https://example.com/kyoto-rail-supplier-bulletin",
        target_summary: "Competing cancellation timing for human review.",
        target_review_due_on: knowledgeReviewDueOn,
      })
      .single();
    if (competingKnowledgeSource.error || !competingKnowledgeSource.data)
      throw competingKnowledgeSource.error ??
        new Error("Competing knowledge fixture was not created.");
    const competingKnowledgeSection = await owner
      .rpc("add_knowledge_section", {
        target_organization_id: organizationA.id,
        target_source_id: competingKnowledgeSource.data.id,
        target_heading: "Revised cancellation windows",
        target_content:
          "The supplier bulletin requires operator confirmation 72 hours before any traveller-facing commitment.",
        target_citation_label: "Kyoto supplier bulletin Â§2",
        target_position: 0,
      })
      .single();
    if (competingKnowledgeSection.error || !competingKnowledgeSection.data)
      throw competingKnowledgeSection.error ??
        new Error("Competing knowledge passage was not created.");
    const competingReview = await owner.rpc("transition_knowledge_source", {
      target_organization_id: organizationA.id,
      target_source_id: competingKnowledgeSource.data.id,
      target_status: "in_review",
    });
    if (competingReview.error) throw competingReview.error;
    const competingApproval = await owner.rpc("transition_knowledge_source", {
      target_organization_id: organizationA.id,
      target_source_id: competingKnowledgeSource.data.id,
      target_status: "approved",
    });
    if (competingApproval.error) throw competingApproval.error;

    const directConflictInsert = await owner.from("knowledge_conflicts").insert({
      organization_id: organizationA.id,
      left_section_id: clonedKnowledgeSections.data[0].id,
      right_section_id: competingKnowledgeSection.data.id,
      signal: {
        reason: "factual_token_mismatch",
        source_kind: "destination_guide",
        normalized_heading: "revised cancellation windows",
        left_tokens: ["48"],
        right_tokens: ["72"],
      },
    });
    record(
      "browser clients cannot create knowledge conflicts directly",
      Boolean(directConflictInsert.error),
    );

    const [
      viewerConflictScan,
      ownerForeignConflictScan,
      detectedConflicts,
    ] = await Promise.all([
      viewer.rpc("scan_knowledge_conflicts", {
        target_organization_id: organizationA.id,
      }),
      owner.rpc("scan_knowledge_conflicts", {
        target_organization_id: organizationB.id,
      }),
      owner.rpc("scan_knowledge_conflicts", {
        target_organization_id: organizationA.id,
      }),
    ]);
    const detectedConflict = detectedConflicts.data?.find(
      (conflict) =>
        conflict.status === "open" &&
        [conflict.left_section_id, conflict.right_section_id].includes(
          clonedKnowledgeSections.data[0].id,
        ) &&
        [conflict.left_section_id, conflict.right_section_id].includes(
          competingKnowledgeSection.data.id,
        ),
    );
    record(
      "ordinary members cannot scan knowledge conflicts",
      Boolean(viewerConflictScan.error),
    );
    record(
      "curators cannot scan a foreign tenant for conflicts",
      Boolean(ownerForeignConflictScan.error),
    );
    record(
      "deterministic conflict scan preserves both competing citations",
      !detectedConflicts.error &&
        Boolean(detectedConflict) &&
        detectedConflict.signal?.left_tokens?.length === 1 &&
        detectedConflict.signal?.right_tokens?.length === 1,
      detectedConflicts.error?.message ?? null,
    );
    if (!detectedConflict)
      throw new Error("Knowledge conflict was not detected.");

    const [viewerConflictRead, directConflictUpdate, viewerConflictReview] =
      await Promise.all([
        viewer
          .from("knowledge_conflicts")
          .select("id")
          .eq("organization_id", organizationA.id),
        owner
          .from("knowledge_conflicts")
          .update({ status: "dismissed" })
          .eq("id", detectedConflict.id),
        viewer.rpc("review_knowledge_conflict", {
          target_organization_id: organizationA.id,
          target_conflict_id: detectedConflict.id,
          target_status: "dismissed",
          target_resolution_note: "Blocked ordinary-member review.",
        }),
      ]);
    record(
      "ordinary members cannot read curator conflict evidence",
      !viewerConflictRead.error && viewerConflictRead.data?.length === 0,
      viewerConflictRead.error?.message ?? null,
    );
    record(
      "browser clients cannot bypass conflict review with a direct update",
      Boolean(directConflictUpdate.error) ||
        directConflictUpdate.data?.length === 0,
    );
    record(
      "ordinary members cannot decide a knowledge conflict",
      Boolean(viewerConflictReview.error),
    );

    const confirmedConflict = await owner
      .rpc("review_knowledge_conflict", {
        target_organization_id: organizationA.id,
        target_conflict_id: detectedConflict.id,
        target_status: "confirmed",
        target_resolution_note:
          "Official policy says 48 hours while the supplier bulletin says 72 hours.",
      })
      .single();
    record(
      "human conflict confirmation records reviewer evidence",
      !confirmedConflict.error &&
        confirmedConflict.data?.status === "confirmed" &&
        confirmedConflict.data?.reviewed_by === ownerUser.id &&
        Boolean(confirmedConflict.data?.reviewed_at),
      confirmedConflict.error?.message ?? null,
    );

    const retiredCompetingSource = await owner.rpc(
      "transition_knowledge_source",
      {
        target_organization_id: organizationA.id,
        target_source_id: competingKnowledgeSource.data.id,
        target_status: "retired",
      },
    );
    if (retiredCompetingSource.error) throw retiredCompetingSource.error;
    const rescannedConflicts = await owner.rpc("scan_knowledge_conflicts", {
      target_organization_id: organizationA.id,
    });
    const resolvedConflict = rescannedConflicts.data?.find(
      (conflict) => conflict.id === detectedConflict.id,
    );
    record(
      "conflicts resolve only after competing evidence leaves current retrieval",
      !rescannedConflicts.error &&
        resolvedConflict?.status === "resolved" &&
        resolvedConflict.resolution_note?.includes("no longer current"),
      rescannedConflicts.error?.message ?? null,
    );

    const conflictAudit = await owner
      .from("audit_events")
      .select("event_type")
      .eq("entity_id", detectedConflict.id);
    record(
      "knowledge conflict decisions preserve an audit trail",
      !conflictAudit.error &&
        conflictAudit.data?.some(
          (event) => event.event_type === "knowledge.conflict.reviewed",
        ),
      conflictAudit.error?.message ?? null,
    );

    activeVerificationPhase = "knowledge text import authorization";
    const importedFileHash = "a".repeat(64);
    const importedSections = [
      {
        heading: "Arrival support",
        content:
          "Meet the traveller at the signed airport desk and verify the service reference.",
        citation_label: "Airport playbook · airport-ops.md · passage 1",
        position: 0,
      },
      {
        heading: "Escalation",
        content:
          "Escalate a missing confirmed service to the duty operator.",
        citation_label: "Airport playbook · airport-ops.md · passage 2",
        position: 1,
      },
    ];
    const [viewerTextImport, ownerForeignTextImport] = await Promise.all([
      viewer.rpc("import_knowledge_text_source", {
        target_organization_id: organizationA.id,
        target_title: `Blocked viewer import ${suffix}`,
        target_source_kind: "sop",
        target_authority: "internal",
        target_sensitivity: "restricted",
        target_version_label: "1",
        target_file_name: "blocked-viewer.md",
        target_file_sha256: "b".repeat(64),
        target_byte_size: 100,
        target_sections: importedSections,
      }),
      owner.rpc("import_knowledge_text_source", {
        target_organization_id: organizationB.id,
        target_title: `Blocked foreign import ${suffix}`,
        target_source_kind: "sop",
        target_authority: "internal",
        target_sensitivity: "restricted",
        target_version_label: "1",
        target_file_name: "blocked-foreign.md",
        target_file_sha256: "c".repeat(64),
        target_byte_size: 100,
        target_sections: importedSections,
      }),
    ]);
    record(
      "ordinary members cannot import private knowledge files",
      Boolean(viewerTextImport.error),
    );
    record(
      "curators cannot import knowledge into a foreign tenant",
      Boolean(ownerForeignTextImport.error),
    );

    const importedKnowledgeSource = await owner
      .rpc("import_knowledge_text_source", {
        target_organization_id: organizationA.id,
        target_title: `Airport operating playbook ${suffix}`,
        target_source_kind: "sop",
        target_authority: "internal",
        target_sensitivity: "restricted",
        target_version_label: "1",
        target_file_name: "airport-ops.md",
        target_file_sha256: importedFileHash,
        target_byte_size: 180,
        target_sections: importedSections,
        target_summary: "Private server-chunked operating procedure.",
        target_review_due_on: knowledgeReviewDueOn,
      })
      .single();
    record(
      "authorized text import creates one provenance-backed draft",
      !importedKnowledgeSource.error &&
        importedKnowledgeSource.data?.status === "draft" &&
        importedKnowledgeSource.data?.ingestion_method === "text_file" &&
        importedKnowledgeSource.data?.ingested_file_name ===
          "airport-ops.md" &&
        importedKnowledgeSource.data?.ingested_file_sha256 ===
          importedFileHash,
      importedKnowledgeSource.error?.message ?? null,
    );
    if (importedKnowledgeSource.error || !importedKnowledgeSource.data)
      throw importedKnowledgeSource.error ??
        new Error("Text-imported knowledge fixture was not created.");

    const [importedPassages, viewerImportedRead, viewerImportedSearch] =
      await Promise.all([
        owner
          .from("knowledge_sections")
          .select("heading, citation_label, position")
          .eq("source_id", importedKnowledgeSource.data.id)
          .order("position"),
        viewer
          .from("knowledge_sources")
          .select("id")
          .eq("id", importedKnowledgeSource.data.id),
        viewer.rpc("search_approved_knowledge", {
          target_organization_id: organizationA.id,
          target_query: "signed airport desk duty operator",
          target_limit: 8,
        }),
      ]);
    record(
      "text import atomically creates ordered citation-ready passages",
      !importedPassages.error &&
        importedPassages.data?.length === 2 &&
        importedPassages.data[0].heading === "Arrival support" &&
        importedPassages.data[1].position === 1,
      importedPassages.error?.message ?? null,
    );
    record(
      "imported drafts stay outside ordinary reads and AIOS retrieval",
      !viewerImportedRead.error &&
        viewerImportedRead.data?.length === 0 &&
        !viewerImportedSearch.error &&
        viewerImportedSearch.data?.length === 0,
      viewerImportedRead.error?.message ??
        viewerImportedSearch.error?.message ??
        null,
    );

    const duplicateFileImport = await owner.rpc(
      "import_knowledge_text_source",
      {
        target_organization_id: organizationA.id,
        target_title: `Duplicate airport playbook ${suffix}`,
        target_source_kind: "sop",
        target_authority: "internal",
        target_sensitivity: "restricted",
        target_version_label: "1",
        target_file_name: "airport-ops-copy.md",
        target_file_sha256: importedFileHash,
        target_byte_size: 180,
        target_sections: importedSections,
      },
    );
    record(
      "active knowledge cannot import the same private file twice",
      Boolean(duplicateFileImport.error),
    );

    const importedKnowledgeAudit = await owner
      .from("audit_events")
      .select("event_type, metadata")
      .eq("entity_id", importedKnowledgeSource.data.id);
    record(
      "text import preserves file and chunk provenance in the audit trail",
      !importedKnowledgeAudit.error &&
        importedKnowledgeAudit.data?.some(
          (event) =>
            event.event_type === "knowledge.source.text_imported" &&
            event.metadata?.section_count === 2 &&
            event.metadata?.file_sha256 === importedFileHash,
        ),
      importedKnowledgeAudit.error?.message ?? null,
    );

    const { error: temporaryViewerMembershipDeleteError } = await admin
      .from("memberships")
      .delete()
      .eq("organization_id", organizationA.id)
      .eq("user_id", viewerUser.id);
    if (temporaryViewerMembershipDeleteError)
      throw temporaryViewerMembershipDeleteError;

    activeVerificationPhase = "sales workflow authorization";
    const qualificationTemplate = await owner
      .rpc("create_qualification_checklist_template", {
        target_organization_id: organizationA.id,
        target_name: `Qualification ${suffix}`,
        target_description: "Authorization qualification fixture",
        target_items: [
          {
            label: "Confirm travel dates",
            guidance: "Record flexibility",
            required: true,
          },
          {
            label: "Record visa support preference",
            guidance: null,
            required: false,
          },
        ],
      })
      .single();
    record(
      "authorized owner can create an atomic qualification template",
      !qualificationTemplate.error &&
        Boolean(qualificationTemplate.data?.id),
      qualificationTemplate.error?.message ?? null,
    );
    if (qualificationTemplate.error || !qualificationTemplate.data)
      throw (
        qualificationTemplate.error ??
        new Error("Qualification template fixture was not created.")
      );

    const viewerQualificationTemplate = await viewer.rpc(
      "create_qualification_checklist_template",
      {
        target_organization_id: organizationB.id,
        target_name: `Blocked qualification ${suffix}`,
        target_description: "",
        target_items: [
          {
            label: "Viewer must not create this",
            guidance: null,
            required: true,
          },
        ],
      },
    );
    record(
      "viewer cannot create qualification templates",
      Boolean(viewerQualificationTemplate.error),
    );

    const appliedQualification = await owner.rpc(
      "apply_qualification_checklist",
      {
        target_organization_id: organizationA.id,
        target_deal_id: governedDeal.id,
        target_template_id: qualificationTemplate.data.id,
      },
    );
    record(
      "authorized owner can instantiate reusable qualification evidence",
      !appliedQualification.error && appliedQualification.data === 2,
      appliedQualification.error?.message ??
        JSON.stringify({ data: appliedQualification.data ?? null }),
    );

    const { data: qualificationChecks, error: qualificationChecksError } =
      await owner
        .from("deal_qualification_checks")
        .select("id, is_required, is_complete")
        .eq("deal_id", governedDeal.id);
    if (qualificationChecksError || qualificationChecks?.length !== 2)
      throw (
        qualificationChecksError ??
        new Error("Qualification checks were not instantiated.")
      );
    const requiredCheck = qualificationChecks.find(
      (check) => check.is_required,
    );
    if (!requiredCheck)
      throw new Error("Required qualification check fixture is missing.");

    const directQualificationUpdate = await owner
      .from("deal_qualification_checks")
      .update({
        is_complete: true,
        completed_by: ownerUser.id,
        completed_at: new Date().toISOString(),
      })
      .eq("id", requiredCheck.id)
      .select("id");
    record(
      "browser clients cannot bypass qualification evidence auditing",
      Boolean(directQualificationUpdate.error),
    );

    const blockedByQualification = await owner.rpc("transition_deal_stage", {
      target_organization_id: organizationA.id,
      target_deal_id: governedDeal.id,
      target_stage: "proposal",
      target_lost_reason: null,
    });
    record(
      "required qualification evidence blocks proposal advancement",
      Boolean(blockedByQualification.error),
    );

    const completedQualification = await owner
      .rpc("set_deal_qualification_check", {
        target_organization_id: organizationA.id,
        target_check_id: requiredCheck.id,
        target_is_complete: true,
      })
      .single();
    record(
      "authorized qualification completion records actor evidence",
      !completedQualification.error &&
        completedQualification.data?.is_complete === true &&
        completedQualification.data?.completed_by === ownerUser.id &&
        Boolean(completedQualification.data?.completed_at),
      completedQualification.error?.message ?? null,
    );

    const qualifiedProposal = await owner.rpc("transition_deal_stage", {
      target_organization_id: organizationA.id,
      target_deal_id: governedDeal.id,
      target_stage: "proposal",
      target_lost_reason: null,
    });
    record(
      "completed required evidence permits governed advancement",
      !qualifiedProposal.error &&
        qualifiedProposal.data?.length === 1 &&
        qualifiedProposal.data[0].stage === "proposal",
      qualifiedProposal.error?.message ?? null,
    );

    const followUpSequence = await owner
      .rpc("create_follow_up_sequence", {
        target_organization_id: organizationA.id,
        target_name: `Momentum ${suffix}`,
        target_description: "Authorization sequence fixture",
        target_steps: [
          { title: "Confirm the brief", delayDays: 0 },
          { title: "Review itinerary direction", delayDays: 2 },
        ],
      })
      .single();
    record(
      "authorized owner can create an atomic internal follow-up sequence",
      !followUpSequence.error && Boolean(followUpSequence.data?.id),
      followUpSequence.error?.message ?? null,
    );
    if (followUpSequence.error || !followUpSequence.data)
      throw (
        followUpSequence.error ??
        new Error("Follow-up sequence fixture was not created.")
      );

    const backwardsSequence = await owner.rpc("create_follow_up_sequence", {
      target_organization_id: organizationA.id,
      target_name: `Backwards momentum ${suffix}`,
      target_description: "This invalid sequence must roll back.",
      target_steps: [
        { title: "Late step", delayDays: 3 },
        { title: "Earlier step", delayDays: 1 },
      ],
    });
    record(
      "database rejects follow-up sequence delays that move backwards",
      Boolean(backwardsSequence.error),
    );

    const { data: unassignedDeal, error: unassignedDealError } = await admin
      .from("deals")
      .insert({
        organization_id: organizationA.id,
        contact_id: alphaContact.id,
        owner_id: null,
        title: `Unassigned sequence target ${suffix}`,
        stage: "new",
      })
      .select("id")
      .single();
    if (unassignedDealError || !unassignedDeal)
      throw (
        unassignedDealError ??
        new Error("Unassigned opportunity fixture was not created.")
      );
    const unassignedSequenceApply = await owner.rpc(
      "apply_follow_up_sequence",
      {
        target_organization_id: organizationA.id,
        target_deal_id: unassignedDeal.id,
        target_sequence_id: followUpSequence.data.id,
      },
    );
    record(
      "follow-up sequences require an accountable opportunity owner",
      Boolean(unassignedSequenceApply.error),
    );

    const appliedSequence = await owner
      .rpc("apply_follow_up_sequence", {
        target_organization_id: organizationA.id,
        target_deal_id: governedDeal.id,
        target_sequence_id: followUpSequence.data.id,
      })
      .single();
    record(
      "sequence application atomically creates bounded internal tasks",
      !appliedSequence.error &&
        appliedSequence.data?.tasks_created === 2,
      appliedSequence.error?.message ?? null,
    );

    const { data: sequenceTasks, error: sequenceTasksError } = await owner
      .from("tasks")
      .select("title, assignee_id, due_at")
      .eq("deal_id", governedDeal.id)
      .in("title", ["Confirm the brief", "Review itinerary direction"]);
    record(
      "sequence tasks inherit the opportunity owner and explicit deadlines",
      !sequenceTasksError &&
        sequenceTasks?.length === 2 &&
        sequenceTasks.every(
          (task) => task.assignee_id === ownerUser.id && Boolean(task.due_at),
        ),
      sequenceTasksError?.message ?? null,
    );

    const duplicateSequence = await owner.rpc("apply_follow_up_sequence", {
      target_organization_id: organizationA.id,
      target_deal_id: governedDeal.id,
      target_sequence_id: followUpSequence.data.id,
    });
    record(
      "a follow-up sequence cannot be applied twice to one opportunity",
      Boolean(duplicateSequence.error),
    );

    const foreignSequenceApply = await viewer.rpc("apply_follow_up_sequence", {
      target_organization_id: organizationA.id,
      target_deal_id: governedDeal.id,
      target_sequence_id: followUpSequence.data.id,
    });
    record(
      "foreign tenants cannot apply another workspace sequence",
      Boolean(foreignSequenceApply.error),
    );

    const { data: leadForm, error: leadFormError } = await owner
      .from("lead_capture_forms")
      .insert({
        organization_id: organizationA.id,
        name: "Authorization capture fixture",
        headline: "Plan an authorization-safe journey",
        source: "Authz website",
        default_owner_id: ownerUser.id,
        first_response_minutes: 15,
        created_by: ownerUser.id,
      })
      .select("id, public_token")
      .single();
    record(
      "commercial managers can create tenant-owned lead forms",
      !leadFormError && Boolean(leadForm?.id),
    );
    if (leadFormError || !leadForm)
      throw leadFormError ?? new Error("Lead capture fixture was not created.");

    const viewerLeadForm = await viewer.from("lead_capture_forms").insert({
      organization_id: organizationB.id,
      name: "Blocked viewer capture form",
      headline: "This viewer form must be rejected",
      source: "Blocked",
      first_response_minutes: 15,
      created_by: viewerUser.id,
    });
    record(
      "viewers cannot create lead capture forms",
      Boolean(viewerLeadForm.error),
    );

    const browserCaptureAttempt = await owner.rpc("capture_public_lead", {
      target_form_token: leadForm.public_token,
      target_full_name: "Blocked browser capture",
      target_email: `blocked-browser-${suffix}@stateai.invalid`,
      target_phone: null,
      target_destination: "Kyoto",
      target_budget_amount: 250000,
      target_currency: "INR",
      target_notes: null,
      target_communication_consent: false,
      target_utm_source: "authz",
      target_utm_medium: null,
      target_utm_campaign: null,
      target_landing_path: "/lead/authz",
      target_referrer_host: null,
      target_dedupe_key: randomBytes(32).toString("hex"),
      target_request_fingerprint: randomBytes(32).toString("hex"),
    });
    record(
      "authenticated browsers cannot invoke the public capture writer",
      Boolean(browserCaptureAttempt.error),
    );

    const serverCapture = await admin.rpc("capture_public_lead", {
      target_form_token: leadForm.public_token,
      target_full_name: "Captured traveller",
      target_email: `captured-${suffix}@stateai.invalid`,
      target_phone: null,
      target_destination: "Kyoto",
      target_budget_amount: 350000,
      target_currency: "INR",
      target_notes: "Authorization fixture",
      target_communication_consent: true,
      target_utm_source: "newsletter",
      target_utm_medium: "email",
      target_utm_campaign: "authz",
      target_landing_path: "/lead/authz",
      target_referrer_host: "stateai.invalid",
      target_dedupe_key: randomBytes(32).toString("hex"),
      target_request_fingerprint: randomBytes(32).toString("hex"),
    });
    record(
      "server-only capture atomically creates an attributed opportunity",
      !serverCapture.error &&
        serverCapture.data?.length === 1 &&
        serverCapture.data[0].duplicate === false &&
        Boolean(serverCapture.data[0].deal_id),
      serverCapture.error?.message ??
        JSON.stringify({ data: serverCapture.data ?? null }),
    );

    const [ownerSubmissions, viewerForeignSubmissions] = await Promise.all([
      owner
        .from("lead_submissions")
        .select("id, status, deal_id")
        .eq("lead_capture_form_id", leadForm.id),
      viewer
        .from("lead_submissions")
        .select("id")
        .eq("lead_capture_form_id", leadForm.id),
    ]);
    record(
      "tenant members can inspect converted lead submissions",
      !ownerSubmissions.error &&
        ownerSubmissions.data?.length === 1 &&
        ownerSubmissions.data[0].status === "converted",
      ownerSubmissions.error?.message ??
        JSON.stringify({ rows: ownerSubmissions.data?.length ?? 0 }),
    );
    record(
      "foreign tenants cannot inspect lead submissions",
      !viewerForeignSubmissions.error &&
        viewerForeignSubmissions.data?.length === 0,
    );

    activeVerificationPhase = "existing product authorization";
    const ownerForeignConversationAssignee = await owner
      .from("conversations")
      .insert({
        organization_id: organizationA.id,
        contact_id: alphaContact.id,
        assignee_id: viewerUser.id,
        subject: "Blocked foreign assignee fixture",
      });
    record(
      "database rejects a foreign-tenant conversation assignee",
      Boolean(ownerForeignConversationAssignee.error),
    );

    const ownerConversationSla = await owner
      .from("conversations")
      .update({
        priority: "urgent",
        response_due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .eq("id", alphaConversation.id)
      .select("id, priority, response_due_at");
    record(
      "authorized owner can record an Inbox response SLA",
      !ownerConversationSla.error &&
        ownerConversationSla.data?.length === 1 &&
        ownerConversationSla.data[0].priority === "urgent" &&
        Boolean(ownerConversationSla.data[0].response_due_at),
    );

    const ownerConversationEscalation = await owner
      .from("conversations")
      .update({
        sla_escalation_level: 2,
        sla_escalated_at: new Date().toISOString(),
      })
      .eq("id", alphaConversation.id)
      .select("id, sla_escalation_level");
    record(
      "authorized owner can persist a coherent internal SLA escalation",
      !ownerConversationEscalation.error &&
        ownerConversationEscalation.data?.length === 1 &&
        ownerConversationEscalation.data[0].sla_escalation_level === 2,
    );

    const incoherentConversationEscalation = await owner
      .from("conversations")
      .update({
        sla_escalation_level: 3,
        sla_escalated_at: null,
      })
      .eq("id", alphaConversation.id)
      .select("id");
    record(
      "database rejects an escalation tier without evidence time",
      Boolean(incoherentConversationEscalation.error),
    );

    const unknownConversationEscalation = await owner
      .from("conversations")
      .update({
        sla_escalation_level: 4,
        sla_escalated_at: new Date().toISOString(),
      })
      .eq("id", alphaConversation.id)
      .select("id");
    record(
      "database rejects an unknown Inbox escalation tier",
      Boolean(unknownConversationEscalation.error),
    );

    const resetConversationEscalation = await owner
      .from("conversations")
      .update({
        sla_escalation_level: 0,
        sla_escalated_at: null,
      })
      .eq("id", alphaConversation.id)
      .select("id");
    if (
      resetConversationEscalation.error ||
      resetConversationEscalation.data?.length !== 1
    )
      throw (
        resetConversationEscalation.error ??
        new Error("Inbox escalation fixture was not reset.")
      );

    const invalidConversationPriority = await owner
      .from("conversations")
      .update({ priority: "whenever" })
      .eq("id", alphaConversation.id)
      .select("id");
    record(
      "database rejects an unknown Inbox priority",
      Boolean(invalidConversationPriority.error),
    );

    const viewerConversationSla = await viewer
      .from("conversations")
      .update({
        priority: "urgent",
        response_due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .eq("id", betaConversation.id)
      .select("id");
    record(
      "viewer cannot change an Inbox response SLA",
      Boolean(viewerConversationSla.error) ||
        (viewerConversationSla.data?.length ?? 0) === 0,
    );

    const inboxSlaTask = await owner
      .from("tasks")
      .insert({
        organization_id: organizationA.id,
        contact_id: alphaContact.id,
        conversation_id: alphaConversation.id,
        title: "AIOS Inbox SLA: authorization fixture",
      })
      .select("id")
      .single();
    record(
      "AIOS can create a same-tenant Inbox SLA task",
      !inboxSlaTask.error && Boolean(inboxSlaTask.data?.id),
    );

    const duplicateInboxSlaTask = await owner.from("tasks").insert({
      organization_id: organizationA.id,
      contact_id: alphaContact.id,
      conversation_id: alphaConversation.id,
      title: "AIOS Inbox SLA: duplicate authorization fixture",
    });
    record(
      "database deduplicates open Inbox SLA tasks",
      duplicateInboxSlaTask.error?.code === "23505",
    );

    const foreignConversationTask = await owner.from("tasks").insert({
      organization_id: organizationA.id,
      conversation_id: betaConversation.id,
      title: "AIOS Inbox SLA: blocked foreign conversation",
    });
    record(
      "database rejects a foreign-tenant task conversation",
      Boolean(foreignConversationTask.error),
    );

    const ownerTemplate = await owner
      .from("message_templates")
      .insert({
        organization_id: organizationA.id,
        name: `Authorization template ${suffix}`,
        kind: "reply",
        channel: "email",
        subject: "Internal review fixture",
        body: "This reusable copy is an internal authorization fixture.",
        created_by: ownerUser.id,
      })
      .select("id")
      .single();
    record(
      "authorized owner can create an internal reply template",
      !ownerTemplate.error && Boolean(ownerTemplate.data?.id),
    );

    const invalidTemplateKind = await owner.from("message_templates").insert({
      organization_id: organizationA.id,
      name: `Invalid content kind ${suffix}`,
      kind: "automation",
      channel: "email",
      body: "The database must reject unknown reusable content kinds.",
      created_by: ownerUser.id,
    });
    record(
      "database rejects an unknown message-template kind",
      Boolean(invalidTemplateKind.error),
    );

    const ownerDraft = await owner
      .from("message_drafts")
      .insert({
        organization_id: organizationA.id,
        conversation_id: alphaConversation.id,
        template_id: ownerTemplate.data?.id ?? randomUUID(),
        created_by: ownerUser.id,
        channel: "email",
        recipient: "alpha@example.invalid",
        subject: "Internal draft fixture",
        body: "This draft must remain internal until separately approved.",
        status: "ready_for_review",
      })
      .select("id, status")
      .single();
    record(
      "authorized owner can save a same-tenant review draft",
      !ownerDraft.error &&
        Boolean(ownerDraft.data?.id) &&
        ownerDraft.data.status === "ready_for_review",
    );

    const { data: copilotRuns, error: copilotRunsError } = await admin
      .from("ai_runs")
      .insert([
        {
          organization_id: organizationA.id,
          initiated_by: ownerUser.id,
          agent_type: "conversation_reply_draft",
          agent_version: "authz-fixture",
          status: "succeeded",
          input_reference: { conversation_id: alphaConversation.id },
        },
        {
          organization_id: organizationA.id,
          initiated_by: ownerUser.id,
          agent_type: "lead_intake",
          agent_version: "authz-fixture",
          status: "succeeded",
          input_reference: { conversation_id: alphaConversation.id },
        },
      ])
      .select("id, agent_type");
    if (copilotRunsError || copilotRuns?.length !== 2)
      throw copilotRunsError ??
        new Error("Sales Copilot provenance runs were not created.");
    const copilotRun = copilotRuns.find(
      (run) => run.agent_type === "conversation_reply_draft",
    );
    const wrongAgentRun = copilotRuns.find(
      (run) => run.agent_type === "lead_intake",
    );
    if (!copilotRun || !wrongAgentRun)
      throw new Error("Sales Copilot provenance runs could not be identified.");

    const forgedCopilotDraft = await owner.from("message_drafts").insert({
      organization_id: organizationA.id,
      conversation_id: alphaConversation.id,
      ai_run_id: copilotRun.id,
      created_by: ownerUser.id,
      channel: "email",
      body: "Browser clients must not forge AI provenance.",
      status: "ready_for_review",
    });
    record(
      "browser clients cannot forge Sales Copilot draft provenance",
      Boolean(forgedCopilotDraft.error),
    );

    const wrongAgentDraft = await admin.from("message_drafts").insert({
      organization_id: organizationA.id,
      conversation_id: alphaConversation.id,
      ai_run_id: wrongAgentRun.id,
      created_by: ownerUser.id,
      channel: "email",
      body: "The database must reject provenance from another agent type.",
      status: "ready_for_review",
    });
    record(
      "database rejects draft provenance from another AI agent type",
      Boolean(wrongAgentDraft.error),
    );

    const { data: copilotDraft, error: copilotDraftError } = await admin
      .from("message_drafts")
      .insert({
        organization_id: organizationA.id,
        conversation_id: alphaConversation.id,
        ai_run_id: copilotRun.id,
        created_by: ownerUser.id,
        channel: "email",
        recipient: null,
        subject: "Internal AIOS review draft",
        body: "This generated copy remains internal and review-only.",
        status: "ready_for_review",
      })
      .select("id, ai_run_id, recipient, status")
      .single();
    record(
      "server can persist one review-only Sales Copilot draft with provenance",
      !copilotDraftError &&
        Boolean(copilotDraft?.id) &&
        copilotDraft.ai_run_id === copilotRun.id &&
        copilotDraft.recipient === null &&
        copilotDraft.status === "ready_for_review",
    );
    if (copilotDraftError || !copilotDraft)
      throw copilotDraftError ??
        new Error("Sales Copilot draft fixture was not created.");

    const duplicateCopilotDraft = await admin.from("message_drafts").insert({
      organization_id: organizationA.id,
      conversation_id: alphaConversation.id,
      ai_run_id: copilotRun.id,
      created_by: ownerUser.id,
      channel: "email",
      body: "One model run must not create a second generated draft.",
      status: "ready_for_review",
    });
    record(
      "database limits each Sales Copilot run to one durable draft",
      duplicateCopilotDraft.error?.code === "23505",
    );

    const rewrittenProvenance = await admin
      .from("message_drafts")
      .update({ ai_run_id: wrongAgentRun.id })
      .eq("id", copilotDraft.id)
      .select("id");
    record(
      "Sales Copilot draft provenance is immutable",
      Boolean(rewrittenProvenance.error),
    );

    const forgedDraftReview = await owner.from("message_draft_reviews").insert({
      organization_id: organizationA.id,
      message_draft_id: copilotDraft.id,
      ai_run_id: copilotRun.id,
      draft_updated_at: new Date().toISOString(),
      content_sha256: "0".repeat(64),
      decision: "approved",
      reviewed_by: ownerUser.id,
    });
    record(
      "browser clients cannot forge Sales Copilot review evidence",
      Boolean(forgedDraftReview.error),
    );

    const approvedDraftReview = await owner.rpc("review_ai_message_draft", {
      target_organization_id: organizationA.id,
      target_message_draft_id: copilotDraft.id,
      target_decision: "approved",
    });
    const approvedReview = approvedDraftReview.data?.[0];
    record(
      "authorized human can approve the exact current AI draft revision",
      !approvedDraftReview.error &&
        approvedDraftReview.data?.length === 1 &&
        approvedReview?.decision === "approved" &&
        approvedReview.note === null &&
        /^[a-f0-9]{64}$/.test(approvedReview.content_sha256),
    );
    if (approvedDraftReview.error || !approvedReview)
      throw approvedDraftReview.error ??
        new Error("Sales Copilot review fixture was not created.");

    const duplicateDraftReview = await owner.rpc("review_ai_message_draft", {
      target_organization_id: organizationA.id,
      target_message_draft_id: copilotDraft.id,
      target_decision: "approved",
    });
    record(
      "one AI draft revision cannot receive competing human decisions",
      duplicateDraftReview.error?.code === "23505",
    );

    const rewrittenDraftReview = await owner
      .from("message_draft_reviews")
      .update({ decision: "rejected" })
      .eq("id", approvedReview.id)
      .select("id");
    record(
      "Sales Copilot review history is immutable to browser clients",
      Boolean(rewrittenDraftReview.error) ||
        rewrittenDraftReview.data?.length === 0,
    );

    const revisedCopilotDraft = await owner
      .from("message_drafts")
      .update({ body: "A human revised this internal AIOS draft." })
      .eq("id", copilotDraft.id)
      .select("id, updated_at")
      .single();
    if (revisedCopilotDraft.error || !revisedCopilotDraft.data)
      throw revisedCopilotDraft.error ??
        new Error("Sales Copilot revision fixture could not be updated.");
    const changesRequestedReview = await owner.rpc(
      "review_ai_message_draft",
      {
        target_organization_id: organizationA.id,
        target_message_draft_id: copilotDraft.id,
        target_decision: "changes_requested",
        target_note: "Confirm the hotel category before this reply is used.",
      },
    );
    record(
      "a revised AI draft can receive a new evidence-backed decision",
      !changesRequestedReview.error &&
        changesRequestedReview.data?.length === 1 &&
        changesRequestedReview.data[0].decision === "changes_requested" &&
        changesRequestedReview.data[0].draft_updated_at ===
          revisedCopilotDraft.data.updated_at,
    );

    const ownerCopilotQuality = await owner.rpc(
      "get_sales_copilot_quality_summary",
      { target_organization_id: organizationA.id },
    );
    const ownerCopilotQualityRow = ownerCopilotQuality.data?.[0];
    record(
      "Sales Copilot quality summary aggregates exact-revision outcomes",
      !ownerCopilotQuality.error &&
        ownerCopilotQualityRow?.total_ai_drafts === 1 &&
        ownerCopilotQualityRow.active_ai_drafts === 1 &&
        ownerCopilotQualityRow.reviewed_drafts === 1 &&
        ownerCopilotQualityRow.review_decisions === 2 &&
        ownerCopilotQualityRow.first_pass_approved === 1 &&
        ownerCopilotQualityRow.initial_feedback_drafts === 0 &&
        ownerCopilotQualityRow.current_revision_approved === 0 &&
        ownerCopilotQualityRow.current_revision_attention === 1,
    );
    record(
      "Sales Copilot quality summary exposes aggregate metadata only",
      Boolean(ownerCopilotQualityRow) &&
        !Object.keys(ownerCopilotQualityRow).some((key) =>
          [
            "body",
            "subject",
            "note",
            "recipient",
            "reviewed_by",
            "message_draft_id",
            "ai_run_id",
          ].includes(key),
        ),
    );

    const foreignCopilotQuality = await viewer.rpc(
      "get_sales_copilot_quality_summary",
      { target_organization_id: organizationA.id },
    );
    record(
      "foreign tenants receive no Sales Copilot quality evidence",
      !foreignCopilotQuality.error &&
        foreignCopilotQuality.data?.length === 1 &&
        foreignCopilotQuality.data[0].total_ai_drafts === 0 &&
        foreignCopilotQuality.data[0].review_decisions === 0 &&
        foreignCopilotQuality.data[0].latest_reviewed_at === null,
    );

    const foreignDraftReview = await viewer.rpc("review_ai_message_draft", {
      target_organization_id: organizationA.id,
      target_message_draft_id: copilotDraft.id,
      target_decision: "rejected",
      target_note: "A foreign tenant must not review this draft.",
    });
    record(
      "foreign tenants cannot review Sales Copilot drafts",
      Boolean(foreignDraftReview.error),
    );

    const humanDraftAiReview = await owner.rpc("review_ai_message_draft", {
      target_organization_id: organizationA.id,
      target_message_draft_id: ownerDraft.data?.id ?? randomUUID(),
      target_decision: "rejected",
      target_note: "Human-authored drafts do not belong in the AI review ledger.",
    });
    record(
      "the AI feedback ledger rejects human-authored drafts",
      Boolean(humanDraftAiReview.error),
    );

    const { data: draftReviewAudit } = await owner
      .from("audit_events")
      .select("metadata")
      .eq("organization_id", organizationA.id)
      .eq("entity_type", "message_draft")
      .eq("entity_id", copilotDraft.id)
      .eq("event_type", "ai.draft.reviewed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    record(
      "draft-review audit proves the decision without copying feedback text",
      draftReviewAudit?.metadata?.feedback_recorded === true &&
        draftReviewAudit.metadata.external_message_sent === false &&
        !JSON.stringify(draftReviewAudit.metadata).includes("hotel category"),
    );

    const foreignConversationDraft = await owner
      .from("message_drafts")
      .insert({
        organization_id: organizationA.id,
        conversation_id: betaConversation.id,
        template_id: ownerTemplate.data?.id ?? null,
        created_by: ownerUser.id,
        channel: "email",
        body: "Blocked cross-tenant draft fixture.",
      });
    record(
      "database rejects a foreign-tenant draft conversation",
      Boolean(foreignConversationDraft.error),
    );

    const viewerTemplate = await viewer.from("message_templates").insert({
      organization_id: organizationB.id,
      name: `Blocked viewer template ${suffix}`,
      channel: "email",
      body: "A viewer must not create reusable outbound copy.",
      created_by: viewerUser.id,
    });
    record(
      "viewer cannot create message templates",
      Boolean(viewerTemplate.error),
    );

    const viewerDraft = await viewer.from("message_drafts").insert({
      organization_id: organizationB.id,
      conversation_id: betaConversation.id,
      created_by: viewerUser.id,
      channel: "email",
      body: "A viewer must not prepare an outbound draft.",
    });
    record(
      "viewer cannot create message drafts",
      Boolean(viewerDraft.error),
    );

    const ownerDraftRevision = await owner
      .from("message_drafts")
      .update({
        body: "This revised draft remains internal.",
        status: "draft",
      })
      .eq("id", ownerDraft.data?.id ?? randomUUID())
      .select("id, status");
    record(
      "authorized owner can revise an internal draft",
      !ownerDraftRevision.error &&
        ownerDraftRevision.data?.length === 1 &&
        ownerDraftRevision.data[0].status === "draft",
    );

    const ownerTemplateRetirement = await owner
      .from("message_templates")
      .update({ is_active: false })
      .eq("id", ownerTemplate.data?.id ?? randomUUID())
      .select("id, is_active");
    record(
      "authorized owner can retire reusable copy without deletion",
      !ownerTemplateRetirement.error &&
        ownerTemplateRetirement.data?.length === 1 &&
        ownerTemplateRetirement.data[0].is_active === false,
    );

    const { data: betaTemplate, error: betaTemplateError } = await admin
      .from("message_templates")
      .insert({
        organization_id: organizationB.id,
        name: `Viewer update fixture ${suffix}`,
        channel: "email",
        body: "Privileged fixture used to prove viewer update denial.",
        created_by: viewerUser.id,
      })
      .select("id")
      .single();
    if (betaTemplateError || !betaTemplate)
      throw betaTemplateError ??
        new Error("Viewer template update fixture was not created.");
    const { data: betaDraft, error: betaDraftError } = await admin
      .from("message_drafts")
      .insert({
        organization_id: organizationB.id,
        conversation_id: betaConversation.id,
        template_id: betaTemplate.id,
        created_by: viewerUser.id,
        channel: "email",
        body: "Privileged fixture used to prove viewer update denial.",
      })
      .select("id")
      .single();
    if (betaDraftError || !betaDraft)
      throw betaDraftError ??
        new Error("Viewer draft update fixture was not created.");

    const viewerTemplateUpdate = await viewer
      .from("message_templates")
      .update({ is_active: false })
      .eq("id", betaTemplate.id)
      .select("id");
    record(
      "viewer cannot retire message templates",
      Boolean(viewerTemplateUpdate.error) ||
        (viewerTemplateUpdate.data?.length ?? 0) === 0,
    );

    const viewerDraftUpdate = await viewer
      .from("message_drafts")
      .update({ body: "Blocked viewer revision." })
      .eq("id", betaDraft.id)
      .select("id");
    record(
      "viewer cannot revise message drafts",
      Boolean(viewerDraftUpdate.error) ||
        (viewerDraftUpdate.data?.length ?? 0) === 0,
    );

    const validPreferenceUpdate = await owner
      .from("contacts")
      .update({
        communication_consent: "granted",
        consent_recorded_at: new Date().toISOString(),
        consent_source: "Authorization fixture",
        preferred_channel: "email",
        preferred_locale: "en-IN",
        time_zone: "Asia/Kolkata",
      })
      .eq("id", alphaContact.id)
      .select("id");
    record(
      "authorized owner can record coherent contact preferences",
      !validPreferenceUpdate.error &&
        validPreferenceUpdate.data?.length === 1,
    );

    const incoherentPreferenceUpdate = await owner
      .from("contacts")
      .update({
        communication_consent: "unknown",
        consent_recorded_at: null,
        consent_source: "Fabricated evidence",
      })
      .eq("id", alphaContact.id);
    record(
      "database rejects incoherent consent evidence",
      Boolean(incoherentPreferenceUpdate.error),
    );

    const viewerPreferenceUpdate = await viewer
      .from("contacts")
      .update({ preferred_channel: "none" })
      .eq("id", betaContact.id)
      .select("id");
    record(
      "viewer cannot change contact preferences",
      Boolean(viewerPreferenceUpdate.error) ||
        (viewerPreferenceUpdate.data?.length ?? 0) === 0,
    );

    const { data: duplicateContact, error: duplicateContactError } = await owner
      .from("contacts")
      .insert({
        organization_id: organizationA.id,
        first_name: "Alpha duplicate",
        phone: "+91 90000 00000",
      })
      .select("id")
      .single();
    if (duplicateContactError || !duplicateContact)
      throw duplicateContactError ?? new Error("Merge fixture was not created.");
    const { data: duplicateTask, error: duplicateTaskError } = await owner
      .from("tasks")
      .insert({
        organization_id: organizationA.id,
        contact_id: duplicateContact.id,
        title: "Merge relationship fixture",
      })
      .select("id")
      .single();
    if (duplicateTaskError || !duplicateTask)
      throw duplicateTaskError ?? new Error("Merge task fixture was not created.");

    const viewerMergeAttempt = await viewer.rpc(
      "merge_duplicate_contacts",
      {
        target_organization_id: organizationB.id,
        primary_contact_id: betaContact.id,
        duplicate_contact_id: alphaContact.id,
      },
    );
    record(
      "viewer cannot merge contact records",
      Boolean(viewerMergeAttempt.error),
    );

    const ownerMerge = await owner.rpc("merge_duplicate_contacts", {
      target_organization_id: organizationA.id,
      primary_contact_id: alphaContact.id,
      duplicate_contact_id: duplicateContact.id,
    });
    record(
      "authorized contact merge completes atomically",
      !ownerMerge.error &&
        ownerMerge.data?.[0]?.surviving_contact_id === alphaContact.id &&
        ownerMerge.data?.[0]?.archived_contact_id === duplicateContact.id,
      ownerMerge.error?.code ?? null,
    );

    const [archivedDuplicate, relinkedTask, mergeAudit] = await Promise.all([
      owner
        .from("contacts")
        .select("archived_at, email")
        .eq("id", duplicateContact.id)
        .single(),
      owner
        .from("tasks")
        .select("contact_id")
        .eq("id", duplicateTask.id)
        .single(),
      owner
        .from("audit_events")
        .select("id")
        .eq("organization_id", organizationA.id)
        .eq("entity_id", alphaContact.id)
        .eq("event_type", "record.updated"),
    ]);
    record(
      "contact merge archives the duplicate identity",
      !archivedDuplicate.error &&
        Boolean(archivedDuplicate.data.archived_at) &&
        archivedDuplicate.data.email === null,
    );
    record(
      "contact merge re-links dependent records",
      !relinkedTask.error &&
        relinkedTask.data.contact_id === alphaContact.id,
    );
    record(
      "contact merge leaves audit evidence",
      !mergeAudit.error && (mergeAudit.data?.length ?? 0) >= 1,
    );

    const [ownerSavedView, viewerSavedView] = await Promise.all([
      owner.from("saved_views").insert({
        organization_id: organizationA.id,
        user_id: ownerUser.id,
        feature: "contacts",
        name: "Owner fixture view",
        filters: { query: "alpha" },
      }),
      viewer.from("saved_views").insert({
        organization_id: organizationB.id,
        user_id: viewerUser.id,
        feature: "contacts",
        name: "Viewer fixture view",
        filters: { query: "beta" },
      }),
    ]);
    record(
      "active users can create private saved views",
      !ownerSavedView.error && !viewerSavedView.error,
    );

    const ownerVisibleViews = await owner
      .from("saved_views")
      .select("name")
      .eq("feature", "contacts");
    record(
      "saved views are private to their user and tenant",
      !ownerVisibleViews.error &&
        ownerVisibleViews.data?.length === 1 &&
        ownerVisibleViews.data[0].name === "Owner fixture view",
    );

    const ownerForeignSavedView = await owner.from("saved_views").insert({
      organization_id: organizationB.id,
      user_id: ownerUser.id,
      feature: "contacts",
      name: "Blocked foreign view",
      filters: {},
    });
    record(
      "users cannot create saved views in a foreign tenant",
      Boolean(ownerForeignSavedView.error),
    );

    activeVerificationPhase = "verifying governed analytics targets";
    const directAnalyticsTarget = await owner
      .from("analytics_targets")
      .insert({
        organization_id: organizationA.id,
        label: "Blocked direct target",
        currency: "INR",
        period_start: "2026-08-01",
        period_end: "2026-09-30",
        target_amount: 100000,
        created_by: ownerUser.id,
        updated_by: ownerUser.id,
      });
    record(
      "browser clients cannot write analytics targets directly",
      Boolean(directAnalyticsTarget.error),
    );

    const viewerAnalyticsTarget = await viewer.rpc(
      "upsert_analytics_target",
      {
        target_organization_id: organizationB.id,
        target_label: "Blocked viewer target",
        target_currency: "INR",
        target_period_start: "2026-08-01",
        target_period_end: "2026-09-30",
        target_amount: 100000,
        target_is_active: true,
      },
    );
    record(
      "viewers cannot approve analytics targets",
      Boolean(viewerAnalyticsTarget.error),
    );

    const foreignAnalyticsTarget = await owner.rpc(
      "upsert_analytics_target",
      {
        target_organization_id: organizationB.id,
        target_label: "Blocked foreign target",
        target_currency: "INR",
        target_period_start: "2026-08-01",
        target_period_end: "2026-09-30",
        target_amount: 100000,
        target_is_active: true,
      },
    );
    record(
      "owners cannot approve targets in a foreign tenant",
      Boolean(foreignAnalyticsTarget.error),
    );

    const ownerAnalyticsTarget = await owner.rpc(
      "upsert_analytics_target",
      {
        target_organization_id: organizationA.id,
        target_label: "Authz Q3 target",
        target_currency: "INR",
        target_period_start: "2026-08-01",
        target_period_end: "2026-09-30",
        target_amount: 100000,
        target_is_active: true,
      },
    );
    const analyticsTarget = ownerAnalyticsTarget.data?.[0];
    record(
      "owners approve bounded period and currency targets",
      !ownerAnalyticsTarget.error &&
        analyticsTarget?.label === "Authz Q3 target" &&
        analyticsTarget?.currency === "INR" &&
        analyticsTarget?.is_active === true,
    );
    if (ownerAnalyticsTarget.error || !analyticsTarget)
      throw ownerAnalyticsTarget.error ??
        new Error("Analytics target authorization fixture was not created.");

    const viewerForeignTargetRead = await viewer
      .from("analytics_targets")
      .select("id")
      .eq("id", analyticsTarget.id);
    record(
      "analytics targets remain tenant isolated",
      !viewerForeignTargetRead.error &&
        viewerForeignTargetRead.data?.length === 0,
    );

    const directAnalyticsTargetUpdate = await owner
      .from("analytics_targets")
      .update({ target_amount: 1 })
      .eq("id", analyticsTarget.id)
      .select("id");
    record(
      "browser clients cannot rewrite approved analytics targets",
      Boolean(directAnalyticsTargetUpdate.error) ||
        directAnalyticsTargetUpdate.data?.length === 0,
    );

    const retiredAnalyticsTarget = await owner.rpc(
      "upsert_analytics_target",
      {
        target_organization_id: organizationA.id,
        target_id: analyticsTarget.id,
        target_label: analyticsTarget.label,
        target_currency: analyticsTarget.currency,
        target_period_start: analyticsTarget.period_start,
        target_period_end: analyticsTarget.period_end,
        target_amount: analyticsTarget.target_amount,
        target_is_active: false,
      },
    );
    record(
      "owners retire analytics targets without deleting history",
      !retiredAnalyticsTarget.error &&
        retiredAnalyticsTarget.data?.[0]?.is_active === false,
      retiredAnalyticsTarget.error?.message ??
        JSON.stringify(retiredAnalyticsTarget.data),
    );

    const analyticsTargetAudit = await owner
      .from("audit_events")
      .select("metadata")
      .eq("organization_id", organizationA.id)
      .eq("entity_type", "analytics_target")
      .eq("entity_id", analyticsTarget.id);
    record(
      "analytics target changes preserve audit evidence",
      !analyticsTargetAudit.error &&
        (analyticsTargetAudit.data?.length ?? 0) === 2,
      analyticsTargetAudit.error?.message ??
        `audit rows: ${analyticsTargetAudit.data?.length ?? 0}`,
    );

    activeVerificationPhase =
      "verifying durable management report delivery";
    const ownerReportSchedule = await owner
      .from("analytics_report_schedules")
      .select("*")
      .eq("organization_id", organizationA.id)
      .single();
    record(
      "new workspaces receive a paused aggregate report schedule",
      !ownerReportSchedule.error &&
        ownerReportSchedule.data?.is_enabled === false,
    );

    const viewerForeignReportSchedule = await viewer
      .from("analytics_report_schedules")
      .select("organization_id")
      .eq("organization_id", organizationA.id);
    record(
      "management report schedules remain tenant isolated",
      !viewerForeignReportSchedule.error &&
        viewerForeignReportSchedule.data?.length === 0,
    );

    const directReportScheduleWrite = await owner
      .from("analytics_report_schedules")
      .update({ cadence: "monthly" })
      .eq("organization_id", organizationA.id)
      .select("organization_id");
    record(
      "browser clients cannot rewrite report schedules directly",
      Boolean(directReportScheduleWrite.error) ||
        directReportScheduleWrite.data?.length === 0,
    );

    const nextReportAt = new Date(Date.now() + 86_400_000).toISOString();
    const viewerReportSchedule = await viewer.rpc(
      "upsert_analytics_report_schedule",
      {
        target_organization_id: organizationB.id,
        target_is_enabled: true,
        target_cadence: "weekly",
        target_period_days: 30,
        target_forecast_horizon_days: 90,
        target_next_run_at: nextReportAt,
      },
    );
    record(
      "viewers cannot configure management report delivery",
      Boolean(viewerReportSchedule.error),
    );

    const ownerForeignReportSchedule = await owner.rpc(
      "upsert_analytics_report_schedule",
      {
        target_organization_id: organizationB.id,
        target_is_enabled: true,
        target_cadence: "weekly",
        target_period_days: 30,
        target_forecast_horizon_days: 90,
        target_next_run_at: nextReportAt,
      },
    );
    record(
      "owners cannot configure report delivery in a foreign tenant",
      Boolean(ownerForeignReportSchedule.error),
    );

    const savedReportSchedule = await owner.rpc(
      "upsert_analytics_report_schedule",
      {
        target_organization_id: organizationA.id,
        target_is_enabled: true,
        target_cadence: "weekly",
        target_period_days: 30,
        target_forecast_horizon_days: 90,
        target_next_run_at: nextReportAt,
      },
    );
    record(
      "owners configure bounded aggregate report delivery",
      !savedReportSchedule.error &&
        savedReportSchedule.data?.[0]?.is_enabled === true &&
        savedReportSchedule.data?.[0]?.period_days === 30,
    );

    const browserReportClaim = await owner.rpc(
      "claim_analytics_report_runs",
      {
        target_worker_id: `owner-report-${suffix}`,
        target_limit: 1,
        target_organization_id: organizationA.id,
        target_force: true,
      },
    );
    record(
      "authenticated clients cannot claim report leases",
      Boolean(browserReportClaim.error),
    );

    const reportWorkerId = `authz-report-${randomUUID()}`;
    const serverReportClaim = await admin.rpc(
      "claim_analytics_report_runs",
      {
        target_worker_id: reportWorkerId,
        target_limit: 1,
        target_organization_id: organizationA.id,
        target_force: true,
      },
    );
    const claimedReport = serverReportClaim.data?.[0];
    record(
      "server workers claim one tenant-scoped report lease",
      !serverReportClaim.error &&
        serverReportClaim.data?.length === 1 &&
        claimedReport?.organization_id === organizationA.id,
    );
    if (serverReportClaim.error || !claimedReport)
      throw serverReportClaim.error ??
        new Error("Management report lease was not created.");

    const browserReportSettle = await owner.rpc(
      "settle_analytics_report_run",
      {
        target_run_id: claimedReport.run_id,
        target_worker_id: reportWorkerId,
        target_status: "failed",
        target_error_code: "blocked",
      },
    );
    record(
      "authenticated clients cannot settle report leases",
      Boolean(browserReportSettle.error),
    );

    const serverReportSettle = await admin.rpc(
      "settle_analytics_report_run",
      {
        target_run_id: claimedReport.run_id,
        target_worker_id: reportWorkerId,
        target_status: "ready",
        target_report_filename: "aios-management-report-2026-07-29.csv",
        target_report_csv: "\uFEFF\"section\",\"metric\"\r\n",
        target_report_row_count: 1,
        target_report_sha256: "a".repeat(64),
      },
    );
    record(
      "server workers settle immutable aggregate report evidence",
      !serverReportSettle.error &&
        serverReportSettle.data?.[0]?.status === "ready" &&
        serverReportSettle.data?.[0]?.report_row_count === 1,
      serverReportSettle.error?.message ??
        JSON.stringify(serverReportSettle.data),
    );

    const failureWorkerId = `authz-report-fail-${randomUUID()}`;
    const failureClaim = await admin.rpc("claim_analytics_report_runs", {
      target_worker_id: failureWorkerId,
      target_limit: 1,
      target_organization_id: organizationA.id,
      target_force: true,
    });
    const failureRun = failureClaim.data?.[0];
    if (failureClaim.error || !failureRun)
      throw failureClaim.error ??
        new Error("Failure-path report lease was not created.");
    const wrongReportWorkerSettlement = await admin.rpc(
      "settle_analytics_report_run",
      {
        target_run_id: failureRun.run_id,
        target_worker_id: `wrong-report-${randomUUID()}`,
        target_status: "failed",
        target_error_code: "wrong_worker",
      },
    );
    record(
      "one report worker cannot settle another worker's lease",
      Boolean(wrongReportWorkerSettlement.error),
    );
    const failedReportSettlement = await admin.rpc(
      "settle_analytics_report_run",
      {
        target_run_id: failureRun.run_id,
        target_worker_id: failureWorkerId,
        target_status: "failed",
        target_error_code: "fixture_failure",
      },
    );
    record(
      "failed report settlement stores no partial report payload",
      !failedReportSettlement.error &&
        failedReportSettlement.data?.[0]?.status === "failed" &&
        failedReportSettlement.data?.[0]?.report_csv === null &&
        failedReportSettlement.data?.[0]?.report_sha256 === null,
    );

    const expiredWorkerId = `expired-report-${randomUUID()}`;
    const expiredDelivery = await admin
      .from("analytics_report_deliveries")
      .insert({
        organization_id: organizationA.id,
        trigger_type: "scheduled",
        status: "running",
        scheduled_for: new Date(Date.now() - 17 * 60_000).toISOString(),
        started_at: new Date(Date.now() - 16 * 60_000).toISOString(),
        worker_id: expiredWorkerId,
        schedule_snapshot: {
          schema_version: 1,
          cadence: "weekly",
          period_days: 30,
          forecast_horizon_days: 90,
          delivery_channel: "in_app",
        },
      })
      .select("id")
      .single();
    if (expiredDelivery.error || !expiredDelivery.data)
      throw expiredDelivery.error ??
        new Error("Expired report lease fixture was not created.");
    const reclaimWorkerId = `reclaim-report-${randomUUID()}`;
    const reclaimedReport = await admin.rpc(
      "claim_analytics_report_runs",
      {
        target_worker_id: reclaimWorkerId,
        target_limit: 1,
        target_organization_id: organizationA.id,
        target_force: true,
      },
    );
    const reclaimedRun = reclaimedReport.data?.[0];
    record(
      "report claims reap an abandoned fifteen-minute lease",
      !reclaimedReport.error && reclaimedReport.data?.length === 1,
    );
    if (reclaimedReport.error || !reclaimedRun)
      throw reclaimedReport.error ??
        new Error("Expired report lease was not reclaimed.");
    const expiredDeliveryState = await admin
      .from("analytics_report_deliveries")
      .select("status, error_code, report_csv")
      .eq("id", expiredDelivery.data.id)
      .single();
    record(
      "expired report leases retain only a bounded failure code",
      !expiredDeliveryState.error &&
        expiredDeliveryState.data?.status === "failed" &&
        expiredDeliveryState.data?.error_code === "lease_expired" &&
        expiredDeliveryState.data?.report_csv === null,
    );
    const duplicateActiveClaim = await admin.rpc(
      "claim_analytics_report_runs",
      {
        target_worker_id: `duplicate-report-${randomUUID()}`,
        target_limit: 1,
        target_organization_id: organizationA.id,
        target_force: true,
      },
    );
    record(
      "one workspace cannot receive a duplicate active report lease",
      !duplicateActiveClaim.error &&
        duplicateActiveClaim.data?.length === 0,
    );
    const reclaimedSettlement = await admin.rpc(
      "settle_analytics_report_run",
      {
        target_run_id: reclaimedRun.run_id,
        target_worker_id: reclaimWorkerId,
        target_status: "failed",
        target_error_code: "reclaimed_fixture",
      },
    );
    if (reclaimedSettlement.error) throw reclaimedSettlement.error;

    const ownerReportDelivery = await owner
      .from("analytics_report_deliveries")
      .select("id, status, report_csv")
      .eq("id", claimedReport.run_id)
      .single();
    record(
      "workspace members read their aggregate report delivery",
      !ownerReportDelivery.error &&
        ownerReportDelivery.data?.status === "ready" &&
        ownerReportDelivery.data?.report_csv?.includes("section"),
    );

    const viewerForeignReportDelivery = await viewer
      .from("analytics_report_deliveries")
      .select("id")
      .eq("id", claimedReport.run_id);
    record(
      "management report deliveries remain tenant isolated",
      !viewerForeignReportDelivery.error &&
        viewerForeignReportDelivery.data?.length === 0,
    );

    const directReportDeliveryWrite = await owner
      .from("analytics_report_deliveries")
      .insert({
        organization_id: organizationA.id,
        trigger_type: "operator",
        status: "running",
        scheduled_for: new Date().toISOString(),
        worker_id: `forged-report-${suffix}`,
        schedule_snapshot: {},
      });
    record(
      "browser clients cannot forge report deliveries",
      Boolean(directReportDeliveryWrite.error),
    );

    const reportScheduleAudit = await owner
      .from("audit_events")
      .select("id")
      .eq("organization_id", organizationA.id)
      .eq("entity_type", "analytics_report_schedule");
    record(
      "report schedule changes preserve audit evidence",
      !reportScheduleAudit.error &&
        (reportScheduleAudit.data?.length ?? 0) === 1,
    );

    const forgedApproval = await owner.from("approval_requests").insert({
      organization_id: organizationA.id,
      requester_id: ownerUser.id,
      action: "authz.fixture",
      status: "approved",
      entity_type: "authorization_fixture",
      resolved_at: new Date().toISOString(),
    });
    record(
      "authenticated clients cannot create pre-approved requests",
      Boolean(forgedApproval.error),
    );

    const { data: pendingApproval, error: pendingApprovalError } = await owner
      .from("approval_requests")
      .insert({
        organization_id: organizationA.id,
        requester_id: ownerUser.id,
        action: "authz.fixture",
        entity_type: "authorization_fixture",
      })
      .select("id")
      .single();
    record(
      "authorized members can create pending approval requests",
      !pendingApprovalError && Boolean(pendingApproval),
    );

    if (!pendingApproval)
      throw pendingApprovalError ?? new Error("Pending approval was not created.");

    const directApprovalUpdate = await owner
      .from("approval_requests")
      .update({
        status: "approved",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", pendingApproval.id);
    record(
      "authenticated clients cannot update approval state directly",
      Boolean(directApprovalUpdate.error),
    );

    const firstApprovalResolution = await owner.rpc(
      "resolve_approval_request",
      {
        target_organization_id: organizationA.id,
        target_approval_id: pendingApproval.id,
        target_decision: "approved",
      },
    );
    record(
      "authorized resolver atomically approves a pending request",
      !firstApprovalResolution.error &&
        firstApprovalResolution.data?.[0]?.resolved_status === "approved",
    );

    const duplicateApprovalResolution = await owner.rpc(
      "resolve_approval_request",
      {
        target_organization_id: organizationA.id,
        target_approval_id: pendingApproval.id,
        target_decision: "approved",
      },
    );
    record(
      "a resolved approval cannot be claimed twice",
      Boolean(duplicateApprovalResolution.error),
    );

    const approvalAudit = await owner
      .from("audit_events")
      .select("id")
      .eq("organization_id", organizationA.id)
      .eq("entity_id", pendingApproval.id)
      .eq("event_type", "approval.resolved");
    record(
      "approval resolution writes an audit event atomically",
      !approvalAudit.error && approvalAudit.data?.length === 1,
    );

    const externalAutoPolicy = await owner
      .from("ai_autonomy_policies")
      .insert({
        organization_id: organizationA.id,
        action: "external_message.send",
        mode: "auto",
      });
    record(
      "database rejects Auto for an external effect",
      Boolean(externalAutoPolicy.error),
    );

    const unsafeApprovalRoles = await owner
      .from("ai_autonomy_policies")
      .insert({
        organization_id: organizationA.id,
        action: "authz.unsafe.approver",
        mode: "approval_required",
        approval_roles: ["viewer"],
      });
    record(
      "database rejects unauthorized approval roles",
      Boolean(unsafeApprovalRoles.error),
    );

    const internalAutoPolicy = await owner
      .from("ai_autonomy_policies")
      .insert({
        organization_id: organizationA.id,
        action: "internal.task.create",
        mode: "auto",
      });
    record(
      "database permits bounded internal Auto policy",
      !internalAutoPolicy.error,
    );

    const invalidBudgetPolicy = await owner
      .from("ai_budget_policies")
      .insert({
        organization_id: organizationA.id,
        daily_model_run_limit: 0,
        model_execution_enabled: true,
        updated_by: ownerUser.id,
      });
    record(
      "database rejects an invalid workspace model-run ceiling",
      Boolean(invalidBudgetPolicy.error),
    );

    const ownerBudgetPolicy = await owner
      .from("ai_budget_policies")
      .insert({
        organization_id: organizationA.id,
        daily_model_run_limit: 12,
        model_execution_enabled: true,
        updated_by: ownerUser.id,
      })
      .select("id")
      .single();
    record(
      "authorized owner can create a workspace AIOS budget",
      !ownerBudgetPolicy.error && Boolean(ownerBudgetPolicy.data?.id),
    );

    const ownerBudgetKillSwitch = await owner
      .from("ai_budget_policies")
      .update({
        daily_model_run_limit: 8,
        model_execution_enabled: false,
        updated_by: ownerUser.id,
      })
      .eq("id", ownerBudgetPolicy.data?.id ?? randomUUID())
      .select("id, daily_model_run_limit, model_execution_enabled");
    record(
      "authorized owner can disable workspace model execution",
      !ownerBudgetKillSwitch.error &&
        ownerBudgetKillSwitch.data?.length === 1 &&
        ownerBudgetKillSwitch.data[0].daily_model_run_limit === 8 &&
        ownerBudgetKillSwitch.data[0].model_execution_enabled === false,
    );

    const ownerProviderPolicy = await owner
      .from("ai_budget_policies")
      .update({
        selected_model_provider: "qwen",
        fallback_model_provider: "glm",
        allowed_model_providers: ["glm", "qwen"],
        updated_by: ownerUser.id,
      })
      .eq("id", ownerBudgetPolicy.data?.id ?? randomUUID())
      .select(
        "id, selected_model_provider, fallback_model_provider, allowed_model_providers",
      );
    record(
      "authorized owner can select an allowed workspace model provider",
      !ownerProviderPolicy.error &&
        ownerProviderPolicy.data?.length === 1 &&
        ownerProviderPolicy.data[0].selected_model_provider === "qwen" &&
        ownerProviderPolicy.data[0].fallback_model_provider === "glm" &&
        ownerProviderPolicy.data[0].allowed_model_providers.length === 2,
    );

    const sameProviderFallback = await owner
      .from("ai_budget_policies")
      .update({
        fallback_model_provider: "qwen",
        updated_by: ownerUser.id,
      })
      .eq("id", ownerBudgetPolicy.data?.id ?? randomUUID())
      .select("id");
    record(
      "database rejects using the primary provider as its own fallback",
      Boolean(sameProviderFallback.error),
    );

    const disallowedFallback = await owner
      .from("ai_budget_policies")
      .update({
        fallback_model_provider: "openai",
        updated_by: ownerUser.id,
      })
      .eq("id", ownerBudgetPolicy.data?.id ?? randomUUID())
      .select("id");
    record(
      "database rejects a fallback outside the provider allow-list",
      Boolean(disallowedFallback.error),
    );

    const disallowedSelectedProvider = await owner
      .from("ai_budget_policies")
      .update({
        selected_model_provider: "openai",
        allowed_model_providers: ["glm"],
        updated_by: ownerUser.id,
      })
      .eq("id", ownerBudgetPolicy.data?.id ?? randomUUID())
      .select("id");
    record(
      "database rejects selecting a provider outside the allow-list",
      Boolean(disallowedSelectedProvider.error),
    );

    const unknownModelProvider = await owner
      .from("ai_budget_policies")
      .update({
        selected_model_provider: "unknown",
        allowed_model_providers: ["unknown"],
        updated_by: ownerUser.id,
      })
      .eq("id", ownerBudgetPolicy.data?.id ?? randomUUID())
      .select("id");
    record(
      "database rejects unknown AIOS model providers",
      Boolean(unknownModelProvider.error),
    );

    const foreignBudgetUpdater = await owner
      .from("ai_budget_policies")
      .update({ updated_by: viewerUser.id })
      .eq("id", ownerBudgetPolicy.data?.id ?? randomUUID())
      .select("id");
    record(
      "database rejects a foreign-tenant AIOS budget updater",
      Boolean(foreignBudgetUpdater.error),
    );

    const viewerBudgetPolicy = await viewer.from("ai_budget_policies").insert({
      organization_id: organizationB.id,
      daily_model_run_limit: 20,
      model_execution_enabled: true,
      updated_by: viewerUser.id,
    });
    record(
      "viewer cannot create a workspace AIOS budget",
      Boolean(viewerBudgetPolicy.error),
    );

    const invalidModelPrice = await owner.from("ai_model_prices").insert({
      organization_id: organizationA.id,
      provider: "glm",
      model: "authz-invalid",
      currency: "USD",
      input_price_per_million: -1,
      output_price_per_million: 1,
      approved_by: ownerUser.id,
    });
    record(
      "database rejects a negative model price",
      Boolean(invalidModelPrice.error),
    );

    const { data: ownerModelPrice, error: ownerModelPriceError } = await owner
      .from("ai_model_prices")
      .insert({
        organization_id: organizationA.id,
        provider: "glm",
        model: "authz-model",
        currency: "USD",
        input_price_per_million: 1.25,
        output_price_per_million: 4.5,
        approved_by: ownerUser.id,
      })
      .select("id")
      .single();
    record(
      "authorized owner can approve a model price version",
      !ownerModelPriceError && Boolean(ownerModelPrice?.id),
    );
    if (ownerModelPriceError || !ownerModelPrice)
      throw ownerModelPriceError ??
        new Error("Owner model price fixture was not created.");

    const immutableModelPrice = await owner
      .from("ai_model_prices")
      .update({ input_price_per_million: 99 })
      .eq("id", ownerModelPrice.id)
      .select("id");
    record(
      "approved model price versions cannot be rewritten",
      Boolean(immutableModelPrice.error),
    );

    const foreignModelPriceApprover = await owner.from("ai_model_prices").insert({
      organization_id: organizationA.id,
      provider: "glm",
      model: "authz-foreign-approver",
      currency: "USD",
      input_price_per_million: 1,
      output_price_per_million: 1,
      approved_by: viewerUser.id,
    });
    record(
      "database rejects a foreign-tenant model-price approver",
      Boolean(foreignModelPriceApprover.error),
    );

    const viewerModelPrice = await viewer.from("ai_model_prices").insert({
      organization_id: organizationB.id,
      provider: "glm",
      model: "authz-viewer",
      currency: "USD",
      input_price_per_million: 1,
      output_price_per_million: 1,
      approved_by: viewerUser.id,
    });
    record(
      "viewer cannot approve model prices",
      Boolean(viewerModelPrice.error),
    );

    const { data: betaModelPrice, error: betaModelPriceError } = await admin
      .from("ai_model_prices")
      .insert({
        organization_id: organizationB.id,
        provider: "glm",
        model: "authz-beta",
        currency: "USD",
        input_price_per_million: 1,
        output_price_per_million: 1,
        approved_by: viewerUser.id,
      })
      .select("id")
      .single();
    if (betaModelPriceError || !betaModelPrice)
      throw betaModelPriceError ??
        new Error("Foreign model price fixture was not created.");

    const { data: queueRuns, error: queueRunError } = await admin
      .from("ai_runs")
      .insert([
        {
          organization_id: organizationA.id,
          initiated_by: ownerUser.id,
          agent_type: "lead_intake",
          agent_version: "authz-fixture",
          status: "running",
          input_reference: { fixture: true },
        },
        {
          organization_id: organizationB.id,
          initiated_by: viewerUser.id,
          agent_type: "itinerary_draft",
          agent_version: "authz-fixture",
          status: "running",
          input_reference: { fixture: true },
        },
      ])
      .select("id, organization_id");
    if (queueRunError || queueRuns?.length !== 2)
      throw queueRunError ??
        new Error("AI job authorization runs were not created.");
    const alphaQueueRun = queueRuns.find(
      (run) => run.organization_id === organizationA.id,
    );
    const betaQueueRun = queueRuns.find(
      (run) => run.organization_id === organizationB.id,
    );
    if (!alphaQueueRun || !betaQueueRun)
      throw new Error("AI job authorization runs could not be identified.");

    const foreignRunPrice = await admin
      .from("ai_runs")
      .update({
        estimated_cost: 0.01,
        estimated_cost_currency: "USD",
        model_price_id: betaModelPrice.id,
      })
      .eq("id", alphaQueueRun.id)
      .select("id");
    record(
      "database rejects a foreign-tenant model price on an AI run",
      Boolean(foreignRunPrice.error),
    );

    const queueDealId = randomUUID();
    const ownerQueueInsert = await owner.from("ai_jobs").insert({
      organization_id: organizationA.id,
      ai_run_id: alphaQueueRun.id,
      job_type: "lead_intake",
      payload: { workflow: "lead_intake", deal_id: queueDealId },
      idempotency_key: `browser:${randomUUID()}`,
    });
    record(
      "browser clients cannot enqueue AI jobs",
      Boolean(ownerQueueInsert.error),
    );

    const { data: adminQueueJob, error: adminQueueJobError } = await admin
      .from("ai_jobs")
      .insert({
        organization_id: organizationA.id,
        ai_run_id: alphaQueueRun.id,
        job_type: "lead_intake",
        payload: {
          workflow: "lead_intake",
          deal_id: queueDealId,
          prompt_version: "authz-fixture",
          provider: "glm",
        },
        idempotency_key: `authz:${randomUUID()}`,
        max_attempts: 3,
      })
      .select("id, status")
      .single();
    record(
      "server worker can enqueue a bounded same-tenant AI job",
      !adminQueueJobError &&
        Boolean(adminQueueJob?.id) &&
        adminQueueJob?.status === "queued",
    );
    if (adminQueueJobError || !adminQueueJob)
      throw adminQueueJobError ??
        new Error("AI job authorization fixture was not created.");

    const foreignQueueJob = await admin.from("ai_jobs").insert({
      organization_id: organizationA.id,
      ai_run_id: betaQueueRun.id,
      job_type: "itinerary_draft",
      payload: { workflow: "itinerary_draft", trip_id: randomUUID() },
      idempotency_key: `foreign:${randomUUID()}`,
    });
    record(
      "database rejects a foreign-tenant AI run link",
      Boolean(foreignQueueJob.error),
    );

    const ownerQueueRead = await owner
      .from("ai_jobs")
      .select("id, status")
      .eq("id", adminQueueJob.id);
    record(
      "active members can inspect their tenant AI job state",
      !ownerQueueRead.error && ownerQueueRead.data?.length === 1,
    );

    const viewerForeignQueueRead = await viewer
      .from("ai_jobs")
      .select("id")
      .eq("id", adminQueueJob.id);
    record(
      "foreign tenant cannot inspect another workspace AI job",
      !viewerForeignQueueRead.error &&
        viewerForeignQueueRead.data?.length === 0,
    );

    const ownerQueueUpdate = await owner
      .from("ai_jobs")
      .update({ status: "succeeded" })
      .eq("id", adminQueueJob.id)
      .select("id");
    record(
      "browser clients cannot mutate AI job execution state",
      Boolean(ownerQueueUpdate.error) ||
        ownerQueueUpdate.data?.length === 0,
    );

    const browserClaim = await owner.rpc("claim_ai_job", {
      target_job_id: adminQueueJob.id,
      target_worker_id: `browser:${randomUUID()}`,
    });
    record(
      "authenticated clients cannot execute the AI job claim function",
      Boolean(browserClaim.error),
    );

    const browserDeadLetter = await owner.rpc("dead_letter_ai_job", {
      target_job_id: adminQueueJob.id,
      target_worker_id: `browser:${randomUUID()}`,
      target_error_code: "BROWSER_FORBIDDEN",
    });
    record(
      "authenticated clients cannot dead-letter AI jobs",
      Boolean(browserDeadLetter.error),
    );

    const workerId = `authz:${randomUUID()}`;
    const firstClaim = await admin.rpc("claim_ai_job", {
      target_job_id: adminQueueJob.id,
      target_worker_id: workerId,
    });
    record(
      "server worker atomically claims an available AI job",
      !firstClaim.error &&
        firstClaim.data?.length === 1 &&
        firstClaim.data[0].job_attempts === 1,
    );

    const wrongWorkerSettlement = await admin.rpc("settle_ai_job", {
      target_job_id: adminQueueJob.id,
      target_worker_id: `wrong:${randomUUID()}`,
      target_succeeded: true,
      target_error_code: null,
      target_retry_delay_seconds: 0,
    });
    record(
      "a worker cannot settle another worker's AI job lease",
      !wrongWorkerSettlement.error &&
        wrongWorkerSettlement.data?.length === 0,
    );

    const retrySettlement = await admin.rpc("settle_ai_job", {
      target_job_id: adminQueueJob.id,
      target_worker_id: workerId,
      target_succeeded: false,
      target_error_code: "AUTHZ_TRANSIENT_FAILURE",
      target_retry_delay_seconds: 0,
    });
    record(
      "server worker schedules a bounded retry after failure",
      !retrySettlement.error &&
        retrySettlement.data?.length === 1 &&
        retrySettlement.data[0].job_status === "failed",
    );

    const retryWorkerId = `authz:${randomUUID()}`;
    const retryClaim = await admin.rpc("claim_ai_job", {
      target_job_id: adminQueueJob.id,
      target_worker_id: retryWorkerId,
    });
    record(
      "server worker can reclaim a retry when it becomes available",
      !retryClaim.error &&
        retryClaim.data?.length === 1 &&
        retryClaim.data[0].job_attempts === 2,
    );

    const successfulSettlement = await admin.rpc("settle_ai_job", {
      target_job_id: adminQueueJob.id,
      target_worker_id: retryWorkerId,
      target_succeeded: true,
      target_error_code: null,
      target_retry_delay_seconds: 0,
    });
    record(
      "server worker can durably complete an AI job",
      !successfulSettlement.error &&
        successfulSettlement.data?.length === 1 &&
        successfulSettlement.data[0].job_status === "succeeded",
    );

    const { data: permanentJob, error: permanentJobError } = await admin
      .from("ai_jobs")
      .insert({
        organization_id: organizationA.id,
        ai_run_id: alphaQueueRun.id,
        job_type: "lead_intake",
        payload: {
          workflow: "lead_intake",
          deal_id: queueDealId,
          prompt_version: "authz-fixture",
          provider: "glm",
        },
        idempotency_key: `dead-letter:${randomUUID()}`,
      })
      .select("id")
      .single();
    if (permanentJobError || !permanentJob)
      throw permanentJobError ??
        new Error("Permanent AI job fixture was not created.");
    const permanentWorkerId = `authz:${randomUUID()}`;
    const permanentClaim = await admin.rpc("claim_ai_job", {
      target_job_id: permanentJob.id,
      target_worker_id: permanentWorkerId,
    });
    if (permanentClaim.error || permanentClaim.data?.length !== 1)
      throw permanentClaim.error ??
        new Error("Permanent AI job fixture was not claimed.");
    const permanentSettlement = await admin.rpc("dead_letter_ai_job", {
      target_job_id: permanentJob.id,
      target_worker_id: permanentWorkerId,
      target_error_code: "AUTHZ_PERMANENT_FAILURE",
    });
    record(
      "server worker can dead-letter permanently unsafe work",
      !permanentSettlement.error &&
        permanentSettlement.data?.length === 1 &&
        permanentSettlement.data[0].job_status === "dead_letter",
    );
    const browserRequeue = await owner.rpc("requeue_ai_job", {
      target_job_id: permanentJob.id,
    });
    record(
      "authenticated clients cannot directly requeue dead-letter jobs",
      Boolean(browserRequeue.error),
    );
    const serverRequeue = await admin.rpc("requeue_ai_job", {
      target_job_id: permanentJob.id,
    });
    record(
      "server worker can requeue an explicitly reviewed dead letter",
      !serverRequeue.error &&
        serverRequeue.data?.length === 1 &&
        serverRequeue.data[0].job_status === "queued" &&
        serverRequeue.data[0].job_attempts === 0,
    );

    const documentPath = `${organizationA.id}/${randomUUID()}/fixture.pdf`;
    const ownerDocumentUpload = await owner.storage
      .from("travel-documents")
      .upload(documentPath, Buffer.from("%PDF-1.4 authorization fixture"), {
        contentType: "application/pdf",
        upsert: false,
      });
    if (!ownerDocumentUpload.error) storageObjectPaths.push(documentPath);
    record(
      "authorized owner can upload a tenant document",
      !ownerDocumentUpload.error,
    );

    const ownerDocumentRead = await owner.storage
      .from("travel-documents")
      .download(documentPath);
    record(
      "authorized owner can read a tenant document",
      !ownerDocumentRead.error,
    );

    const viewerForeignDocumentRead = await viewer.storage
      .from("travel-documents")
      .download(documentPath);
    record(
      "foreign tenant cannot read a document",
      Boolean(viewerForeignDocumentRead.error),
    );

    const viewerDocumentUpload = await viewer.storage
      .from("travel-documents")
      .upload(
        `${organizationB.id}/${randomUUID()}/blocked.pdf`,
        Buffer.from("%PDF-1.4 blocked viewer fixture"),
        { contentType: "application/pdf", upsert: false },
      );
    record(
      "viewer cannot upload tenant documents",
      Boolean(viewerDocumentUpload.error),
    );

    const ownerDocumentDelete = await owner.storage
      .from("travel-documents")
      .remove([documentPath]);
    const ownerDocumentStillPresent = await owner.storage
      .from("travel-documents")
      .download(documentPath);
    record(
      "browser clients cannot delete tenant documents",
      (Boolean(ownerDocumentDelete.error) ||
        (ownerDocumentDelete.data?.length ?? 0) === 0) &&
        !ownerDocumentStillPresent.error,
    );

    const viewerContactInsert = await viewer.from("contacts").insert({
      organization_id: organizationB.id,
      first_name: "Blocked viewer write",
    });
    record(
      "viewer cannot create contacts in its own tenant",
      Boolean(viewerContactInsert.error),
    );

    const viewerTaskInsert = await viewer.from("tasks").insert({
      organization_id: organizationB.id,
      title: "Blocked viewer task",
    });
    record(
      "viewer cannot create internal tasks",
      Boolean(viewerTaskInsert.error),
    );

    const viewerMembership = memberships.find(
      (membership) => membership.user_id === viewerUser.id,
    );
    const viewerEscalation = await viewer
      .from("memberships")
      .update({ role: "owner" })
      .eq("id", viewerMembership.id)
      .select("id");
    record(
      "viewer cannot escalate its membership role",
      Boolean(viewerEscalation.error) ||
        (viewerEscalation.data?.length ?? 0) === 0,
    );

    const viewerInvitation = await viewer
      .from("organization_invitations")
      .insert({
        organization_id: organizationB.id,
        email: `blocked-${suffix}@stateai.invalid`,
        role: "owner",
        invited_by: viewerUser.id,
        token_hash: "0".repeat(64),
      })
      .select("id");
    record(
      "viewer cannot create an owner invitation",
      Boolean(viewerInvitation.error) ||
        (viewerInvitation.data?.length ?? 0) === 0,
    );

    const organizationMove = await admin
      .from("contacts")
      .update({ organization_id: organizationB.id })
      .eq("id", alphaContact.id)
      .select("id");
    record(
      "tenant identity cannot be moved even by a privileged client",
      Boolean(organizationMove.error),
    );
  } finally {
    if (storageObjectPaths.length) {
      const { error } = await admin.storage
        .from("travel-documents")
        .remove(storageObjectPaths);
      if (error) cleanupSucceeded = false;
    }
    if (organizationIds.length) {
      const { error } = await admin
        .from("organizations")
        .delete()
        .in("id", organizationIds);
      if (error) cleanupSucceeded = false;
    }
    for (const userId of userIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) cleanupSucceeded = false;
    }
  }

  record("temporary authorization fixtures were removed", cleanupSucceeded);
  console.log(JSON.stringify({ checks }));
  if (checks.some((check) => !check.passed)) process.exitCode = 1;
}

verifyAuthorization().catch((error) => {
  console.error(
    JSON.stringify({
      phase: activeVerificationPhase,
      error:
        typeof error?.message === "string"
          ? error.message
          : "Authenticated authorization verification failed.",
      code: error?.code ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    }),
  );
  process.exitCode = 1;
});
