# MVP release status

Reviewed: 12 August 2026

## Product contract

AIOS is a multi-tenant travel CRM with AI embedded in ordinary work. The CRM
remains usable without a model provider. AIOS adds recommendations, internal
drafts, deterministic work coordination, durable evidence, and approval-gated
external effects. Tenant row-level security and hard external-action gates are
authoritative in every operating mode.

## Operating modes

| Mode | Direct operator request | Scheduled/internal work | CRM mutation | External effect |
| --- | --- | --- | --- | --- |
| Manual | AI may return a reversible internal recommendation or draft | Disabled | Human only | Human approval and explicit execution |
| Assisted | AI prepares drafts and may execute explicitly low-risk internal coordination | Bounded internal workflows only | Reviewed draft or safe internal tool | Human approval and explicit execution |
| Autopilot | AI runs every permitted internal workflow | Bounded internal workflows only | Permitted low-risk actions | Still requires human approval; never bypassed |

The policy catalog contains 19 actions: 10 internal capabilities and 9 hard
external-effect gates. Automated work never sends customer/supplier messages,
changes prices, confirms a booking, issues/refunds money, or publishes traveler
documents without an exact human approval.

## Implemented agency journey

- Today workspace with attention, pipeline, departures, finance, and AI review.
- Leads/opportunities, qualification, governed stages, ownership, SLAs, and follow-up playbooks.
- Contacts/companies, preferences/consent, imports, duplicates, and saved views.
- Three-pane Inbox, internal notes/templates/drafts, SLA triage, and AI reply drafts.
- Tasks with ownership, lifecycle, saved views, and approval-escalation handoff.
- Itinerary planning, day/time/time-zone ordering, comments, templates, readiness, and AI suggestions.
- Versioned quotes, protected costs/margins, proposal content, guardrails, customer-safe preview/share, acceptance, and payment schedules.
- Won-deal trip handoff, travelers, human entry-readiness evidence, services, documents, operational tasks, lifecycle, traveler portal, and Operations Radar.
- Suppliers, contracts, receivables/payables, settlement evidence, permanent invoices/PDFs, accounting export, and a zero-money sandbox payment request.
- Knowledge lifecycle, replacement/review, permission-aware retrieval, citations, conflict review, and grounded Answer Desk.
- Analytics, aggregate management intelligence, AI Activity, approvals, automation modes, budgets, provider prices, and durable job diagnostics.
- Tenant team/roles, invitations, MFA, tenant integration vault, separate platform administration, and platform email configuration.

## Live AIOS capabilities

The model-backed MVP agents are Lead Intake, Itinerary Drafting, cited Knowledge
Answers, and Inbox Sales Copilot. The deterministic coordinator routes unowned
opportunities, triages lead and Inbox SLA risk, and refreshes trip/finance
exceptions. All runs have an immutable ledger and bounded token/cost evidence.

The platform router supports Groq, ZhiPuAI/GLM, NVIDIA NIM, OpenRouter, OpenAI,
Gemini, Anthropic/Claude, and Qwen. Fallback occurs only for transient provider
failures, follows the configured priority order, and remains inside each
workspace allow-list and daily budget.

## Integration truth

- Tenant Resend and custom SMTP/IMAP: implemented for approved outbound and bounded inbound ingestion; production DNS, credentials, webhook registration, and worker scheduling remain external deployment work.
- Platform Resend/custom SMTP: separately encrypted and accessible only to `superadmin`/`platform_admin`; fixed sender is `travel@lumierah.in`.
- Supabase Auth email: in-app six-digit signup OTP is implemented with a 10-minute expiry and 60-second resend window; hosted SMTP must use the separate fixed sender `AIOS <auth@lumierah.in>`. Password recovery remains link-based.
- Stripe/Razorpay: tenant-safe configuration UX exists; live payment adapters and signed webhooks are not part of the current deployable MVP. The product exposes a clearly labeled zero-money sandbox only.
- WhatsApp: tenant-safe configuration UX exists; live inbound/outbound Cloud API execution is not part of the current deployable MVP.
- OpenAI/Claude tenant credentials: supported in the live router. Platform Groq/ZhiPuAI/NVIDIA/OpenRouter routing is also supported.

No screen may describe a configuration-only provider as active or real-money capable.

## Deployment handoff

Run `npm run verify:deploy` in the production environment. Code release is
blocked until its environment checks pass and the printed external checklist is
completed. In particular: set a canonical HTTPS `APP_BASE_URL`, add the
32-byte integration-vault key, add independent worker secrets, rotate every
credential shared during development, configure production Supabase Auth SMTP
for `AIOS <auth@lumierah.in>` and install the code-only signup template,
verify `lumierah.in`, register tenant inbound email routes, schedule protected
workers, and configure monitoring/backup/rollback ownership.

Production Stripe/Razorpay collection and WhatsApp messaging are explicit
post-MVP integration releases unless the product owner promotes them into the
launch gate and provides dedicated staging accounts and acceptance criteria.

## Platform administration addendum — 12 August 2026

The platform control plane is now a separate authenticated product surface rather than a tenant-shell module. It includes a real overview, searchable agency-readiness registry, aggregate system health, platform-owned email configuration, a privacy-minimized audit ledger, and a superadmin-only access directory.

`platform_admin` handles platform operations and configuration; `superadmin` additionally manages platform authority. Neither role receives tenant CRM access without an explicit agency membership. Every platform mutation requires MFA, and the hosted database independently preserves at least one active superadmin. The current production build contains 39 application pages, the behavioral suite passes 311/311, and the new disposable cross-role Chromium suite passes 2/2.

## Release evidence

- The Next.js 16.3 production build completes for all 35 application pages.
- ESLint, the scoped integration-style guard, TypeScript/build checks, and
  whitespace validation are clean.
- The behavioral suite passes 308/308 and the no-provider AI safety evaluation
  suite passes 27/27 with zero provider calls.
- Source scanning reports zero potential committed secrets across 507 files;
  `npm audit --audit-level=high` reports zero vulnerabilities.
- Hosted anonymous-access and disposable tenant/role authorization probes pass,
  including integration-vault, approval, finance, storage, and AIOS boundaries.
- All 168 Playwright checks have passing Chromium, Firefox, and WebKit release
  evidence. Chromium and Firefox completed their full 56-check projects in the
  final matrix. WebKit completed 54 checks in its full project; its framework-
  noise console sweep and the subsequently unblocked TOTP check then passed in
  a clean focused run. The matrix includes all 30 authenticated operating
  journeys and 26 public/security boundaries per engine.
- The demo seed is idempotent and currently provisions 8 contacts, 8
  opportunities, 5 conversations, 12 tasks, 4 quotes, 3 trips, supplier and
  finance evidence, and approved Knowledge passages.
- Live Groq calls passed Lead Intake, Itinerary Drafting, Knowledge Answer Desk,
  and Inbox Sales Copilot requests in Manual, Assisted, and Autopilot. GLM
  returned a transient provider-capacity response during its direct smoke; the
  configured priority router continued safely and did not require another key.

## Activation blockers

`npm run verify:deploy` currently reports exactly four intentionally deferred
production variables: `APP_BASE_URL`, `TENANT_INTEGRATION_ENCRYPTION_KEY`,
`AIOS_WORKER_SECRET`, and `EMAIL_INBOUND_WORKER_SECRET`. It also prints the
external DNS, Supabase Auth SMTP, inbound-route scheduling, monitoring, backup,
rollback, and credential-rotation checklist without printing secret values.
