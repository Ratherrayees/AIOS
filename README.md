# AIOS Travel CRM

AIOS is a secure, agentic travel CRM for travel teams. The application includes a product prototype plus the first production foundation: security headers, typed Supabase adapters, tenant-isolated migration, authorization helpers, audit contracts, and a health endpoint.

## Local development

```bash
npm install
npm run dev
```

The interface and static build run without environment values. Authentication and database-backed features become active only after the Supabase values documented in [`docs/environment.md`](docs/environment.md) are added.

## Verification

```bash
npm run lint
npm run security:secrets
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
npm run test:e2e        # public-route browser suite
npm run test:webhook    # signed local contract; requires build + local Supabase
npm run test:load       # bounded local production smoke; requires build + local Supabase
npm run test:restore    # isolated native backup/restore; requires local Supabase
npm run verify:supabase # requires a configured local .env.local
npm run verify:authz    # creates and removes isolated test fixtures
npm run verify:deploy   # production env and external release checklist
npm run db:types        # requires the local Supabase stack
npm run local:supabase:refresh-gateway # repairs stale Docker DNS after a reset
```

Create or refresh realistic, idempotent development fixtures with
`npm run seed:mvp-demo`. The seed is marked `[DEMO]`, stays inside the selected
development tenant, and can be run repeatedly without multiplying records.

Set `RUN_AUTHENTICATED_E2E=true` for the browser suite to create a disposable
confirmed user, two isolated workspaces, and representative CRM records through
the Supabase Admin API. The suite removes those fixtures when it finishes. Use
only a development or dedicated test project.

Security and operations references:

- `docs/security-threat-model.md`
- `docs/credential-rotation.md`
- `docs/database-recovery.md`
- `docs/database-seeding.md`
- `docs/load-testing.md`
- `docs/supabase-read-only-audit.md`

## Architecture

- `app/` — Next.js routes and user experience
- `lib/` — security, authorization, environment, audit, and Supabase access helpers
- `supabase/migrations/` — database schema and row-level security policies
- `types/` — CLI-generated database types plus narrow application overrides for generator limitations
- `plan.md` — full 20-phase delivery plan

## Security rules

- Never commit `.env.local` or service-role credentials.
- Never use the service-role key in a browser component.
- Every tenant-owned table must have RLS enabled and tested.
- AIOS requires approval for customer-facing messages, price changes, bookings, payments/refunds, and sensitive document sharing.
- All direct dependencies are pinned to reviewed versions; use `npm install --save-exact` for intentional upgrades.
