# AIOS security threat model

Reviewed: 1 August 2026

## Scope and safety objective

This model covers the Next.js application, Supabase Auth/Postgres/Storage, Resend webhooks, model-provider calls, and browser clients. The core safety objective is that neither a user nor an AI agent can cross an organization boundary or perform an external effect without the authority and human approval required by policy.

## Assets

- Authentication sessions, MFA factors, invitation tokens, public proposal/traveler bearer tokens, and role assignments
- Traveller identity, contact details, trip plans, and private documents
- Quotes, costs, margins, payments, supplier data, and booking commitments
- AI inputs, structured outputs, citations, tool calls, policy decisions, and approvals
- Supabase, database, Resend, and model-provider credentials
- Append-only audit evidence and webhook idempotency records

## Trust boundaries

1. Browser to Next.js: all browser input and model output is untrusted.
2. Next.js to Supabase Data API: user-scoped calls must carry the user's session and remain subject to RLS.
3. Privileged server to Supabase: the secret client bypasses RLS and is restricted to server-only integration and verification paths.
4. Next.js to model providers: only bounded, inspected context may leave the application; model responses never grant authority.
5. Providers to webhooks: webhook bodies are untrusted until signature and idempotency checks pass.
6. Private Storage to a signed URL: signed URLs are bearer capabilities and must be short-lived, purpose-specific, and issued only after authorization.
7. Public proposal/traveler links to the application: URL tokens are bearer capabilities; public handlers may return only the frozen approved snapshot associated with an active, unexpired token hash.

## Primary threats and controls

| Threat | Existing controls | Residual work |
| --- | --- | --- |
| Cross-tenant read/write | RLS on 69 application tables, active-membership helpers, immutable `organization_id`, same-tenant composite foreign keys, 326 owner/viewer authorization assertions | Repeat the complete probe against staging and production-like identities |
| Role escalation or orphaned workspace | Owner/admin role policies, owner-only owner grants, final-owner trigger, audited membership changes | Add enterprise SSO/SCIM lifecycle later |
| Forged or replayed approval | Pending-only insert policy, no direct client update/delete, row lock, single transition, exact quote-version binding, one-link-per-approval consumption, atomic audit evidence | Add durable post-approval execution/retry state for future outbound workers |
| AI bypasses human authority | Allowlisted action catalog, unknown actions blocked, external effects hard-gated in code and database, kill switch, tool-call ledger | Add adversarial evaluations for every new tool |
| Prompt injection/data exfiltration | Deterministic input-size/instruction checks, structured output schemas, citations attached server-side, least-context model calls | Formal PII redaction policy and provider-region review |
| Private document disclosure | Private bucket, tenant-first UUID paths, role/MFA policies, restricted MIME/size, no client overwrite/delete, 60-second authorized signed downloads | Verify Storage recovery and signed-download telemetry in staging |
| Public bearer-link disclosure | 256-bit random tokens, database stores only SHA-256 hashes, customer-safe frozen schemas, service-only lookup, no-referrer/no-store responses, bounded expiry, immediate revocation, and no automatic delivery | Configure production proxy/CDN access-log redaction and validate browser-history/support handling before wider release |
| Authentication redirect abuse | Safe internal `next` paths and explicit HTTPS `APP_BASE_URL` for production email callbacks | Verify deployment redirect allow-list |
| Credential disclosure | Server-only environment validation, ignored local secrets, source secret scanner, redacted diagnostics | Rotate all credentials used in chat/testing before deployment |
| Webhook spoofing/replay | Raw-body signature verification and provider-event uniqueness | Run public staging signature/retry tests after deployment |
| Supply-chain compromise | Exact dependency versions, lockfile installs, dependency audit, minimal direct lint stack | Add automated upgrade review cadence and provenance policy |
| Data loss/corruption | Migrations are the schema authority; quote/template writes use row locks and immutable versions | Schedule backups and complete a staging restore drill |

## Agent authority rules

- Observe and draft operations do not mutate customer-visible state.
- Auto is permitted only for explicitly allowlisted, bounded internal actions.
- Customer/supplier communication, quote/document sharing, pricing, booking commitments, and refunds always require human approval.
- Approval is authorization for one registered action, not general authority.
- Model text is data, never an instruction to bypass policy or invoke a tool.
- Every new agent tool requires a threat-model update, role matrix, idempotency design, failure/retry behavior, and negative authorization tests.

## Review triggers

Review this model before adding a provider, payment flow, public portal, document download, outbound message, booking connector, SSO, new storage bucket, or new autonomous tool. A release cannot close its security gate while a high-impact threat lacks an owner, enforcement point, and test.
