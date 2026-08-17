# Resend mail setup

AIOS has three deliberately separate email authorities:

- Supabase Auth sends identity lifecycle mail as `AIOS <auth@lumierah.in>` through deployment-managed SMTP.
- The platform sends its own operational mail as `AIOS Travel <travel@lumierah.in>` through the platform email configuration.
- Each agency sends and receives customer mail through its own Resend or custom SMTP/IMAP connection.

An authentication credential must never be reused as a platform or tenant mail credential, and tenant delivery must never fall back to either platform-owned sender.

## 1. Verify a sending subdomain

Verify `lumierah.in` for both fixed platform identities: `auth@lumierah.in` for authentication and `travel@lumierah.in` for platform product mail. Add the exact DKIM and SPF records Resend provides, then add an appropriate DMARC policy after verification.

Use a dedicated Resend account, sending subdomain, and API key for authentication if possible. Separating authentication and product-mail streams limits credential scope and protects deliverability when one stream has a reputation problem.

## 2. Configure application mail

After verification, create a Resend API key scoped to sending mail. Add the following only to `.env.local` for local development and to the host's encrypted production secrets for deployment:

```text
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
RESEND_FROM_EMAIL=AIOS Travel <travel@lumierah.in>
RESEND_REPLY_TO_EMAIL=travel@lumierah.in
```

Restart the application after changing environment variables. The onboarding flow will then send a non-blocking welcome email when a workspace is created. A Resend outage never blocks workspace creation.

## 3. Receive delivery events securely

After deployment, add an HTTPS webhook in Resend pointing to `https://<your-aios-domain>/api/webhooks/resend`. Subscribe to `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, and `email.delivery_delayed`. Copy its signing secret into `RESEND_WEBHOOK_SECRET`.

The endpoint verifies the raw Svix-signed body before accepting it, stores each provider event ID only once, and has no browser-accessible database policy. Do not use open/click events for authentication email workflows.

For a local, provider-free contract check, start the disposable local Supabase stack, load its local URL and server key into the current shell, build the application, then run:

```text
npm run test:webhook
```

The verifier starts isolated production servers with a disposable signing secret. It proves missing, invalid, stale, and oversized requests fail closed; a current signed event is accepted; a duplicate is acknowledged without a second row; the stored event remains private and exactly once; and a database failure returns a distinct operational error. It deletes its fixture and does not require or call a real Resend API key.

## 4. Route Supabase Auth mail through Resend

Prefer the Resend–Supabase integration from the Resend dashboard, which provisions and applies the SMTP configuration. Use an authentication-only Resend key. If configuring it manually in Supabase **Authentication → Email → SMTP Settings**, use:

```text
Host: smtp.resend.com
Port: 465
Username: resend
Password: <a Resend API key>
Sender: AIOS <auth@lumierah.in>
```

In Supabase **Authentication → Email Templates → Confirm signup**, use a code-only template containing `{{ .Token }}`. Do not include `{{ .ConfirmationURL }}`, `{{ .TokenHash }}`, a magic link, or click tracking in that template. Keep the code at six digits, its expiry at 600 seconds, and the resend minimum at 60 seconds. Password recovery remains a link-based flow and continues to use the recovery callback; do not replace its recovery template with the signup OTP template.

Set Supabase's Site URL and allowed redirect URLs to the production AIOS URL before launch. Keep local development URLs only in the development project. These values and SMTP credentials are hosted Supabase settings, not tenant integration fields and not the platform email vault.

## Safety checklist

- Never use the Resend key in browser code or a `NEXT_PUBLIC_` variable.
- Use a dedicated authentication SMTP credential for `auth@lumierah.in`; do not reuse the `travel@lumierah.in` platform credential.
- Use separate API keys for development, staging, and production, with the minimum permissions.
- Keep product notifications and auth mail on distinct sending subdomains.
- Configure DKIM, SPF, and DMARC; inspect bounce and complaint events in Resend before expanding volume.
- Do not add open/click tracking to authentication emails.
