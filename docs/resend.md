# Resend mail setup

AIOS uses Resend for product mail such as workspace notifications. Supabase Auth email confirmation, password reset, and invite emails should also be routed through Resend SMTP.

## 1. Verify a sending subdomain

In Resend, add `travel.stateai.in` for AIOS product mail. Add the exact DKIM, SPF, and MX records Resend provides to the DNS zone for `stateai.in`, then wait for verification. Add a DMARC record after verification.

Use a dedicated `auth.stateai.in` subdomain for Supabase Auth mail if possible. Keeping authentication and product mail on separate subdomains protects deliverability when one stream has a reputation problem.

## 2. Configure application mail

After verification, create a Resend API key scoped to sending mail. Add the following only to `.env.local` for local development and to the host's encrypted production secrets for deployment:

```text
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
RESEND_FROM_EMAIL=AIOS Travel <hello@travel.stateai.in>
RESEND_REPLY_TO_EMAIL=travel@stateai.in
```

Restart the application after changing environment variables. The onboarding flow will then send a non-blocking welcome email when a workspace is created. A Resend outage never blocks workspace creation.

## 3. Receive delivery events securely

After deployment, add an HTTPS webhook in Resend pointing to `https://<your-aios-domain>/api/webhooks/resend`. Subscribe to `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, and `email.delivery_delayed`. Copy its signing secret into `RESEND_WEBHOOK_SECRET`.

The endpoint verifies the raw Svix-signed body before accepting it, stores each provider event ID only once, and has no browser-accessible database policy. Do not use open/click events for authentication email workflows.

## 4. Route Supabase Auth mail through Resend

Prefer the Resend–Supabase integration from the Resend dashboard, which provisions and applies the SMTP configuration. If configuring it manually in Supabase Authentication → Email → SMTP Settings, use:

```text
Host: smtp.resend.com
Port: 465
Username: resend
Password: <a Resend API key>
Sender: AIOS Travel <no-reply@auth.stateai.in>
```

Set Supabase's Site URL and allowed redirect URLs to the production AIOS URL before launch. Keep local development URLs only in the development project.

## Safety checklist

- Never use the Resend key in browser code or a `NEXT_PUBLIC_` variable.
- Use separate API keys for development, staging, and production, with the minimum permissions.
- Keep product notifications and auth mail on distinct sending subdomains.
- Configure DKIM, SPF, and DMARC; inspect bounce and complaint events in Resend before expanding volume.
- Do not add open/click tracking to authentication emails.
