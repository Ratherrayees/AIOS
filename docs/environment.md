# Environment setup

No environment value is required to build the current application. Before Phase 04 authentication and live Supabase data are enabled, create a local `.env.local` file containing the deployment values for:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
APP_BASE_URL=https://travel.stateai.in
SUPABASE_SECRET_KEY=
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
RESEND_FROM_EMAIL=AIOS Travel <hello@travel.stateai.in>
RESEND_REPLY_TO_EMAIL=travel@stateai.in
```

Rules:

- Keep `.env.local` out of version control.
- Set `APP_BASE_URL` to the deployment's canonical HTTPS origin. Production authentication emails fail closed when it is absent or malformed.
- The supplied Supabase secret key is stored as `SUPABASE_SECRET_KEY`; never expose it to the browser, client components, logs, or build output.
- Add payment, mail, AI-provider, and integration credentials only when their phases begin. Each requires server-only validation, least-privilege scopes, and secret rotation ownership.
- `RESEND_API_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_`, expose it in a client component, or paste it into a browser console.
- Use a dedicated verified sender subdomain for production mail (recommended: `travel.stateai.in` or `auth.stateai.in`) and update `RESEND_FROM_EMAIL` to match it.
- Use separate credentials for development, staging, and production.
- Run `npm run security:secrets` before committing or deploying.

## Authenticated browser verification

`RUN_AUTHENTICATED_E2E=true` enables the Playwright journey that creates a
temporary confirmed user and two tenant workspaces with the server-only
Supabase credential. Run it only against a development or dedicated test
project. The fixture is removed at the end of the suite; CI enables it only
when all three `TEST_SUPABASE_*` repository secrets are present.
