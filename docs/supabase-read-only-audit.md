# Hosted Supabase read-only audit

Reviewed: 29 July 2026

## Scope

This was a read-only review of the configured AIOS hosted database through its session-mode connection. No project was linked, no migration was pushed, and no hosted setting or data was changed.

The Supabase CLI management identity available on this machine does not list the AIOS project, so the dashboard Security and Performance Advisor feeds could not be collected. The database connection itself was sufficient for schema lint, migration-history comparison, table statistics, and index statistics.

## Results

- Remote `public` schema lint returned zero errors or warnings.
- Local migration history now contains 78 migrations; the hosted database had applied 57 at the read-only checkpoint.
- Nineteen migrations are pending remotely, from `20260728082547` through `20260801140000`.
- The pending set contains the newer operations, traveler-entry, supplier/finance, portal, knowledge, analytics-target, management-report, provider-fallback, Sales Copilot provenance/review/calibration, quote commercial guardrails, structured sell/tax/cost lines, and related hardening work already verified locally.
- Hosted table statistics are fixture-scale: the largest estimated application-table row count observed was only 12, and most tables held zero or one row.
- Many indexes therefore report zero scans. This is expected at the current scale and is not evidence that those indexes are safe to remove.

## Decision

The hosted database is not the release-candidate schema and must not be treated as staging acceptance evidence. Keep the current indexes until representative workload telemetry exists.

Before wider testing:

1. rotate the credentials previously exposed during setup;
2. take and verify a recoverable backup;
3. deploy the 21 pending migrations to a dedicated staging project, not directly to production;
4. regenerate and compare types, rerun schema lint, anonymous access probes, authenticated authorization tests, webhook checks, and browser journeys against staging;
5. connect the correct Supabase management identity or export the dashboard Security and Performance Advisor results;
6. review any advisor finding against the staged schema and representative query workload before changing indexes or policies.

The direct database review found no schema-lint defect requiring a local migration in this checkpoint. Dashboard/control-plane advisor access and staged deployment remain external release gates.
