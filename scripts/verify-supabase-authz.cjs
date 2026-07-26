/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { createClient } = require("@supabase/supabase-js");

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
    const createdUsers = [];
    for (const label of ["owner", "viewer"]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `aios-authz-${label}-${suffix}@stateai.invalid`,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Authorization ${label}` },
      });
      if (error || !data.user)
        throw error ?? new Error("Temporary authorization user was not created.");
      createdUsers.push(data.user);
      userIds.push(data.user.id);
    }

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
        allowed_model_providers: ["glm", "qwen"],
        updated_by: ownerUser.id,
      })
      .eq("id", ownerBudgetPolicy.data?.id ?? randomUUID())
      .select("id, selected_model_provider, allowed_model_providers");
    record(
      "authorized owner can select an allowed workspace model provider",
      !ownerProviderPolicy.error &&
        ownerProviderPolicy.data?.length === 1 &&
        ownerProviderPolicy.data[0].selected_model_provider === "qwen" &&
        ownerProviderPolicy.data[0].allowed_model_providers.length === 2,
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
  console.error(error.message || "Authenticated authorization verification failed.");
  process.exitCode = 1;
});
