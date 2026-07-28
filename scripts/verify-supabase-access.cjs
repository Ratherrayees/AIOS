/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const protectedTables = [
  "profiles",
  "organizations",
  "memberships",
  "contacts",
  "deals",
  "deal_stage_history",
  "qualification_checklist_templates",
  "qualification_checklist_items",
  "deal_qualification_checks",
  "follow_up_sequences",
  "follow_up_sequence_steps",
  "deal_follow_up_sequence_runs",
  "lead_capture_forms",
  "lead_submissions",
  "tasks",
  "quotes",
  "quote_versions",
  "quote_cost_estimates",
  "conversations",
  "messages",
  "approval_requests",
  "ai_runs",
  "ai_jobs",
  "ai_tool_calls",
  "audit_events",
  "email_webhook_events",
  "ai_autonomy_policies",
  "ai_budget_policies",
  "ai_model_prices",
  "ai_field_reviews",
  "companies",
  "activity_events",
  "suppliers",
  "trips",
  "trip_status_history",
  "operational_exceptions",
  "travelers",
  "itinerary_items",
  "bookings",
  "payments",
  "documents",
  "itinerary_templates",
  "itinerary_template_items",
  "itinerary_comments",
  "organization_invitations",
  "saved_views",
  "message_templates",
  "message_drafts",
];

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

async function readTableCount(client, table, attempts = 3) {
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await client
      .from(table)
      .select("id", { count: "exact", head: true });
    if (!result.error) return { ...result, attempts: attempt };
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  return { ...result, attempts };
}

