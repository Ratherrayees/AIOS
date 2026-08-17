# Environment setup

No environment value is required to compile the application. Live CRM and AIOS
work require a server-only `.env.local` in development and equivalent managed
secrets in each deployed environment. Start from `.env.example`; never copy a
development secret into production.

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
APP_BASE_URL=https://crm.example.com
SUPABASE_SECRET_KEY=
TENANT_INTEGRATION_ENCRYPTION_KEY=
AIOS_WORKER_SECRET=
EMAIL_INBOUND_WORKER_SECRET=
```

Rules:

- Keep `.env.local` out of version control.
- Set `APP_BASE_URL` to the deployment's canonical HTTPS origin. Production authentication emails fail closed when it is absent or malformed.
- The supplied Supabase secret key is stored as `SUPABASE_SECRET_KEY`; never expose it to the browser, client components, logs, or build output.
- `TENANT_INTEGRATION_ENCRYPTION_KEY` must decode to exactly 32 bytes and must be identical on every app and worker instance. Back it up before storing tenant credentials; changing it requires a credential-envelope migration.
- Tenant mail, payment, WhatsApp, and agency-owned model credentials are added by an owner/admin in **Settings → Integrations**. They are encrypted and never fall back to platform credentials.
- Platform email belongs in **Platform → Platform email** and uses `travel@lumierah.in`. Deployment-level Resend variables are a platform-only fallback, never an agency sender.
- Supabase Auth mail uses `AIOS <auth@lumierah.in>` and a separate authentication-only SMTP credential configured in the hosted Supabase project. It is not read from tenant integrations or the platform email vault. Locally, `supabase/config.toml` sends the same identity through Mailpit with a code-only signup template.
- The platform model router supports Groq → ZhiPuAI → NVIDIA NIM → OpenRouter → OpenAI → Anthropic → Gemini → Qwen, filtered by each workspace allow-list. Keep all keys server-only.
- `AIOS_WORKER_SECRET` protects the AI job, approval-escalation, Operations Radar, and management-report schedules. `EMAIL_INBOUND_WORKER_SECRET` protects tenant IMAP ingestion. Use independent high-entropy values.
- Use separate credentials for development, staging, and production.
- Run `npm run security:secrets` before committing or deploying.
- Run `npm run verify:deploy` against the deployment environment. It prints only missing names and external actions, never secret values.

## Authenticated browser verification

`RUN_AUTHENTICATED_E2E=true` enables the Playwright journey that creates a
temporary confirmed user and two tenant workspaces with the server-only
Supabase credential. Run it only against a development or dedicated test
project. The fixture is removed at the end of the suite; CI enables it only
when all three `TEST_SUPABASE_*` repository secrets are present.

On Docker Desktop, a database reset can occasionally restart Auth with a new
container address while the already-running local gateway still holds its old
DNS result. If Admin API calls return `502 Bad Gateway` after
`npx supabase db reset`, refresh only this project's gateway and rerun the
test:

```text
npm run local:supabase:refresh-gateway
```

The script derives the exact gateway container from `supabase/config.toml`,
verifies that it is running, and restarts only that container. It does not
enable Docker's TCP API, change the database, or affect another Supabase
project.

## Local Supabase analytics

Local Logflare analytics is intentionally disabled in `supabase/config.toml`. The database, Auth, REST, Realtime, Storage, Studio, and recovery/authorization tests do not depend on it. This avoids a Vector restart loop on Docker Desktop where the generated container otherwise expects an unauthenticated Docker Engine endpoint at `host.docker.internal:2375`.

Do not enable Docker's unauthenticated TCP API to make local log collection work. If local Logflare becomes necessary, use a supported authenticated/socket-based Docker connection, set `analytics.enabled = true`, and restart only this project's stack with `npx supabase stop` followed by `npx supabase start`. Supabase documents local analytics as optional and disabled by default.
