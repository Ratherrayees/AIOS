# Email and platform-administration architecture

## Authority boundaries

- Agency email is tenant-owned. Each agency configures its own Resend account or custom mail server in **Settings → Integrations**.
- Tenant outbound messages never fall back to platform credentials. A missing or disabled tenant provider fails closed.
- Platform email is configured separately by an active `superadmin` or `platform_admin` under **Platform → Platform email**. Its fixed sender identity is `travel@lumierah.in`.
- A platform role is not a tenant membership and does not bypass organization row-level security.
- Supabase Auth SMTP is a deployment-owned identity service with the fixed sender `AIOS <auth@lumierah.in>`. It is separate from platform and tenant CRM mail and is never configured by an agency.

## Authentication email

- Signup calls Supabase Auth, stores only a short-lived pending email and safe return path in an HttpOnly cookie, and sends the user to `/auth/verify-email`.
- Supabase's **Confirm signup** template contains the six-digit `{{ .Token }}` only. The in-app form verifies it as type `signup`; it does not consume a confirmation link.
- The code expires after 600 seconds. Resend is unavailable for the first 60 seconds, provider rate limits remain authoritative, and provider details are collapsed into safe invalid, retry-later, or delivery messages.
- Successful verification establishes the Supabase session and then resolves the existing safe post-auth destination. The OTP grants no tenant membership and no platform role; invitation acceptance and onboarding apply their own authorization rules afterward.
- Custom agency and platform-owner invitation links continue to preserve their validated return path through signup. Password recovery remains link-based through `/auth/callback` and `/update-password`.
- A platform-operator invitation notice is sent only through the platform transactional sender (`travel@lumierah.in`). If the invitee is unregistered, the subsequent six-digit identity OTP is still delivered by Supabase Auth (`auth@lumierah.in`). Tenant email credentials are never used by either step.
- Supabase Auth SMTP credentials belong only in the hosted Supabase project. They do not belong in **Settings → Integrations**, **Platform → Platform email**, or a browser-exposed environment variable.

## Tenant outbound flow

1. A team member prepares an email draft in Inbox.
2. AI-authored drafts require approval of the exact current draft revision.
3. **Request send approval** creates a durable external-action approval tied to the recipient, subject, revision timestamp, and body digest.
4. An authorized human approves the request.
5. The server revalidates the immutable evidence, sends through the agency's enabled provider, and atomically records the outbound Inbox message and delivery evidence.
6. Failures remain visible without pretending the message was sent. Resend receives a stable idempotency key; SMTP receives a stable Message-ID.

Outbound delivery is enabled from **Settings → Integrations**: connect Resend or Custom email server, save and verify it, then select **Enable email delivery**.

## Tenant inbound flow

### Resend

- The agency configures its inbound address/domain and enables inbound mail in its Resend integration.
- The UI supplies a tenant-specific webhook path: `/api/webhooks/email/resend/{routeKey}`.
- Resend sends `email.received`; the route verifies the raw signed payload using that tenant's signing secret.
- The server retrieves the full message using the tenant's Resend API key and ingests bounded plain text. Attachment metadata is retained, but attachment bytes are not imported in this release.

### Custom mail server

- SMTP is outbound-only. Incoming custom-server mail uses IMAP.
- The agency configures IMAP host, port, TLS mode, username, mailbox, address, and a write-only IMAP password.
- A protected deployment scheduler calls `/api/internal/email/inbound` with `EMAIL_INBOUND_WORKER_SECRET`.
- The worker processes bounded batches, starts at the current mailbox end on first connection, checkpoints UID progress, and ingests only new messages.

Both paths use an idempotent service-only database function. It matches or creates the tenant contact, reuses a deterministic sender/subject conversation, writes the inbound message, and records content-free audit evidence. Raw provider envelopes and mailbox checkpoints are not readable through browser sessions.

## Platform email

`/platform/email` stores platform Resend or SMTP credentials in a separate encrypted platform vault. It is intended for platform notices and platform administration only. It is never used for agency customer communication.

Platform operator invitation links enter through `/auth/platform-invite/redeem`, validate the stored SHA-256 digest, exchange the raw bearer into a 30-minute path-scoped HttpOnly cookie, and redirect immediately to tokenless `/auth/platform-invite`. Public RPCs hash the raw bearer internally and reject the stored digest as a credential. The preview reveals only a masked address, invited role, status, and expiry; activation requires matching verified email, a currently verified TOTP factor, AAL2, a session issued after the account cutoff, and a still-authorized inviting superadmin. The acceptance transaction creates platform authority only and never creates an agency or tenant membership.

## Deployment checklist

- Configure and verify the platform `lumierah.in` sender account.
- Verify `auth@lumierah.in`, provision a dedicated authentication-only SMTP credential, and configure hosted Supabase Auth SMTP with sender `AIOS <auth@lumierah.in>`.
- Replace the hosted **Confirm signup** template with the code-only `{{ .Token }}` template; set OTP length to 6, expiry to 600 seconds, and resend minimum to 60 seconds.
- Configure the canonical production Site URL and exact recovery/callback allow-list, then test signup OTP, resend, expiry, invitation return, and password recovery in staging.
- For each Resend tenant, verify its sending domain, configure its receiving domain/MX records, and register its tenant-specific signed webhook.
- For each custom-server tenant using inbound mail, configure and verify IMAP and schedule the protected inbound worker.
- Set `EMAIL_INBOUND_WORKER_SECRET` to a high-entropy production secret.
- Exercise signed webhook replay, duplicate delivery, provider outage, and IMAP reconnect cases in staging.
- Rotate any credentials previously exposed in chat or screenshots before production.
