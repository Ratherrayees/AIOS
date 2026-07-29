/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes, randomUUID } = require("node:crypto");
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
