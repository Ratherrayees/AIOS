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
  "quote_approval_policies",
  "quote_line_items",
  "quote_line_costs",
  "quote_catalog_products",
  "quote_catalog_rates",
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
  "supplier_contacts",
  "supplier_contracts",
  "trips",
  "trip_status_history",
  "operational_exceptions",
  "operations_radar_policies",
  "operations_radar_runs",
  "travelers",
  "traveler_entry_checks",
  "itinerary_items",
  "bookings",
  "payments",
  "payment_allocations",
  "documents",
  "trip_portal_links",
  "trip_portal_documents",
  "itinerary_templates",
  "itinerary_template_items",
  "itinerary_comments",
  "organization_invitations",
  "saved_views",
  "analytics_targets",
  "message_templates",
  "message_drafts",
  "message_draft_reviews",
  "knowledge_sources",
  "knowledge_sections",
  "knowledge_conflicts",
  "analytics_report_schedules",
  "analytics_report_deliveries",
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
      .select("*", { count: "exact", head: true });
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
  const { error: anonymousPaymentCreateError } = await anonymous.rpc(
    "create_payment_obligation",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_direction: "receivable",
      target_title: "Blocked anonymous obligation",
      target_amount: 100,
      target_currency: "INR",
    },
  );
  const { error: anonymousPaymentAllocationError } = await anonymous.rpc(
    "record_payment_allocation",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_payment_id: "22222222-2222-4222-8222-222222222222",
      target_amount: 100,
      target_occurred_at: new Date().toISOString(),
      target_reference: "BLOCKED",
    },
  );
  const { error: anonymousPaymentVoidError } = await anonymous.rpc(
    "void_payment_obligation",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_payment_id: "22222222-2222-4222-8222-222222222222",
      target_reason: "Blocked anonymous request",
    },
  );
  const { error: anonymousPaymentRefreshError } = await anonymous.rpc(
    "refresh_payment_obligation_statuses",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
    },
  );
  const { error: anonymousDocumentClassificationError } = await anonymous.rpc(
    "classify_trip_document",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_trip_id: "22222222-2222-4222-8222-222222222222",
      target_document_id: "33333333-3333-4333-8333-333333333333",
      target_document_kind: "voucher",
    },
  );
  const { error: anonymousPortalPublishError } = await anonymous.rpc(
    "publish_traveler_portal",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_trip_id: "22222222-2222-4222-8222-222222222222",
      target_approval_id: "33333333-3333-4333-8333-333333333333",
      target_token_hash: "0".repeat(64),
    },
  );
  const { error: anonymousPortalRevokeError } = await anonymous.rpc(
    "revoke_traveler_portal",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_portal_link_id: "22222222-2222-4222-8222-222222222222",
      target_note: "Blocked anonymous request",
    },
  );
  const { error: anonymousPortalSnapshotError } = await anonymous.rpc(
    "get_traveler_portal_snapshot",
    { target_token_hash: "0".repeat(64) },
  );
  const { error: anonymousPortalDocumentError } = await anonymous.rpc(
    "get_traveler_portal_document",
    {
      target_token_hash: "0".repeat(64),
      target_document_id: "22222222-2222-4222-8222-222222222222",
    },
  );
  const { error: anonymousRadarPolicyError } = await anonymous.rpc(
    "upsert_operations_radar_policy",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_is_enabled: true,
      target_scan_interval_minutes: 60,
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
  const { error: anonymousRadarClaimError } = await anonymous.rpc(
    "claim_operations_radar_runs",
    {
      target_worker_id: "anonymous-worker-blocked",
      target_limit: 1,
    },
  );
  const { error: anonymousRadarSettleError } = await anonymous.rpc(
    "settle_operations_radar_run",
    {
      target_run_id: "11111111-1111-4111-8111-111111111111",
      target_worker_id: "anonymous-worker-blocked",
      target_status: "failed",
      target_error_code: "blocked",
    },
  );
  const { error: anonymousTravelerEntryCheckError } = await anonymous.rpc(
    "upsert_traveler_entry_check",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_trip_id: "22222222-2222-4222-8222-222222222222",
      target_traveler_id: "33333333-3333-4333-8333-333333333333",
      target_destination_country_code: "JP",
      target_citizenship_country_code: "IN",
      target_passport_validity_months_required: 6,
      target_visa_requirement: "unknown",
      target_visa_status: "unknown",
    },
  );
  const { error: anonymousKnowledgeSourceError } = await anonymous.rpc(
    "upsert_knowledge_source",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_title: "Blocked anonymous knowledge",
      target_source_kind: "sop",
      target_authority: "internal",
      target_sensitivity: "normal",
      target_version_label: "1",
    },
  );
  const { error: anonymousKnowledgeSectionError } = await anonymous.rpc(
    "add_knowledge_section",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_source_id: "22222222-2222-4222-8222-222222222222",
      target_heading: "Blocked section",
      target_content: "Anonymous users cannot curate knowledge.",
      target_citation_label: "Blocked citation",
      target_position: 0,
    },
  );
  const { error: anonymousKnowledgeTransitionError } = await anonymous.rpc(
    "transition_knowledge_source",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_source_id: "22222222-2222-4222-8222-222222222222",
      target_status: "in_review",
    },
  );
  const { error: anonymousKnowledgeRenewalError } = await anonymous.rpc(
    "renew_knowledge_source",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_source_id: "22222222-2222-4222-8222-222222222222",
      target_version_label: "2",
      target_review_due_on: "2027-07-29",
      target_valid_from: "2026-07-29",
    },
  );
  const { error: anonymousKnowledgeRevisionError } = await anonymous.rpc(
    "update_knowledge_section",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_source_id: "22222222-2222-4222-8222-222222222222",
      target_section_id: "33333333-3333-4333-8333-333333333333",
      target_heading: "Blocked revision",
      target_content: "Anonymous users cannot revise knowledge.",
      target_citation_label: "Blocked citation",
      target_position: 0,
    },
  );
  const { error: anonymousKnowledgeDeleteError } = await anonymous.rpc(
    "delete_knowledge_section",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_source_id: "22222222-2222-4222-8222-222222222222",
      target_section_id: "33333333-3333-4333-8333-333333333333",
    },
  );
  const { error: anonymousKnowledgeSearchError } = await anonymous.rpc(
    "search_approved_knowledge",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_query: "blocked retrieval",
      target_limit: 8,
    },
  );
  const { error: anonymousKnowledgeConflictScanError } = await anonymous.rpc(
    "scan_knowledge_conflicts",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
    },
  );
  const { error: anonymousKnowledgeConflictReviewError } =
    await anonymous.rpc("review_knowledge_conflict", {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_conflict_id: "22222222-2222-4222-8222-222222222222",
      target_status: "dismissed",
      target_resolution_note: "Blocked anonymous conflict review.",
    });
  const { error: anonymousKnowledgeTextImportError } = await anonymous.rpc(
    "import_knowledge_text_source",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_title: "Blocked anonymous import",
      target_source_kind: "sop",
      target_authority: "internal",
      target_sensitivity: "restricted",
      target_version_label: "1",
      target_file_name: "blocked.md",
      target_file_sha256: "0".repeat(64),
      target_byte_size: 16,
      target_sections: [
        {
          heading: "Blocked import",
          content: "Anonymous content.",
          citation_label: "Blocked import passage 1",
          position: 0,
        },
      ],
    },
  );
  const { error: anonymousAnalyticsTargetError } = await anonymous.rpc(
    "upsert_analytics_target",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_label: "Blocked anonymous target",
      target_currency: "INR",
      target_period_start: "2026-08-01",
      target_period_end: "2026-08-31",
      target_amount: 100000,
      target_is_active: true,
    },
  );
  const { error: anonymousReportScheduleError } = await anonymous.rpc(
    "upsert_analytics_report_schedule",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_is_enabled: true,
      target_cadence: "weekly",
      target_period_days: 30,
      target_forecast_horizon_days: 90,
      target_next_run_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  );
  const { error: anonymousReportClaimError } = await anonymous.rpc(
    "claim_analytics_report_runs",
    {
      target_worker_id: "anonymous-report-worker",
      target_limit: 1,
    },
  );
  const { error: anonymousReportSettleError } = await anonymous.rpc(
    "settle_analytics_report_run",
    {
      target_run_id: "11111111-1111-4111-8111-111111111111",
      target_worker_id: "anonymous-report-worker",
      target_status: "failed",
      target_error_code: "blocked",
    },
  );
  const { error: anonymousDraftReviewError } = await anonymous.rpc(
    "review_ai_message_draft",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_message_draft_id: "22222222-2222-4222-8222-222222222222",
      target_decision: "approved",
    },
  );
  const { error: anonymousCopilotQualityError } = await anonymous.rpc(
    "get_sales_copilot_quality_summary",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
    },
  );
  const { error: anonymousQuotePolicyError } = await anonymous.rpc(
    "upsert_quote_approval_policy",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_minimum_margin_percent: 20,
      target_require_cost_estimate: true,
      target_require_valid_until: true,
      target_maximum_validity_days: 45,
    },
  );
  const { error: anonymousStructuredQuoteError } = await anonymous.rpc(
    "append_structured_quote_version",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_quote_id: "22222222-2222-4222-8222-222222222222",
      target_items: [
        {
          category: "service",
          description: "Blocked anonymous line",
          quantity: 1,
          unit_price_amount: 100,
          unit_cost_amount: 75,
          discount_amount: 0,
          tax_percent: 0,
        },
      ],
    },
  );
  const { error: anonymousQuoteProposalError } = await anonymous.rpc(
    "append_quote_proposal_content_version",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_quote_id: "22222222-2222-4222-8222-222222222222",
      target_content: {
        schema_version: 1,
        inclusions: ["Blocked anonymous inclusion"],
        exclusions: [],
        terms: ["Blocked anonymous term"],
      },
    },
  );
  const { error: anonymousCatalogProductError } = await anonymous.rpc(
    "create_quote_catalog_product",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_supplier_id: null,
      target_category: "service",
      target_name: "Blocked product",
      target_description: "Blocked anonymous catalog product",
      target_unit_label: "unit",
      target_currency: "INR",
      target_unit_sell_amount: 100,
      target_unit_cost_amount: 75,
      target_tax_percent: 0,
      target_valid_from: "2026-08-01",
      target_valid_until: null,
    },
  );
  const { error: anonymousCatalogRateError } = await anonymous.rpc(
    "publish_quote_catalog_rate",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_product_id: "22222222-2222-4222-8222-222222222222",
      target_unit_sell_amount: 100,
      target_unit_cost_amount: 75,
      target_tax_percent: 0,
      target_valid_from: "2026-08-01",
      target_valid_until: null,
    },
  );
  const { error: anonymousCatalogStatusError } = await anonymous.rpc(
    "set_quote_catalog_product_status",
    {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      target_product_id: "22222222-2222-4222-8222-222222222222",
      target_status: "archived",
      target_reason: "Blocked anonymous lifecycle request",
    },
  );
  const rpcChecks = [
    {
      function: "create_quote_catalog_product",
      anonymousExecutionBlocked: Boolean(anonymousCatalogProductError),
      anonymousErrorCode: anonymousCatalogProductError?.code ?? null,
    },
    {
      function: "publish_quote_catalog_rate",
      anonymousExecutionBlocked: Boolean(anonymousCatalogRateError),
      anonymousErrorCode: anonymousCatalogRateError?.code ?? null,
    },
    {
      function: "set_quote_catalog_product_status",
      anonymousExecutionBlocked: Boolean(anonymousCatalogStatusError),
      anonymousErrorCode: anonymousCatalogStatusError?.code ?? null,
    },
    {
      function: "append_structured_quote_version",
      anonymousExecutionBlocked: Boolean(anonymousStructuredQuoteError),
      anonymousErrorCode: anonymousStructuredQuoteError?.code ?? null,
    },
    {
      function: "append_quote_proposal_content_version",
      anonymousExecutionBlocked: Boolean(anonymousQuoteProposalError),
      anonymousErrorCode: anonymousQuoteProposalError?.code ?? null,
    },
    {
      function: "upsert_quote_approval_policy",
      anonymousExecutionBlocked: Boolean(anonymousQuotePolicyError),
      anonymousErrorCode: anonymousQuotePolicyError?.code ?? null,
    },
    {
      function: "get_sales_copilot_quality_summary",
      anonymousExecutionBlocked: Boolean(anonymousCopilotQualityError),
      anonymousErrorCode: anonymousCopilotQualityError?.code ?? null,
    },
    {
      function: "review_ai_message_draft",
      anonymousExecutionBlocked: Boolean(anonymousDraftReviewError),
      anonymousErrorCode: anonymousDraftReviewError?.code ?? null,
    },
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
    {
      function: "create_payment_obligation",
      anonymousExecutionBlocked: Boolean(anonymousPaymentCreateError),
      anonymousErrorCode: anonymousPaymentCreateError?.code ?? null,
    },
    {
      function: "record_payment_allocation",
      anonymousExecutionBlocked: Boolean(anonymousPaymentAllocationError),
      anonymousErrorCode: anonymousPaymentAllocationError?.code ?? null,
    },
    {
      function: "void_payment_obligation",
      anonymousExecutionBlocked: Boolean(anonymousPaymentVoidError),
      anonymousErrorCode: anonymousPaymentVoidError?.code ?? null,
    },
    {
      function: "refresh_payment_obligation_statuses",
      anonymousExecutionBlocked: Boolean(anonymousPaymentRefreshError),
      anonymousErrorCode: anonymousPaymentRefreshError?.code ?? null,
    },
    {
      function: "classify_trip_document",
      anonymousExecutionBlocked: Boolean(
        anonymousDocumentClassificationError,
      ),
      anonymousErrorCode:
        anonymousDocumentClassificationError?.code ?? null,
    },
    {
      function: "publish_traveler_portal",
      anonymousExecutionBlocked: Boolean(anonymousPortalPublishError),
      anonymousErrorCode: anonymousPortalPublishError?.code ?? null,
    },
    {
      function: "revoke_traveler_portal",
      anonymousExecutionBlocked: Boolean(anonymousPortalRevokeError),
      anonymousErrorCode: anonymousPortalRevokeError?.code ?? null,
    },
    {
      function: "get_traveler_portal_snapshot",
      anonymousExecutionBlocked: Boolean(anonymousPortalSnapshotError),
      anonymousErrorCode: anonymousPortalSnapshotError?.code ?? null,
    },
    {
      function: "get_traveler_portal_document",
      anonymousExecutionBlocked: Boolean(anonymousPortalDocumentError),
      anonymousErrorCode: anonymousPortalDocumentError?.code ?? null,
    },
    {
      function: "upsert_operations_radar_policy",
      anonymousExecutionBlocked: Boolean(anonymousRadarPolicyError),
      anonymousErrorCode: anonymousRadarPolicyError?.code ?? null,
    },
    {
      function: "claim_operations_radar_runs",
      anonymousExecutionBlocked: Boolean(anonymousRadarClaimError),
      anonymousErrorCode: anonymousRadarClaimError?.code ?? null,
    },
    {
      function: "settle_operations_radar_run",
      anonymousExecutionBlocked: Boolean(anonymousRadarSettleError),
      anonymousErrorCode: anonymousRadarSettleError?.code ?? null,
    },
    {
      function: "upsert_traveler_entry_check",
      anonymousExecutionBlocked: Boolean(anonymousTravelerEntryCheckError),
      anonymousErrorCode: anonymousTravelerEntryCheckError?.code ?? null,
    },
    {
      function: "upsert_knowledge_source",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeSourceError),
      anonymousErrorCode: anonymousKnowledgeSourceError?.code ?? null,
    },
    {
      function: "add_knowledge_section",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeSectionError),
      anonymousErrorCode: anonymousKnowledgeSectionError?.code ?? null,
    },
    {
      function: "transition_knowledge_source",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeTransitionError),
      anonymousErrorCode: anonymousKnowledgeTransitionError?.code ?? null,
    },
    {
      function: "renew_knowledge_source",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeRenewalError),
      anonymousErrorCode: anonymousKnowledgeRenewalError?.code ?? null,
    },
    {
      function: "update_knowledge_section",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeRevisionError),
      anonymousErrorCode: anonymousKnowledgeRevisionError?.code ?? null,
    },
    {
      function: "delete_knowledge_section",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeDeleteError),
      anonymousErrorCode: anonymousKnowledgeDeleteError?.code ?? null,
    },
    {
      function: "search_approved_knowledge",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeSearchError),
      anonymousErrorCode: anonymousKnowledgeSearchError?.code ?? null,
    },
    {
      function: "scan_knowledge_conflicts",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeConflictScanError),
      anonymousErrorCode: anonymousKnowledgeConflictScanError?.code ?? null,
    },
    {
      function: "review_knowledge_conflict",
      anonymousExecutionBlocked: Boolean(
        anonymousKnowledgeConflictReviewError,
      ),
      anonymousErrorCode:
        anonymousKnowledgeConflictReviewError?.code ?? null,
    },
    {
      function: "import_knowledge_text_source",
      anonymousExecutionBlocked: Boolean(anonymousKnowledgeTextImportError),
      anonymousErrorCode: anonymousKnowledgeTextImportError?.code ?? null,
    },
    {
      function: "upsert_analytics_target",
      anonymousExecutionBlocked: Boolean(anonymousAnalyticsTargetError),
      anonymousErrorCode: anonymousAnalyticsTargetError?.code ?? null,
    },
    {
      function: "upsert_analytics_report_schedule",
      anonymousExecutionBlocked: Boolean(anonymousReportScheduleError),
      anonymousErrorCode: anonymousReportScheduleError?.code ?? null,
    },
    {
      function: "claim_analytics_report_runs",
      anonymousExecutionBlocked: Boolean(anonymousReportClaimError),
      anonymousErrorCode: anonymousReportClaimError?.code ?? null,
    },
    {
      function: "settle_analytics_report_run",
      anonymousExecutionBlocked: Boolean(anonymousReportSettleError),
      anonymousErrorCode: anonymousReportSettleError?.code ?? null,
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
