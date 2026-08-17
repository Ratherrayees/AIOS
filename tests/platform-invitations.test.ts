import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260817104000_add_platform_operator_invitations.sql",
  "utf8",
);
const actions = readFileSync("app/actions/platform-invitations.ts", "utf8");
const templates = readFileSync("lib/email/templates.ts", "utf8");
const tokenContract = readFileSync(
  "lib/platform/operator-invitation-token.ts",
  "utf8",
);
const redeemRoute = readFileSync(
  "app/auth/platform-invite/redeem/route.ts",
  "utf8",
);
const invitationPage = readFileSync(
  "app/auth/platform-invite/page.tsx",
  "utf8",
);
const authorization = readFileSync("lib/platform/authorization.ts", "utf8");

test("platform invitation acceptance requires verified identity and strong MFA", () => {
  assert.match(migration, /email_confirmed_at/);
  assert.match(migration, /auth\.jwt\(\)\s*->>\s*'aal'.*'aal2'/s);
  assert.match(migration, /factor\.factor_type\s*=\s*'totp'/);
  assert.match(migration, /factor\.status\s*=\s*'verified'/);
  assert.match(migration, /invitation_record\.email\s*<>\s*accepting_email/);
  assert.match(migration, /issued_at_timestamp\s*<=\s*accepting_identity_control\.sessions_valid_after/);
  assert.match(migration, /administrator\.role\s*=\s*'superadmin'/);
  assert.match(migration, /administrator\.user_id\s*=\s*invitation_record\.invited_by/);
});

test("public invitation RPCs hash the raw bearer internally and reject stored hashes", () => {
  const snapshot = migration.slice(
    migration.indexOf("create or replace function public.get_platform_operator_invitation_snapshot"),
    migration.indexOf("create or replace function public.accept_platform_operator_invitation"),
  );
  const acceptance = migration.slice(
    migration.indexOf("create or replace function public.accept_platform_operator_invitation"),
    migration.indexOf("revoke all on function public.create_platform_operator_invitation_service"),
  );
  assert.match(snapshot, /extensions\.digest\(convert_to\(invitation_token_hash, 'UTF8'\), 'sha256'\)/);
  assert.match(acceptance, /extensions\.digest\(convert_to\(invitation_token_hash, 'UTF8'\), 'sha256'\)/);
  assert.match(snapshot, /\^\[A-Za-z0-9_-\]\{43\}\$/);
  assert.match(acceptance, /\^\[A-Za-z0-9_-\]\{43\}\$/);
  assert.doesNotMatch(snapshot, /where invitation\.token_hash\s*=\s*invitation_token_hash/);
  assert.doesNotMatch(acceptance, /where invitation\.token_hash\s*=\s*invitation_token_hash/);
  assert.match(actions, /get_platform_operator_invitation_snapshot[\s\S]*?invitation_token_hash: token/);
  assert.match(actions, /accept_platform_operator_invitation[\s\S]*?invitation_token_hash: token/);
});

test("platform invitation acceptance cannot create tenant authority", () => {
  const acceptance = migration.slice(
    migration.indexOf("create or replace function public.accept_platform_operator_invitation"),
    migration.indexOf("revoke all on function public.create_platform_operator_invitation_service"),
  );
  assert.match(acceptance, /insert into public\.platform_admins/);
  assert.doesNotMatch(acceptance, /insert into public\.(?:organizations|memberships)/);
  assert.match(acceptance, /platform\.operator_invitation\.accepted/);
  assert.match(acceptance, /'access\.granted'/);
});

test("platform invitation management is service-only, versioned, and reasoned", () => {
  for (const functionName of [
    "create_platform_operator_invitation_service",
    "resend_platform_operator_invitation_service",
    "revoke_platform_operator_invitation_service",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?authenticated`),
    );
  }
  assert.match(migration, /expected_version bigint/);
  assert.match(migration, /char_length\(normalized_reason\).*500/s);
  assert.match(migration, /token_hash text not null unique/);
});

test("operator invitation notice uses the platform lane and never a tenant sender", () => {
  const start = templates.indexOf("export async function sendPlatformOperatorInvitationEmail");
  const operatorTemplate = templates.slice(start);
  assert.ok(start >= 0);
  assert.match(operatorTemplate, /sendTransactionalEmail\(\{/);
  assert.doesNotMatch(operatorTemplate, /organizationId\s*:/);
  assert.match(operatorTemplate, /platform-operator-invite/);
  assert.match(actions, /\/auth\/platform-invite\/redeem\?token=/);
});

test("invite capture scrubs the URL into a short-lived HttpOnly cookie", () => {
  assert.match(redeemRoute, /NextResponse\.redirect\(destination, 303\)/);
  assert.match(redeemRoute, /new URL\("\/auth\/platform-invite", request\.url\)/);
  assert.match(redeemRoute, /hashPlatformOperatorInvitationToken\(token\)/);
  assert.match(redeemRoute, /response\.cookies\.set/);
  assert.match(tokenContract, /httpOnly: true/);
  assert.match(tokenContract, /sameSite: "lax"/);
  assert.match(tokenContract, /path: "\/auth\/platform-invite"/);
  assert.match(tokenContract, /maxAge: 30 \* 60/);
  assert.doesNotMatch(invitationPage, /searchParams: Promise<\{ token\?: string \}>/);
  assert.doesNotMatch(invitationPage, /PlatformInviteAcceptance token=/);
});

test("platform authorization revalidates session state and current TOTP enrollment", () => {
  assert.match(authorization, /identity_security_controls/);
  assert.match(authorization, /issuedAt \* 1_000 <= sessionsValidAfter/);
  assert.match(authorization, /admin\.auth\.admin\.mfa\.listFactors/);
  assert.match(authorization, /factor\.factor_type === "totp" && factor\.status === "verified"/);
});

test("invitation and direct-access audit evidence retain actor snapshots", () => {
  const directMigration = readFileSync(
    "supabase/migrations/20260817103000_harden_platform_access_mutations.sql",
    "utf8",
  );
  assert.match(directMigration, /private\.platform_actor_snapshot\(actor_id\)/);
  assert.match(directMigration, /'actorUserId'/);
  assert.match(directMigration, /'actorName'/);
  assert.match(directMigration, /'actorEmail'/);
  assert.match(migration, /private\.platform_actor_snapshot\(actor_id\)/);
  assert.match(migration, /private\.platform_actor_snapshot\(accepting_user_id\)/);
  assert.match(migration, /private\.platform_actor_snapshot\(invitation_record\.invited_by\)/);
});

test("server mutation contracts require exact confirmation and bounded expiry", () => {
  assert.match(actions, /confirmation: z\.string\(\)\.trim\(\)\.toLowerCase\(\)\.email\(\)\.max\(320\)/);
  assert.match(actions, /expiresInDays: z\.number\(\)\.int\(\)\.min\(1\)\.max\(14\)\.default\(7\)/);
  assert.match(actions, /requirePlatformCapability\("platform\.access\.manage", \{[\s\S]*?mfa: true/);
});
