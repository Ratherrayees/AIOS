# Credential rotation runbook

Use this runbook before any public deployment and whenever a credential is pasted into chat, logs, an issue, or another untrusted location.

## Order of operations

1. Record the incident time, affected environment, credential class, and response owner. Never copy the credential value into the incident record.
2. Create a replacement in the provider dashboard with the minimum required scope.
3. Update the encrypted environment for one non-production environment.
4. Restart or redeploy and run the health, authentication, database-access, authorization, email-signature, and model-provider checks relevant to that credential.
5. Promote the replacement to production and verify again.
6. Revoke the old credential only after the replacement is confirmed, unless active abuse requires immediate revocation.
7. Search source, build logs, task history, and provider logs for exposure or suspicious use.
8. Record completion and the next scheduled rotation date.

## Credential-specific checks

### Supabase secret key

- Replace `SUPABASE_SECRET_KEY` only in server-side secret stores.
- Confirm it is absent from browser bundles and `NEXT_PUBLIC_*` variables.
- Run `npm run verify:supabase` and `npm run verify:authz`.

### Database password

- Rotate it in Supabase Database Settings.
- Update both transaction-pooler and migration/session connection secrets.
- Run a migration dry run, database lint, and a backup connectivity check.

### Resend API and webhook keys

- Use separate send and webhook secrets for each environment.
- Send a staging message, validate delivery, reject an invalid webhook signature, and replay a valid event to prove idempotency.
- Revoke old keys and inspect recent send/webhook logs.

### Model-provider key

- Restrict the key by project, provider capability, spend, and region when supported.
- Run only redacted evaluation fixtures after rotation.
- Confirm the AIOS kill switch and daily organization ceiling still apply.

## Required evidence

Retain the incident ID, credential class, environments rotated, verification commands/results, revocation time, log-review result, owner, and approver. Never retain the old or new secret value.
