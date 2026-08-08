# AIOS security threat model

Reviewed: 8 August 2026

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
| Cross-tenant read/write | RLS on 74 application tables, active-membership helpers, immutable `organization_id`, same-tenant composite foreign keys, 369 owner/viewer/service authorization assertions | Repeat the complete probe against staging and production-like identities |
| Role escalation or orphaned workspace | Owner/admin role policies, owner-only owner grants, final-owner trigger, audited membership changes | Add enterprise SSO/SCIM lifecycle later |
| Forged or replayed approval | Pending-only insert policy, no direct client update/delete, row lock, single transition, exact quote-version and payment-schedule binding, database-derived margin/markup/commission/discount/term exception codes, content-free policy/schedule hashes, stale-review cancellation, one-link-per-approval consumption, atomic audit evidence | Add durable post-approval execution/retry state for future outbound workers |
| Forged or silently rewritten quote economics | PostgreSQL-reconciled structured lines, separately protected costs, one immutable commercial snapshot per exact quote version, policy timestamp and actor evidence, role-scoped reads, browser-write denial, stale-policy risk, and approval metadata that exposes rates but no protected amounts | Stage-test realistic high-value rounding/tax/commission cases and obtain finance-owner sign-off before using estimates for payroll or settlement |
| Forged or duplicated quote receivable | Owner/admin/finance-only row-locked RPC, accepted-current-version requirement, exact acceptance/schedule composite foreign keys, one unique row per milestone, exact total reconciliation, idempotent retry, direct browser-write denial, and explicit zero-invoice/zero-delivery/zero-collection audit flags | Do not reinterpret internal receivables as tax invoices; issuance must consume only an approved exact invoice draft |
| Premature, forged, or silently rewritten invoice | Finance-only preview policy and draft visibility; owner/admin/finance plus MFA for guarded preparation; exact current accepted quote/version/acceptance/schedule/receivable/contact relationships; customer-line, payment-term and net/tax/total reconciliation; policy timestamp and SHA-256 content evidence; row lock, idempotent retry, immutable content, explicit superseding revisions, browser-write denial, content-safe audit, unchanged legal sequence, and proof that receivable invoice numbers remain null | Add exact-draft human approval, atomic gap-controlled legal number allocation, jurisdiction-approved rendering, delivery retry/idempotency evidence, and void/credit-note rules before calling any artifact an issued invoice |
| AI bypasses human authority | Allowlisted action catalog, unknown actions blocked, external effects hard-gated in code and database, kill switch, tool-call ledger | Add adversarial evaluations for every new tool |
| Prompt injection/data exfiltration | Deterministic input-size/instruction checks, structured output schemas, citations attached server-side, least-context model calls | Formal PII redaction policy and provider-region review |
| Private document disclosure | Private bucket, tenant-first UUID paths, role/MFA policies, restricted MIME/size, no client overwrite/delete, 60-second authorized signed downloads | Verify Storage recovery and signed-download telemetry in staging |
| Public bearer-link disclosure or forged acceptance | 256-bit random tokens, database stores only SHA-256 hashes, customer-safe frozen schemas, service-only lookup/acceptance, exact active-link/version foreign keys, explicit signatory/statement confirmation, one immutable acceptance per quote/link, idempotent retries, privacy-safe public state, no-referrer/no-store responses, bounded expiry, immediate access revocation, and no automatic delivery or downstream booking/finance/message effect | Configure production proxy/CDN access-log redaction, validate browser-history/support handling, approve legal acceptance wording, and decide whether a dedicated e-signature provider is required before wider release |
| Authentication redirect abuse | Safe internal `next` paths and explicit HTTPS `APP_BASE_URL` for production email callbacks | Verify deployment redirect allow-list |
| Credential disclosure | Server-only environment validation, ignored local secrets, source secret scanner, redacted diagnostics | Rotate all credentials used in chat/testing before deployment |
| Webhook spoofing/replay | Raw-body signature verification and provider-event uniqueness | Run public staging signature/retry tests after deployment |
| Supply-chain compromise | Exact dependency versions, lockfile installs, dependency audit, minimal direct lint stack | Add automated upgrade review cadence and provenance policy |
| Data loss/corruption | Migrations are the schema authority; quote, protected commercial-economics, payment-schedule, and template writes use row locks and immutable/revisioned evidence; local native restore parity covers every application table | Schedule backups and complete a staging restore drill |

## Agent authority rules

- Observe and draft operations do not mutate customer-visible state.
- Auto is permitted only for explicitly allowlisted, bounded internal actions.
- Customer/supplier communication, quote/document sharing, pricing, booking commitments, and refunds always require human approval.
- Approval is authorization for one registered action, not general authority.
- Model text is data, never an instruction to bypass policy or invoke a tool.
- Every new agent tool requires a threat-model update, role matrix, idempotency design, failure/retry behavior, and negative authorization tests.

## Review triggers

Review this model before adding a provider, payment flow, public portal, document download, outbound message, booking connector, SSO, new storage bucket, or new autonomous tool. A release cannot close its security gate while a high-impact threat lacks an owner, enforcement point, and test.
