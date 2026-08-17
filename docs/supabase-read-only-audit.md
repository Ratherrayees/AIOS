# Hosted Supabase read-only audit

Reviewed: 29 July 2026

## Scope

This was a read-only review of the configured AIOS hosted database through its session-mode connection. No project was linked, no migration was pushed, and no hosted setting or data was changed.

The Supabase CLI management identity available on this machine does not list the AIOS project, so the dashboard Security and Performance Advisor feeds could not be collected. The database connection itself was sufficient for schema lint, migration-history comparison, table statistics, and index statistics.

## Results

- Remote `public` schema lint returned zero errors or warnings.
- Local migration history now contains 80 migrations; the hosted database had applied 57 at the read-only checkpoint.
- Twenty-three migrations are pending remotely, from `20260728082547` through `20260801180000`.
- The repository has since advanced to 90 local migrations through `20260801280000`. If the hosted project is still at the 57-migration checkpoint, the inferred staging delta is now 33 migrations; re-read the hosted history before deploying rather than treating that inference as current remote evidence.
- The pending set contains the newer operations, traveler-entry, supplier/finance, portal, knowledge, analytics-target, management-report, provider-fallback, Sales Copilot provenance/review/calibration, quote commercial guardrails, structured sell/tax/cost lines, reusable rate catalog, immutable proposal content, approval-gated public proposal links, granular discount/non-standard-term policy, governed invoice/PDF/payment-request evidence, sandbox provider execution, immutable provider-event reconciliation evidence, and related hardening work already verified locally.
- Hosted table statistics are fixture-scale: the largest estimated application-table row count observed was only 12, and most tables held zero or one row.
- Many indexes therefore report zero scans. This is expected at the current scale and is not evidence that those indexes are safe to remove.

## Decision

The hosted database is not the release-candidate schema and must not be treated as staging acceptance evidence. Keep the current indexes until representative workload telemetry exists.

Before wider testing:

1. rotate the credentials previously exposed during setup;
2. take and verify a recoverable backup;
3. re-read hosted migration history, then deploy the confirmed pending set to a dedicated staging project, not directly to production;
4. regenerate and compare types, rerun schema lint, anonymous access probes, authenticated authorization tests, webhook checks, and browser journeys against staging;
5. connect the correct Supabase management identity or export the dashboard Security and Performance Advisor results;
6. review any advisor finding against the staged schema and representative query workload before changing indexes or policies.

The direct database review found no schema-lint defect requiring a local migration in this checkpoint. Dashboard/control-plane advisor access and staged deployment remain external release gates.

## Current status update — 10 August 2026

The hosted project is now synchronized through migration `20260810170000` (96 migrations). The current public surface has 81 RLS-protected application tables and 68 guarded anonymous RPC probes; all pass, alongside 457 disposable authenticated authorization assertions. A zero-state local replay, zero-finding schema lint, and native 96-migration restore drill with exact 81-table/189-policy/443-index/92-function parity also pass. The latest migrations add a race-safe overdue human-approval escalation ledger and service-only sweep without granting approval or execution authority, make resolution re-check current action-specific role policy as well as tenant, MFA, assignment, and finance restrictions, and atomically link each escalation to one deduplicated assignee-scoped internal task that completes with the approval lifecycle. The July fixture-scale index observations remain historical evidence only; a current dashboard Security/Performance Advisor export, representative workload review, and hosted staging/PITR/Storage recovery drill are still required before production.

## Tenant integration update — 11 August 2026

Migration `20260811090000_add_tenant_integration_vault.sql` was applied to the hosted project through its session-mode migration connection, bringing the hosted history to 97 migrations and the protected surface to 82 tables. `organization_integrations` grants no browser Data API access: only the server service role can access encrypted envelopes after the calling Server Action re-authorizes an owner/admin membership. The current anonymous table/RPC probe passes, and the disposable authenticated suite now passes 459 assertions including explicit denial of owner-session ciphertext reads and writes. Hosted TypeScript definitions were regenerated through a direct metadata connection and compile cleanly. The Docker-dependent local zero-state replay, schema lint, and native restore drill were not repeated at this checkpoint because Docker Desktop was unavailable; the last complete local recovery evidence remains the 96-migration/81-table checkpoint above.

## Integrations presentation refactor verification — 11 August 2026

The compact Integrations overview, provider drawer, canonical connection states, and configuration-only provider enforcement required no schema or data migration. After the refactor, the hosted 82-table/68-RPC access verifier and all 459 disposable authenticated authorization assertions pass unchanged. Browser clients still cannot read or write integration ciphertext, and provider activation remains an owner/admin server transition. Stripe, Razorpay, and WhatsApp now additionally fail closed at the Server Action boundary if a crafted request attempts to mark their configuration active before the corresponding execution adapter is released.