async function verify() {
  const env = loadLocalEnv();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, options);
  const anonymous = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  );

  const checks = await Promise.all(
    protectedTables.map(async (table) => {
      const [adminResult, anonymousResult] = await Promise.all([
        readTableCount(admin, table),
        readTableCount(anonymous, table),
      ]);
      const anonymousRowsHidden =
        Boolean(anonymousResult.error) ||
        anonymousResult.count === null ||
        anonymousResult.count === 0;

      return {
        table,
        adminCanRead: !adminResult.error,
        adminAttempts: adminResult.attempts,
        adminRowCount: adminResult.count,
        adminErrorCode: adminResult.error?.code ?? null,
        adminErrorMessage: adminResult.error?.message ?? null,
        anonymousRowsHidden,
        anonymousAttempts: anonymousResult.attempts,
        anonymousRowCount: anonymousResult.count,
        anonymousErrorCode: anonymousResult.error?.code ?? null,
      };
    }),
  );

  const { error: anonymousInvitationAcceptanceError } = await anonymous.rpc(
    "accept_organization_invitation",
    { invitation_token_hash: "0".repeat(64) },
  );
  const {
    data: anonymousMfaResult,
    error: anonymousMfaError,
  } = await anonymous.rpc("meets_mfa_requirement");
  const { error: anonymousLeadCaptureError } = await anonymous.rpc(
    "capture_public_lead",
    {
      target_form_token: "11111111-1111-4111-8111-111111111111",
      target_full_name: "Blocked anonymous RPC",
      target_email: "blocked@example.invalid",
      target_phone: null,
      target_destination: null,
      target_budget_amount: null,
      target_currency: "INR",
      target_notes: null,
      target_communication_consent: false,
      target_utm_source: null,
      target_utm_medium: null,
      target_utm_campaign: null,
      target_landing_path: null,
      target_referrer_host: null,
      target_dedupe_key: "0".repeat(64),
      target_request_fingerprint: "1".repeat(64),
    },
  );
  const { error: anonymousTravelDocumentError } = await anonymous.rpc(
    "record_travel_document",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_deal_id: "22222222-2222-4222-8222-222222222222",
      target_contact_id: "33333333-3333-4333-8333-333333333333",
      target_document_id: "44444444-4444-4444-8444-444444444444",
      target_storage_path:
        "11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444/blocked.pdf",
      target_file_name: "blocked.pdf",
      target_mime_type: "application/pdf",
      target_byte_size: 10,
    },
  );
  const { error: anonymousTripConversionError } = await anonymous.rpc(
    "convert_won_deal_to_trip",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_deal_id: "22222222-2222-4222-8222-222222222222",
    },
  );
  const { error: anonymousTripTransitionError } = await anonymous.rpc(
    "transition_trip_status",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_trip_id: "22222222-2222-4222-8222-222222222222",
      target_status: "confirmed",
    },
  );
  const { error: anonymousTripDocumentError } = await anonymous.rpc(
    "record_trip_document",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_trip_id: "22222222-2222-4222-8222-222222222222",
      target_document_id: "33333333-3333-4333-8333-333333333333",
      target_storage_path:
        "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/blocked.pdf",
      target_file_name: "blocked.pdf",
      target_mime_type: "application/pdf",
      target_byte_size: 10,
    },
  );
  const { error: anonymousBookingTransitionError } = await anonymous.rpc(
    "transition_booking_status",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_trip_id: "22222222-2222-4222-8222-222222222222",
      target_booking_id: "33333333-3333-4333-8333-333333333333",
      target_status: "requested",
    },
  );
  const { error: anonymousOperationsRadarError } = await anonymous.rpc(
    "refresh_operational_exceptions",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
    },
  );
  const { error: anonymousExceptionStatusError } = await anonymous.rpc(
    "set_operational_exception_status",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_exception_id: "22222222-2222-4222-8222-222222222222",
      target_status: "acknowledged",
    },
  );
  const { error: anonymousQualificationApplyError } = await anonymous.rpc(
    "apply_qualification_checklist",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_deal_id: "22222222-2222-4222-8222-222222222222",
      target_template_id: "33333333-3333-4333-8333-333333333333",
    },
  );
  const { error: anonymousSequenceApplyError } = await anonymous.rpc(
    "apply_follow_up_sequence",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_deal_id: "22222222-2222-4222-8222-222222222222",
      target_sequence_id: "33333333-3333-4333-8333-333333333333",
    },
  );
  const rpcChecks = [
    {
      function: "accept_organization_invitation",
      anonymousExecutionBlocked: Boolean(anonymousInvitationAcceptanceError),
      anonymousErrorCode: anonymousInvitationAcceptanceError?.code ?? null,
    },
    {
      function: "meets_mfa_requirement",
      anonymousCannotSatisfy:
        Boolean(anonymousMfaError) || anonymousMfaResult !== true,
      anonymousResult: anonymousMfaResult ?? null,
      anonymousErrorCode: anonymousMfaError?.code ?? null,
    },
    {
      function: "capture_public_lead",
      anonymousExecutionBlocked: Boolean(anonymousLeadCaptureError),
      anonymousErrorCode: anonymousLeadCaptureError?.code ?? null,
    },
    {
      function: "record_travel_document",
      anonymousExecutionBlocked: Boolean(anonymousTravelDocumentError),
      anonymousErrorCode: anonymousTravelDocumentError?.code ?? null,
    },
    {
      function: "convert_won_deal_to_trip",
      anonymousExecutionBlocked: Boolean(anonymousTripConversionError),
      anonymousErrorCode: anonymousTripConversionError?.code ?? null,
    },
    {
      function: "transition_trip_status",
      anonymousExecutionBlocked: Boolean(anonymousTripTransitionError),
      anonymousErrorCode: anonymousTripTransitionError?.code ?? null,
    },
    {
      function: "record_trip_document",
      anonymousExecutionBlocked: Boolean(anonymousTripDocumentError),
      anonymousErrorCode: anonymousTripDocumentError?.code ?? null,
    },
    {
      function: "transition_booking_status",
      anonymousExecutionBlocked: Boolean(anonymousBookingTransitionError),
      anonymousErrorCode: anonymousBookingTransitionError?.code ?? null,
    },
    {
      function: "refresh_operational_exceptions",
      anonymousExecutionBlocked: Boolean(anonymousOperationsRadarError),
      anonymousErrorCode: anonymousOperationsRadarError?.code ?? null,
    },
    {
      function: "set_operational_exception_status",
      anonymousExecutionBlocked: Boolean(anonymousExceptionStatusError),
      anonymousErrorCode: anonymousExceptionStatusError?.code ?? null,
    },
    {
      function: "apply_qualification_checklist",
      anonymousExecutionBlocked: Boolean(anonymousQualificationApplyError),
      anonymousErrorCode: anonymousQualificationApplyError?.code ?? null,
    },
    {
      function: "apply_follow_up_sequence",
      anonymousExecutionBlocked: Boolean(anonymousSequenceApplyError),
      anonymousErrorCode: anonymousSequenceApplyError?.code ?? null,
    },
  ];

  console.log(JSON.stringify({ checks, rpcChecks }));
  if (
    checks.some(
      (check) => !check.adminCanRead || !check.anonymousRowsHidden,
    ) ||
    rpcChecks.some(
      (check) =>
        ("anonymousExecutionBlocked" in check &&
          !check.anonymousExecutionBlocked) ||
        ("anonymousCannotSatisfy" in check && !check.anonymousCannotSatisfy),
    )
  ) {
    process.exitCode = 1;
  }
}

verify().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
