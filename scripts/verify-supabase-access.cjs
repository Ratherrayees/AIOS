/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const protectedTables = [
  "profiles",
  "organizations",
  "memberships",
  "contacts",
  "deals",
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
  ];

  console.log(JSON.stringify({ checks, rpcChecks }));
  if (
    checks.some(
      (check) => !check.adminCanRead || !check.anonymousRowsHidden,
    ) ||
    !rpcChecks[0].anonymousExecutionBlocked ||
    !rpcChecks[1].anonymousCannotSatisfy
  ) {
    process.exitCode = 1;
  }
}

verify().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
