# AIOS Travel CRM — 20-Phase Delivery Plan

## Product outcome

AIOS is a secure, multi-tenant travel operating system for travel teams. It unifies customer conversations, leads, sales, itinerary creation, bookings, trip operations, supplier work, payments, knowledge, and approval-first AI agents.

The current repository contains a polished, working CRM foundation, Supabase authentication and tenant isolation, a durable approval ledger, a model-provider router, and bounded AIOS lead-intake and itinerary-drafting workflows. It is not yet a production-complete travel operating system. This plan records the real delivery state and turns the remaining work into explicit release gates.

## Non-negotiable principles

- **Human authority:** AI can prepare, recommend, and automate low-risk internal work. It cannot send external communications, change prices, confirm bookings, or process money without a policy check and approval.
- **Tenant isolation:** Every customer-owned record belongs to an organization; database row-level security is the enforcement layer.
- **Auditability:** Important business, AI, and privileged actions create immutable audit events.
- **Security before convenience:** Secrets are server-only; sensitive documents are private; least privilege and secure defaults win over speed.
- **One source of truth:** Supabase migrations define the schema. Generated database types are used by the application. Do not introduce a second ORM/schema authority.
- **Mobile-ready operations:** Key approvals, inbox triage, and on-trip actions must be usable on a phone.
- **Approval is non-bypassable for external effects:** An organization may tune AIOS autonomy only within the action's safety class. Customer/supplier messages, documents, price changes, bookings, and payments can never be changed to Auto.
- **Model-agnostic control plane:** GLM-4.7-Flash is allowed for disposable development fixtures; production models are selected per task only after data-handling, quality, cost, and fallback policies have been approved.

## Delivery reality — reviewed 28 July 2026

| Area | Status | What is actually present | What still blocks completion |
| --- | --- | --- | --- |
| Product shell | Working core slice | Stylish responsive command center, real feature navigation, shared accessible UI primitives, pipeline, onboarding, sign-in/out, AIOS control plane, Team Access, skip navigation, visible keyboard focus, reduced-motion protection, a one-row mobile route bar, and a working dashboard-to-Lead-Intake entry point | Authenticated keyboard/focus and cross-browser coverage plus final shared-layout adoption |
| Identity and tenancy | Working foundation | Supabase SSR cookies, authenticated claim protection, organizations, memberships, RLS, onboarding, password recovery, an RLS-derived active-workspace switcher, teammate profile visibility, a role-restricted invitation ledger, verified-email acceptance transaction, audited role/suspend/restore controls, and opt-in TOTP MFA with AAL2 enforcement; local Auth requires confirmed email and a 12-character mixed password | Verified invitation delivery, SSO extension, and preview/staging/production environment separation |
| CRM | Release-candidate core | Contacts, atomic import, search, tenant-enforced ownership, private saved views across Contacts, Leads, Tasks, Inbox, and Analytics, companies, consent evidence/preferences, human-reviewed duplicate merging, public attributed lead forms, reusable qualification contracts, evidence-gated pipeline transitions and history, governed drag/drop plus keyboard-safe stage movement, internal follow-up playbooks, response/follow-up SLAs, tiered agentic escalation, source/velocity analytics, tasks, secure quote drafts, activity history, explicit role policies, and audited mutations | Richer traveller profiles and product-owner acceptance |
| Email | Foundation delivered | Server-only Resend adapter, verified-webhook endpoint, private idempotent event store, and an internal inbox with status, ownership, priority, response deadlines, SLA views, tiered policy-gated internal escalation tasks, reusable Email/WhatsApp replies and signatures, and internal drafts with review state and planned-send metadata | Domain verification, Auth SMTP, public webhook deployment, inbound routing, approved outbound delivery, and scheduled-delivery workers |
| AIOS | Early working slice | Provider router, structured Lead Intake and itinerary previews, Zod validation, durable runs and model-job records, idempotent atomic job leases, bounded retry/dead-letter state, a fail-closed bearer-authenticated retry endpoint, owner/admin tenant-scoped manual queue processing and reviewed dead-letter requeueing, immutable owner-approved model-price versions and currency-labeled token-cost estimates, server-attached citations, human field review, row-locked approval resolution, low-risk task creation, lead and Inbox SLA risk triage, run/queue telemetry, token telemetry, owner/admin workspace model budget/kill switch/provider selection/allow-list, and code/database-enforced non-bypassable external actions | Deployment worker secret/schedule, real approved provider/model rates, provider data-region governance, more agents/tools |
| Database security | Foundation delivered | RLS on all 47 application tables, explicit Data API grants, reviewed role/action policies, immutable tenant identity, same-tenant foreign keys, opt-in MFA enforcement, private role-scoped document storage, atomic document/timeline/audit recording, guarded sales and trip-lifecycle RPCs, complete generated live-schema types, deterministic fictional seed data, clean zero-state migration replay, zero schema-lint/advisor findings, and live anonymous/authenticated authorization probes | Production backup/restore drill and workload-informed index review |
| Release engineering | Working foundation | Initialized Git repository and reviewed baseline commit, lockfile, exact dependency and CLI versions, CI, source secret scanning, strict lint/typecheck, 113 behavioral tests, 15 zero-provider AI safety evaluations, and 38 Chromium journeys covering the complete implemented UI surface, authenticated tenant switching, public capture, governed drag/drop, qualification gates, internal playbooks, operational trip handoff, approval resolution, analytics, private upload/download, MFA, mobile coverage, and a zero-console-problem route sweep; production build, zero-vulnerability audit, migration replay/type-drift gate, Supabase probes, threat model, credential-rotation guidance, and database-recovery procedure | Remote/branch protection, preview/staging/prod separation, observability, cross-browser/assistive-tech evidence, a completed restore drill, and deployment runbook |

### Completion scorecard

These percentages estimate implemented and verified product scope against each phase's exit gate; they are not claims that a phase is formally accepted. Overall implementation is approximately **62%**. Under the strict cross-phase rule requiring product-owner acceptance, no phase is formally closed yet.

| Phase | Estimate | Phase | Estimate |
| --- | ---: | --- | ---: |
| 01 Product charter | 60% | 11 Sales copilot | 62% |
| 02 Engineering baseline | 84% | 12 Quote workspace | 52% |
| 03 Design system | 96% | 13 Itinerary studio | 68% |
| 04 Identity and tenancy | 80% | 14 Trip workspace/portal | 62% |
| 05 Database and RLS | 96% | 15 Supplier and finance | 12% |
| 06 Security and privacy | 76% | 16 Operations automation | 20% |
| 07 CRM core | 96% | 17 Knowledge/RAG | 8% |
| 08 Communication hub | 72% | 18 Intelligence/reporting | 30% |
| 09 Lead pipeline | 99% | 19 QA/security review | 70% |
| 10 AIOS platform | 74% | 20 Pilot and launch | 5% |

### Cross-phase UI/UX clarity sprint

**Goal:** Make the operating model understandable before adding more portal, supplier, finance, and automation depth.

**Delivered:** The workspace now uses one customer-journey model—Capture → Qualify → Propose → Operate—across the dashboard and every principal feature. Dashboard navigation is grouped by user intent into Today, Sales, Operations, Intelligence, and Administration. A first-run setup checklist leads owners through intake, qualification, AIOS authority, and team access. Every major feature now states why it exists, what the user should do next, what AIOS may do there, and whether the capability is live, internal-only, guided, planned, or approval-gated. A global field guide explains Contact vs Lead vs Trip, the customer lifecycle, autonomy modes, and non-bypassable human authority. The mobile command bar is reduced to five high-frequency destinations, while the responsive grouped feature navigation retains complete access. Browser coverage proves the guide, setup path, query-addressable Lead pipeline, every contextual feature guide, one-row mobile navigation, 390px layouts, and a zero-console-error/warning route sweep.

**Remaining refinement:** Observe real users performing the first complete sales-to-trip journey, then tune terminology, content density, role-specific onboarding, and any advanced controls that should be progressively disclosed.

## Immediate release blockers before wider user testing

1. **Rotate exposed credentials before any deployment or external integration test.** This includes Supabase server credentials, Resend credentials, database password, and the GLM key that were pasted into chat/testing. Update only `.env.local`/deployment secrets; never commit them.
2. Complete the deferred external email release: verify `travel.stateai.in`, configure Supabase Auth SMTP and redirect allow-lists, deploy, register the Resend webhook, then run signature-rejection and duplicate-delivery tests in staging.
3. Extend browser evidence into lead-triage retry/idempotency, recovery-email delivery, webhook delivery, WebKit/Firefox, authenticated keyboard/focus, and assistive-technology paths. Approval resolution, public capture, governed transition and qualification RPCs, internal follow-up playbooks, analytics, and private upload are now covered in Chromium.
4. Establish preview, staging, and production environments with error tracking, structured/redacted logs, uptime checks, backup-restore drills, deployment rollback, and secret scanning.
5. Add authenticated keyboard/focus, WebKit/Firefox, and assistive-technology critical-path evidence, then finish standard page-layout adoption across the feature modules.
6. Define production model governance: approved providers/regions, PII redaction policy, fallback matrix, per-organization cost budgets, and evaluation thresholds before changing from GLM test use to production models.

## Stabilization progress

- **Done:** External-effect AIOS actions—traveller/supplier messages, document and quote sharing, pricing, bookings, and refunds—are hard approval gates and cannot be set to Auto.
- **Done:** A private database trigger prevents removal or demotion of the final active owner; membership mutations are owner-safe, admin-limited, and audit logged.
- **Done:** Contact identity uses a partial normalized-email unique index, so multiple no-email leads are valid while email duplicates are prevented case-insensitively.
- **Done:** A pinned TypeScript test runner covers AI policy, workspace budgets, strict metadata-only job payloads, deterministic job retry backoff, worker bearer authentication, approved-rate cost calculation, model-input safety and direct-identifier redaction, CRM, communication preferences, ownership, public capture validation/deduplication, qualification templates, safe stage/workflow error disclosure, open-pipeline transition targeting, internal sequence ordering, response and follow-up SLA tiers, Inbox SLA policy gating, internal reply-template/draft boundaries, duplicate review, saved-view validation, invitation and membership schemas, safe auth redirects and callback origins, active-workspace selection, itinerary drafting, templates, collaboration, conflicts, trip operations validation, lead health, upload filename normalization, and file-signature verification. A separate zero-provider-call evaluation command exercises 15 golden/adversarial AI safety and prompt-version fixtures and blocks CI regressions. The 113 behavioral tests, 15 AI evaluations, and 38 browser tests—including real sign-in, two authorized tenants, public lead conversion, complete CRM/Inbox/Tasks/Quotes/Itinerary/Trip Operations/Team/AIOS UI workflows, evidence-gated drag/drop and keyboard stage movement, internal follow-up playbooks, governed won-deal handoff, booking/task/document trip operations, human approval resolution, analytics, private document upload/download, live TOTP enrollment/removal, 390px overflow, one-row mobile navigation, and a zero-console-problem protected-route sweep—run alongside lint, typecheck, build, dependency audit, and Supabase access verification. The feature-by-feature evidence is recorded in `docs/ui-wiring-audit.md`.
- **Done:** A clean local Supabase reset replays every migration and deterministic fictional seed from zero. CI repeats that replay, lints the schema, regenerates types, and fails on type drift. The application now uses complete generated live-schema types plus a narrow override for nullable RPC arguments.
- **Done:** The live database now has an index for every foreign-key constraint, the duplicate task index is removed, and overlapping profile read policies are consolidated. Remote advisors have no missing-FK, duplicate-index, or multiple-permissive-policy findings; remaining notices are informational unused-index observations that require production workload evidence before removal.
- **Done:** Local Auth now mirrors the application posture with confirmed email, a 12-character lower/upper/digit/symbol password requirement, secure password changes, and TOTP enrollment/verification. The server MFA gate uses an authenticated database policy check rather than a cookie-backed session object.
- **Done:** Direct dependencies are pinned, the compatible stack is current at Next 16.2.12, React 19.2.8, Supabase JS 2.110.9, Supabase CLI 2.110.0, ESLint 10.8, and Playwright 1.62; npm enforces exact saves locally and the dependency audit reports zero known vulnerabilities. Major OpenAI SDK 7 and TypeScript 7 upgrades remain deliberately separate compatibility work rather than being mixed into this CRM release.
- **Done:** The Supabase access verifier confirms administrative visibility and no anonymous row exposure across all 47 application tables and denies anonymous public-lead, document, qualification, follow-up, trip-conversion, and trip-lifecycle RPC execution. A separate authenticated probe creates isolated owner/viewer tenants and proves tenant isolation, viewer read-only behavior, role-escalation denial, owner-invitation denial, same-tenant relationship enforcement—including template/draft, AIOS-budget, model-price, AI-job/run, and operational-trip links—private saved-view isolation, immutable tenant identity and price versions, governed deal and trip history, idempotent won-deal conversion, evidence-gated stage advancement, atomic owner-assigned follow-up tasks, server-only public capture, server-only job claim/settlement/requeue, lease ownership, retry transitions, and private document-storage boundaries; it also rejects forged lead/trip document metadata and direct qualification or lifecycle mutation before removing its fixtures.
- **Done:** Active organization switching is driven only by RLS-visible memberships. A local preference may select from that authorized list but cannot grant tenant access.
- **Done:** `/settings/team` provides role-aware member visibility and owner/admin invitation creation and revocation. Only one-way invitation token hashes are stored, owner grants remain owner-only, expired duplicate invitations are retired safely, and invitation changes are audit logged.
- **Done:** `/auth/invite` preserves a safe internal return path across sign-in/sign-up, requires a matching verified email, and atomically consumes the invitation while activating membership. Owners/admins can change permitted roles or suspend/restore members from Team Access; final-owner and admin-to-owner escalation protections remain database enforced.
- **Done:** Users can enroll and remove TOTP factors from Account Security. Enrolled users are redirected through an AAL2 challenge, and restrictive database policies enforce AAL2 across all application tables without locking out accounts that have not yet enrolled.
- **Done:** Core data mutations now use an explicit role/action matrix, and tenant-owned rows cannot be moved between organizations. Final-owner protection still blocks orphaning a live workspace while allowing privileged organization deletion to cascade safely.
- **Done:** Approval requests can only be created pending, authenticated clients cannot update or delete their state directly, and a row-locked resolver performs one decision plus its audit event atomically. Database constraints reject Auto for every external-effect action and reject unauthorized approval-role configurations even when the Data API is called directly.
- **Done:** Authentication email callbacks use an explicit HTTPS `APP_BASE_URL` in production; malformed, insecure, credential-bearing, and reflected foreign origins fail closed.
- **Done:** CI and local verification include a redacting source secret scanner. The repository now contains a concrete trust-boundary threat model plus credential-rotation and database-recovery runbooks; the recovery document deliberately does not claim a drill until one is completed in an isolated project.
- **Still external:** Credential rotation, Resend domain/SMTP/webhook deployment, and staging/production environment setup need provider-dashboard access from Rayees.

## Phase 01 — Product charter and operating decisions

**Goal:** Turn the product direction into decisions that engineering can build against.

- Define initial customer: B2B travel agency, tour operator, or corporate travel team.
- Choose launch geography, currency/tax needs, supported payment provider, and data residency requirement.
- Define roles: owner, admin, sales, trip designer, operations, finance, agent, and read-only.
- Agree on v1 success metrics: response time, lead conversion, gross margin, operational exceptions, and repeat bookings.
- Capture non-goals for v1: live GDS inventory, autonomous booking, full accounting suite, and unrestricted AI actions.

**Exit gate:** Signed product brief, role matrix, success metrics, and an explicitly prioritized v1 backlog.

## Phase 02 — Engineering baseline and delivery controls

**Goal:** Make development repeatable, testable, and safe to release.

- Finalize Node 24 LTS, Next.js, TypeScript, npm/pnpm choice, formatting, linting, and strict type checking.
- Add environment validation, `.env.example`, secret naming conventions, and local setup documentation.
- Add CI for type checking, linting, unit tests, production builds, dependency audit, and migration validation.
- Add a dedicated test command and suites for server actions, RLS-negative cases, AI contracts, and Playwright critical-path journeys; a passing build alone is not acceptance evidence.
- Configure dependency lockfile review and a minimum package-release-age policy.
- Establish preview, staging, and production environments.

**Current progress:** The workspace is a valid Git repository on `main` with reviewed checkpoint commits authored as Rayees Amin; generated artifacts, local Supabase state, Playwright reports, and deployment caches are ignored. Node 24, Next.js 16.2.12, TypeScript 5.9.3, React 19.2.8, Supabase JS 2.110.9, Supabase CLI 2.110.0, and all direct dependencies are pinned exactly in the lockfile. CI runs secret scanning, a zero-state Supabase migration/seed replay, schema lint, generated-type drift detection, 113 behavioral tests, 15 zero-provider AI evaluations, strict typecheck, ESLint, a production build, 38 Chromium journeys, conditional live Supabase authorization probes, and a high-severity dependency audit. Remaining work is a remote with branch protection, minimum package-age enforcement, deployment/rollback automation, and separate preview, staging, and production environments.

**Exit gate:** A clean clone can build, test, and deploy a preview with no manual machine configuration.

## Phase 03 — Design system and accessible application shell

**Goal:** Convert the current visual direction into reusable, accessible product primitives.

- Create tokens for color, typography, spacing, elevation, state, and responsive breakpoints.
- Build reusable buttons, inputs, dialogs, command palette, data table, cards, empty states, loading states, and toast notifications.
- Add keyboard navigation, focus states, contrast testing, and reduced-motion behavior.
- Create standard page layouts for command center, list/detail view, pipeline, trip workspace, and customer portal.
- Replace prototype-only UI data with typed view models while preserving the polished dashboard direction.

**Current progress:** The shell now provides skip navigation, visible focus treatment, reduced-motion protection, consistent recovery states, and a one-row mobile command-center route bar. Shared accessible form-field, feedback, button, status-notice, empty-state, loading-state, modal-boundary, semantic data-table, responsive feature-header, customer-journey rail, capability badge, setup-checklist, contextual guide, and global product-help primitives now power authentication, onboarding, recovery, the command center, Contacts, Inbox, Tasks, Quotes, Itinerary Studio, Trip Operations, AIOS Control, Analytics, Team Access, and lead detail. Dashboard and feature navigation share intent-based Today, Sales, Operations, Intelligence, and Administration groupings; every principal workspace explains its purpose, next action, AIOS role, and live/internal/approval boundary. Command-center overlays and the global field guide provide focus restoration, Escape and backdrop dismissal, and body-scroll locking; live-lead, member, and invitation summaries use responsive semantic tables with real captions and column headers. Automated browser checks prove the guide and setup flow, direct Lead-pipeline addressing, all contextual guides, the simplified five-destination mobile command bar, and no horizontal overflow at a 390px viewport. Remaining work is observed-user terminology tuning, role-specific onboarding, authenticated keyboard/focus, WebKit/Firefox, and assistive-technology evidence plus gradual conversion of legacy feature forms to the shared primitives.

**Exit gate:** New features can be assembled from shared components without duplicating visual or accessibility behavior.

## Phase 04 — Supabase project and multi-tenant identity

**Goal:** Establish secure identity and organization boundaries.

- Provision Supabase projects and separate development, staging, and production credentials.
- Implement sign-up, sign-in, password reset, email verification, session refresh, and secure logout.
- Create `organizations`, `profiles`, `memberships`, and invitation flows.
- Implement organization switching and membership lifecycle management.
- Add MFA support and design the SSO extension point for later enterprise rollout.
- Finish verified-email delivery: configure `travel.stateai.in` (or the selected subdomain), Supabase Auth SMTP, redirect allow-lists, password reset, and production callback URLs before inviting real users.

**Current progress:** The generic password-recovery request page, protected recovery-session password update, callback destination, and secure logout are in place. The command center now loads every active membership through RLS and supports a real workspace selector; its local preference can choose only from those database-authorized memberships. A shared-workspace profile policy makes teammate names visible without exposing unrelated profiles. `/settings/team` lists tenant members and gives owners/admins a secure internal invitation ledger plus role and suspend/restore controls. Invitation creation validates the full role catalog, keeps owner grants owner-only, stores only a SHA-256 token hash, prevents duplicate pending email identities, expires stale replacements, and audits create/revoke/expiry transitions. `/auth/invite` carries the plaintext token only in the invitation link, preserves a validated same-origin return path through sign-in/sign-up, requires the signed-in account's matching verified email, and atomically activates membership while consuming the invitation under a row lock. Suspended and already-active membership cases fail closed; final-owner protection remains enforced by the database. `/settings/security` supports TOTP enrollment, verification, factor listing and removal; enrolled AAL1 sessions are routed through `/auth/mfa`, and restrictive database policies require AAL2 on all application tables only after a user has a verified factor. Local Auth now requires confirmed email, a 12-character lower/upper/digit/symbol password, secure password changes, and enabled TOTP flows. A disposable authenticated browser fixture proves real sign-in, two-tenant visibility and switching, all principal protected modules, Account Security, and fixture cleanup. Plaintext invitation tokens are intentionally neither returned to the Team Access browser nor retained while delivery is disabled. Remaining work is verified Resend/Auth SMTP delivery, the SSO extension point, more authenticated recovery/invitation journeys, and separate staging/production credentials. Before enabling real delivery, add the deployed `/auth/callback` URL to Supabase Auth's allow-list and complete the deferred SMTP/domain setup.

**Exit gate:** A user can join only authorized organizations and cannot view another organization in any app flow.

## Phase 05 — Database foundation, migrations, and row-level security

**Goal:** Build the data layer that the entire CRM relies on.

- Establish migration conventions, seeded demo data, backups, and generated TypeScript database types.
- Add shared fields: `organization_id`, creator/updater metadata, timestamps, archived state, and status transitions.
- Enable RLS on every tenant-owned table and write explicit policies for each role/action.
- Replace the current broad “active member may mutate” policies with a reviewed role/action matrix before finance, bookings, documents, or membership administration become generally available.
- Protect organization ownership transitions, prevent final-owner removal, and audit every membership role/status change.
- Use a partial normalized-email uniqueness index for contacts; do not treat `NULL` email values as duplicates.
- Create safe server-side repository/service helpers; never expose the service-role key to the browser.
- Add database constraints, indexes, foreign keys, idempotency keys, and soft-delete/archival rules.

**Current progress:** All 47 application tables have RLS and explicit grants. Core contacts, companies, deals, stage/qualification/trip history, lead forms/submissions, reusable qualification and follow-up definitions, tasks, activity, inbox, message templates/drafts, AIOS budget/job/model-price policy, suppliers, travelers, bookings, documents, and itinerary comments use reviewed role/action policies; viewers are read-only, authenticated messages are internal-only, and ordinary users have no destructive core-record policies. A generic trigger makes `organization_id` immutable on mutable tenant tables. Composite foreign keys prevent CRM, inbox, lead-capture, sales-workflow, draft, AI lineage, AI job/run, model price/budget, quote, trip, traveler, itinerary, booking, payment, and document rows from referencing another organization. The private `travel-documents` bucket requires a tenant/document UUID path, restricts content type and size, enforces role and opt-in MFA checks, and offers no browser overwrite/delete policy. Its guarded recorders verify that the exact user-owned storage object exists, then atomically create the appropriate lead- or trip-linked document record, activity event, and audit event; failed recording removes the exact orphaned object server-side. Deal stages and trip statuses are protected from direct browser mutation and move through row-locked, role-checked transition functions with append-only history. Won-deal conversion is row-locked and idempotent, creates one operational trip and lead traveller, and preserves actor/audit evidence. Required qualification evidence is also read-only to browsers and changes only through actor-recording RPCs. Follow-up templates instantiate bounded internal tasks atomically and cannot be applied twice to one opportunity. The application consumes complete CLI-generated live-schema TypeScript definitions, with a narrow override only where the generator cannot express nullable RPC arguments. A deterministic fictional seed and clean local reset replay every migration from zero. Schema lint plus security/performance advisors return no findings. Local authorization probes prove two-tenant read/write/RPC isolation, viewer denial, governed deal/trip transitions and history, qualification gates, playbook deduplication, private capture and document boundaries, and forged-document rejection. The Phase 14 migration still needs a staged hosted deployment before the hosted probe can cover the new records. Remaining work is that deployment, an isolated production-like backup/restore drill, and workload-based review of informational unused-index findings.

**Exit gate:** Automated tests prove cross-tenant reads, writes, uploads, and RPC calls are denied.

## Phase 06 — Security, privacy, and audit foundation

**Goal:** Make security observable and enforceable before sensitive travel data arrives.

- Create immutable audit events for authentication, role changes, exports, document access, pricing edits, approvals, AI tool calls, and integrations.
- Add server-side authorization helpers, request validation, rate limits, CSRF-safe patterns, and secure headers.
- Establish secret-rotation ownership and a credential-exposure response procedure; rotate credentials used in chat/testing before any public deployment.
- Define AI provider data-processing rules: which PII classes can leave the tenant boundary, approved regions/providers, redaction, retention, DPA review, and a local/mock test mode.
- Store documents privately; serve only short-lived signed URLs after permission checks.
- Establish consent, PII classification, redacted logging, retention, export, deletion, and incident-response procedures.
- Add error tracking, structured logs, traces, uptime checks, and alert routing without logging secrets or raw private content.

**Current progress:** Protected routes refresh SSR sessions and return private, non-cacheable responses. Production CSP and browser hardening headers are active, with development-only `unsafe-eval` limited to React diagnostics. Authentication redirects accept only safe internal destinations, and email callbacks require a configured HTTPS application origin in production rather than reflecting a request header. Server actions validate inputs, authorize tenant roles, and depend on RLS as the database backstop. Approval decisions are now row-locked, single-claim operations with atomic audit events; clients can create only pending requests and cannot directly mutate the decision ledger. External-effect autonomy is non-bypassable in both the runtime catalog and database constraints. AI model inputs receive deterministic injection/size checks plus pre-provider redaction of common email, contextual phone/WhatsApp, and passport identifiers from free text; audit evidence retains category counts, not raw identifiers. Each workspace has an owner/admin-controlled daily provider-run ceiling and model-execution kill switch, backed by RLS and the server fallback ceiling; client-visible error diagnostics are redacted. A repository threat model records assets, trust boundaries, enforcement and residual risks; source scanning and credential-rotation/database-recovery runbooks are checked in. Remaining work includes product-owner threat-model acceptance, the full consent/retention/deletion and provider-PII policy, structured observability, distributed rate limiting where provider controls are insufficient, incident response ownership, and an actual staging restore drill.

**Exit gate:** Threat model reviewed; high-risk paths have authorization and audit test coverage.

## Phase 07 — CRM core: contacts, companies, and activity timeline

**Goal:** Give the team a dependable customer record system.

- Build contacts, organizations/companies, contact methods, addresses, tags, preferences, passport/visa metadata, and consent fields.
- Add duplicate detection, merge review, import mapping, export permissions, and bulk tagging.
- Create a unified activity timeline for notes, messages, tasks, deal events, documents, and AI observations.
- Add powerful search, saved views, filters, sorting, and controlled bulk actions.
- Support contact ownership and assignment.

**Current progress:** Contacts, companies, optional contact-company links, and a tenant-scoped activity timeline are live at `/contacts`. The directory supports a server-validated atomic CSV-style import of up to 100 contacts, search, and duplicate normalized-email prevention while still supporting email-less travellers. A role-authorized operator can assign a contact to an active teammate or the shared CRM queue; a composite organization/member foreign key rejects cross-tenant owner IDs even through direct API access, and each ownership change writes timeline plus audit evidence. Users can save, apply, and remove private named Contacts search views. The same feature-aware saved-view contract now powers Leads pipeline/owner/health views, Tasks search/owner/due-state views, and Inbox search/status/owner views; a view can only be read or deleted inside its own feature, and database policies isolate every view to its user and active tenant. Each contact can record a jurisdiction-neutral communication-consent status, evidence timestamp/source, preferred channel, locale, and IANA time zone; coherent evidence is database-constrained, updates are role-authorized, and the change writes timeline plus audit events. The UI explicitly states that these records do not replace a legal-basis/privacy-policy decision. A deterministic reviewer flags normalized phone/email or same-name-and-company candidates but never merges automatically. A human chooses the surviving record and confirms a row-locked database merge that re-links deals, tasks, activity, conversations, travelers, and documents, archives the duplicate, and writes timeline/audit evidence. Contact, company, deal, task, and deal-stage creation produce timeline/audit events. The command center includes a tenant-scoped command palette for leads, contacts, and tasks.

**Exit gate:** A team can import a real contact list, resolve duplicates, and trace every activity for a customer.

## Phase 08 — Communication hub and inbox ingestion

**Goal:** Bring customer communication into the CRM without losing context.

- Implement inbound/outbound email adapters with webhook verification, idempotency, threading, attachments, and failure handling.
- Complete the already-started Resend foundation first: verify the sender domain, configure Supabase Auth SMTP, deploy the webhook endpoint, register it with Resend, then test signature rejection and duplicate delivery in staging.
- Build a unified inbox with assignment, internal notes, status, SLA, and linked contact/deal/trip context.
- Add email templates, signatures, approved reply snippets, and scheduled-message drafts.
- Create the channel-adapter contract for WhatsApp, phone logs, web forms, and future social/integration sources.
- Begin with inbox review and manual sending; add WhatsApp only after Meta business requirements are available.

**Current progress:** `/inbox` is live for tenant-scoped manual conversation records linked to a contact and/or live opportunity, internal notes, audited Inbox/Open/Pending/Closed workflow transitions, and assignment to an active workspace member or the shared queue. Operators can record Low/Normal/High/Urgent priority plus an explicit response deadline, see overdue, urgent, and escalated summary counts, and filter by overdue, due within 24 hours, or no deadline. Text, workflow, owner, and SLA filters can be retained as a private named Inbox view. Server actions validate linked contacts/deals, assignees, priorities, and deadlines; database constraints reject unknown priority and escalation values, viewers remain read-only, and SLA changes write customer activity plus audit evidence. The Reply Library stores and soft-retires active tenant-scoped Email/WhatsApp replies and signatures; selecting a signature appends it to the working copy. Each conversation's Draft Desk can prepare and revise an intended recipient, subject, body, human-review state, and planned time. These are internal records by construction: the schema has neither a sent/delivered state nor a delivery function, the UI repeatedly states that review and planned time do not send, cross-tenant conversation/template links are rejected, and viewer creation/update is denied. AIOS Control exposes a dedicated `inbox.sla.triage` policy: in Auto it scans at most 25 overdue conversations and creates or advances one deduplicated, same-tenant internal task per conversation. Its deterministic ladder is L1 when overdue, L2 after four hours, and L3 after 24 hours; urgent work advances one tier, and L2/L3 route to an active owner/admin/operations member when available. Stored escalation evidence is database-constrained and resets when the SLA changes or the conversation closes. Observe/Assist do not write, Approval creates a durable human decision, and every attempt has a run/tool ledger. It has no message-sending tool. Resend will later populate the same conversation/message model after the verified-domain, SMTP, and webhook work is complete. Remaining delivery work is the externally connected inbound path plus the separately approved send/retry worker; external inbound/outbound release remains deferred.

**Exit gate:** An inbound email reliably lands in the correct organization, conversation, and customer timeline with no duplicated events.

## Phase 09 — Lead capture, qualification, and deal pipeline

**Goal:** Turn every inquiry into a managed commercial opportunity.

- Build web lead forms, source attribution, lead routing, ownership, scoring fields, and qualification checklists.
- Add deal pipeline stages, probability, expected close date, value, source, loss reason, next step, and activity rules.
- Create Kanban, list, and detail views with drag/drop constrained by permissions and transition rules.
- Add task queues, reminders, SLA alerts, follow-up sequences, and manager escalation.
- Provide pipeline forecast and conversion views that use actual deal data.

**Current progress:** Owners/admins can create, preview, pause, and resume branded public lead forms with a default owner, source, and 5–1,440 minute response target. The public endpoint has bounded bodies, same-origin checks, honeypot/timing friction, keyed request fingerprints, rate limiting, daily deduplication, and UTM/referrer attribution; a server-only atomic function creates or reuses the contact, creates the opportunity and response SLA, and records submission/activity/audit evidence. Commercial roles can define reusable required/optional qualification contracts and ordered internal follow-up playbooks in `/settings/sales-workflows`. Applying a checklist copies immutable labels and guidance onto the opportunity; incomplete required evidence blocks proposal, decision, and won advancement, while completion records actor/time evidence. Applying a playbook atomically creates owner-assigned, explicitly deadlined internal tasks and rejects duplicate application. These tables are browser-read-only, MFA-aware, tenant constrained, and writable only through role-checked audit RPCs. The lead workspace records campaign, commercial value, destination, probability, next step, expected close, first-response/follow-up deadlines, escalation level, won/lost timing, and append-only stage history. Direct stage writes are blocked; a role-checked atomic transition enforces legal movement and qualification/proposal/decision/won/lost criteria, including a loss reason, and reviewed business-rule failures cross the production Server Action boundary without leaking unexpected database details. The live Kanban is ordered from New through Decision, highlights only legal adjacent drag targets, rejects invalid drops before a request, and gives every movable card a keyboard-safe stage selector; both paths still revalidate through the same Server Action and database contract. AIOS can route unassigned work and triage objective lead/SLA risk through policy, creating or escalating one deduplicated internal task and routing L2/L3 risk to management when available. `/leads/[dealId]` supports first-response acknowledgement, commercial planning, governed movement, qualification evidence, playbook scheduling, ownership, private document upload, timeline, and assigned/deadlined follow-ups. The command center exposes live overdue work and a probability-weighted forecast without combining currencies. `/analytics` adds range/source/owner filters, private saved views, response-SLA/conversion/open-pipeline/time-to-win KPIs, source performance, and stage velocity while refusing mixed-currency value aggregation. The 36-test browser suite proves public conversion, response acknowledgement, qualification-gated movement, governed drag/drop and selector movement, sequence task creation, source analytics, capture/workflow management visibility, command-center lead creation/views, and the private upload path. The technical exit gate is implemented; remaining phase work is product-owner acceptance.

**Exit gate:** A lead can move from capture to qualified deal with ownership, follow-up, history, and conversion reporting intact.

## Phase 10 — AIOS platform: safe agent runtime and memory

**Goal:** Create the reusable foundation for agentic capabilities.

- Add model-provider abstraction, prompt/version management, structured Zod outputs, evaluation fixtures, token/cost logging, and fallback behavior.
- Create `ai_runs`, `ai_observations`, `agent_tools`, `tool_calls`, `approval_requests`, and citation/source-reference storage.
- Implement role- and tenant-scoped tool access; agents operate only through explicit tool contracts.
- Add policy checks for dangerous actions, confidence thresholds, prompt-injection defense, PII-aware redaction, and tool-call approval gates.
- Classify every tool as observe-only, internal-write, or external-effect. External-effect tools must have code-enforced hard approval and idempotency keys; an administrator cannot turn that guard into Auto.
- Add an evaluation suite, golden fixtures, adversarial prompt-injection cases, model/version change approval, cost budgets, provider fallback rules, and a kill switch before relying on any model in production.
- Establish durable background jobs for long-running extraction, classification, summarization, and retries.

**Current progress:** The provider router supports GLM, OpenAI, Gemini, Claude, and Qwen adapters without coupling agent contracts to one vendor. Lead Intake and itinerary drafting use structured schemas, deterministic input-safety checks, pre-provider free-text identifier redaction, durable run/tool ledgers, citations, bounded daily execution, explicit release-style prompt versions, and approval-aware policy gates. Each run input and successful result records the applicable prompt version independently from the agent and model version. Immediately before a provider call, both workflows now create or recover one idempotent server-only `ai_jobs` record containing only record IDs, workflow, prompt version, and provider. Atomic 15-minute leases prevent concurrent claims, a worker can settle only its own lease, failures follow a deterministic 30s/120s/480s bounded backoff, exhausted or abandoned final attempts become dead letters, and same-tenant run links are database-enforced. Browser roles can read tenant queue health but cannot enqueue, update, claim, settle, dead-letter, or directly requeue work. The runner re-fetches current tenant records, rechecks input safety/redaction plus the current budget, kill switch, provider policy, configuration, and prompt version, and refuses stale or malformed jobs. A bounded internal endpoint is implemented with constant-time bearer authentication and no-store responses; it remains fail-closed until `AIOS_WORKER_SECRET` and a deployment schedule are configured. Until then, an owner/admin can process up to five ready jobs from AIOS Control, scoped only to their authorized tenant. Dead letters show bounded error and attempt evidence; an owner/admin may explicitly requeue one through an audited server action, but requeueing does not itself execute the model. The Control Plane exposes live queued/running/retry/dead-letter counts. Inline requests claim and settle jobs today, while failed jobs survive for the endpoint or human-operated runner. AIOS Control also exposes every catalogued action's autonomy mode and kill switch. Owners/admins receive a workspace-wide provider-execution switch, a 1–1,000 UTC daily model-run ceiling, a selected provider, an explicit provider allow-list, and per-adapter ready/not-configured visibility without exposing credentials. RLS prevents viewer writes, a same-tenant membership foreign key protects updater identity, and database constraints reject invalid ceilings, unknown providers, and a selected provider outside the allow-list. The runtime applies the current policy immediately before provider calls—including when an approved run resumes—so a stale approval cannot bypass a newer kill switch or provider restriction. The selected adapter still fails closed when its server credential is absent. The control plane reports UTC-day workflow attempts, provider-returned input/output tokens, and unmetered successes. Owners/admins can add immutable, currency-labelled price versions for an exact provider/model; future metered runs link their estimate to the effective same-tenant price row, while missing telemetry or pricing remains explicitly unpriced. No vendor rate is seeded or inferred. A dedicated CI evaluation suite now runs 15 zero-cost golden/adversarial fixtures covering prompt injection, direct-identifier redaction, output validity, citations, trip boundaries, action approval, unknown-tool denial, and prompt-version presence. The server environment ceiling/provider remain fail-safe defaults when a workspace has not stored an override. Remaining platform work includes activating the deployment worker secret/schedule, entering real reviewed provider rates, evaluated provider fallbacks, provider data-region/PII rules, expanded model-quality fixtures, and production threshold sign-off.

**Exit gate:** An agent can read approved tenant context, produce a cited structured result, and is blocked from unapproved external action.

## Phase 11 — Lead, inbox, and sales copilot

**Goal:** Deliver the first valuable AI workflows to daily sales work.

- Build the intake agent: extract traveler, destination, dates, group size, budget, preferences, and missing data from messages/forms.
- Build the sales copilot: conversation summaries, suggested next steps, reply drafts, lead scoring rationale, and stall-risk alerts.
- Add review screens for extracted fields and clear confidence/source evidence before CRM updates.
- Make review application race-safe and observable: require affected-row confirmation, prevent duplicate concurrent applies, retain proposal/decision history, and test acceptance/rejection/task-creation paths.
- Let agents create internal tasks and drafts automatically only within the assigned organization.
- Require approval for external sends and any customer-facing commitment.

**Current progress:** Lead Intake produces structured, cited drafts through the provider router and always requires explicit field selection before CRM updates. Before any provider receives CRM text, AIOS deterministically blocks suspicious instruction-like or oversized lead content, records only safety metadata, and requires a human to rewrite the input. Model outputs are also normalized and rejected unless their travel dates are coherent and their extraction lists are non-duplicative. Its decision ledger has a database-enforced unique `(ai_run_id, field_name)` constraint; the server claims that ledger before it mutates the deal, preventing duplicate concurrent application. When policy permits, missing-information follow-ups are internal tasks linked back to the exact deal and activity timeline. AIOS can also triage up to 25 live objective lead risks into owner-assigned or shared internal follow-ups, with a database constraint preventing duplicate open triage tasks during retries; the same autonomy/approval gate controls this workflow.

**Exit gate:** A sales agent can turn a messy inquiry into a reviewed lead and personalized draft faster than manual entry, with auditable AI actions.

## Phase 12 — Quote, pricing, and profitability workspace

**Goal:** Let teams sell travel profitably and consistently.

- Build reusable products, supplier rates, cost lines, taxes, commissions, markups, discounts, currencies, and margin calculations.
- Create versioned quotes with inclusions, exclusions, terms, approval rules, expiry dates, and customer-ready sharing.
- Implement quote approval thresholds for discounts, low margin, and non-standard terms.
- Track deposit requirements, payment schedules, invoice readiness, and quote acceptance.
- Provide deal-level profitability and conversion insights.

**Current progress:** Quote drafts can now be created atomically with their first immutable version through a server action and a database function. Draft revisions use a row lock, append a new immutable version, and advance the version number without overwriting history. Each new revision records an internal cost estimate atomically, allowing commercial and finance roles to see a gross-margin signal without exposing costs to other workspace roles. Quote data remains workspace-visible, while creation and draft edits are restricted to owner, admin, sales, and trip-designer roles. Any active teammate can request a durable human review for quote sharing; the request is deduplicated while pending and records only the quote/version context. The workspace shows pending review and approved-but-unsent states. Approval does not send a quote, create a share link, or change customer-visible state. External sharing, pricing override, and acceptance remain hard approval territory until their separately tested delivery paths exist.

**Exit gate:** A team can create, approve, share, revise, and accept a profitable quote while preserving a complete version history.

## Phase 13 — Itinerary studio and trip design agent

**Goal:** Turn approved ideas into exceptional, practical journeys.

- Build a day-by-day itinerary editor with destinations, stays, transport, activities, free time, notes, inclusions, and traveler-facing descriptions.
- Add reusable itinerary blocks, templates, destination content, map/location support, and proposal presentation mode.
- Implement the itinerary agent to prepare an editable draft using traveler preferences and approved knowledge sources.
- Add conflict checks for dates, travel time, booking status, and incomplete itinerary items.
- Support internal collaboration, comments, change history, and an approval checkpoint before sharing externally.

**Current progress:** `/itineraries` now provides a tenant-scoped internal studio for creating draft trips and adding ordered day items. Both server actions validate input, check the linked workspace record, require a planning role, and write audit events. Trip and itinerary-item writes are RLS-restricted to owner, admin, sales, trip-designer, and operations roles. Planners can save a trip's day structure as a tenant-scoped reusable template, then explicitly apply a selected template to another draft through row-locked, security-invoker functions; template access is RLS-restricted and covered by the anonymous-read regression check. Any active teammate can add a signed-in-author, append-only internal comment to a real trip, giving the planning team a focused collaboration thread with audit events. The studio deterministically detects duplicate day items, entries beyond known travel dates, invalid time ranges, and overlapping timed entries; these are planning warnings, never availability or booking claims. AIOS deterministically assesses itinerary readiness, records a durable agent run/tool-call ledger, and—only when the `internal.task.create` policy permits—creates one deduplicated internal follow-up for an incomplete trip. A role-authorized teammate can also request a provider-agnostic, cited itinerary preview through its own visible `itinerary.draft.prepare` AIOS policy; the latest schema-validated preview is restored from its durable run ledger on reload. Before a model call, AIOS blocks instruction-like or oversized trip text; after it returns, AIOS rejects duplicate or out-of-range suggestions. Each suggestion needs a distinct human click before the existing server-validated editor adds it; there is no bulk apply or autonomous write. This is planning-only: it cannot book services, access documents, change prices, send messages, or share an itinerary externally.

**Exit gate:** An agent can turn a qualified deal into a reviewable, visually rich itinerary without overwriting human work.

## Phase 14 — Trip workspace, bookings, documents, and traveller portal

**Goal:** Make the transition from sold deal to operating trip seamless.

- Convert accepted deals into trips with travelers, itinerary, bookings, responsibilities, milestones, and operational checklist.
- Build booking records for flights, hotels, transfers, activities, insurance, and custom services; include confirmation state and supplier references.
- Add secure document collection, storage, expiry monitoring, vouchers, and customer-visible document sharing.
- Create a traveler portal for approved itinerary details, payment status, documents, vouchers, support, and trip updates.
- Provide selective customer access with expiring links or authenticated traveler accounts.

**Current progress:** `/trips` now provides a responsive operations control deck and a governed queue of won opportunities awaiting handoff. One row-locked, role/MFA-checked RPC converts each won deal exactly once, reuses an existing linked draft when appropriate, carries the owner/currency/destination and accepted quote reference, creates the lead traveller, and writes append-only lifecycle, activity, and audit evidence. Direct browser status mutation is blocked; operators move only through legal `draft → confirmed → in travel → completed/cancelled` paths, with start-date and actor/note evidence enforced in the database. The trip detail workspace coordinates operating facts, a traveller manifest, internal supplier-service booking records and confirmation references, trip-linked follow-up tasks, an operations-readiness signal, lifecycle rail, and an auditable activity trace. Its private vault validates content signatures, records expiry, and issues only RLS-authorized 60-second signed downloads. The booking ledger explicitly does not contact suppliers, reserve inventory, or charge money. Local schema replay, lint, generated types, anonymous checks, two-tenant authorization tests, 113 behavioral tests, and the complete 38-test browser suite cover this slice, including desktop/mobile and zero-console sweeps. Remaining Phase 14 scope is automated document-expiry alerting, vouchers, approved selective sharing, payment visibility, and the authenticated/expiring traveller portal; the new migration also needs staging and hosted deployment.

**Exit gate:** A confirmed trip can be operated from one workspace and safely shared with travelers without exposing internal notes or margins.

## Phase 15 — Supplier, payment, and finance operations

**Goal:** Close the operational and commercial loop.

- Build supplier profiles, contacts, contracts, rate validity, cancellation terms, service quality, and confirmation workflow.
- Create payment ledger, invoices, payment links, deposits, refunds, payment allocation, and finance approval flows.
- Integrate the chosen payment provider through a provider interface; use signed webhooks, idempotency, and reconciliation states.
- Add multi-currency handling, margin reporting, tax configuration, and accounting-export readiness.
- Restrict finance actions to authorized roles and audit all changes.

**Exit gate:** Every customer and supplier financial obligation can be tracked, reconciled, and audited without a spreadsheet as the source of truth.

## Phase 16 — Operations radar and durable workflow automation

**Goal:** Prevent avoidable trip failures.

- Create the operations agent to monitor confirmations, payment due dates, missing documents, visa expiry, itinerary conflicts, and service SLAs.
- Build workflow triggers, rules, escalation paths, templates, schedules, and configurable ownership.
- Add durable retry/replay behavior, dead-letter handling, and idempotent event processing.
- Surface an exception queue with impact, owner, deadline, recommended action, and resolution history.
- Allow low-risk internal automation; require approval for supplier/customer communication and booking changes.

**Exit gate:** At least five high-value operational risks are detected and routed before they become customer incidents.

## Phase 17 — Knowledge system and retrieval with citations

**Goal:** Make internal expertise safely useful to people and agents.

- Ingest and curate supplier terms, destination guides, visa information, SOPs, product sheets, and policy documents.
- Add document chunking, source attribution, metadata, permission filtering, versioning, and freshness/review dates.
- Use pgvector only as a retrieval feature alongside transactional Postgres; do not create an ungoverned knowledge silo.
- Return citations, source links, and “unknown/out-of-date” states for AI answers.
- Create knowledge review workflows so operators can correct and approve material used by AIOS.

**Exit gate:** Users can ask a policy or supplier question and receive a tenant-permitted, cited answer that links to the source material.

## Phase 18 — Intelligence, reporting, and management controls

**Goal:** Give leaders accurate visibility and actionable forecasts.

- Create dashboards for lead source, conversion, sales velocity, pipeline coverage, forecast, margin, supplier performance, trip incidents, and repeat bookings.
- Add configurable reporting periods, saved dashboards, permission-aware exports, and scheduled report delivery.
- Build AI insight cards that explain anomalies with source data rather than unsupported claims.
- Add quality controls for stale data, incomplete deal fields, uncategorized costs, and unassigned conversations.
- Define metric ownership and glossary so teams interpret the same numbers consistently.

**Current progress:** `/analytics` is live for sales review with configurable date range, source, and owner filters plus private user/tenant-scoped saved views. It calculates conversion, open pipeline count, first-response SLA attainment, average time to win, source performance, and stage velocity from tenant-authorized deal and stage-history rows. Monetary KPIs display only when the filtered result has one currency; mixed-currency data is explicitly marked rather than falsely aggregated. The command center retains its near-term weighted forecast and operational attention signals. Remaining work is margin/supplier/trip/incident reporting, scheduled delivery/export controls, metric ownership/glossary, completeness monitoring, and cited AI anomaly explanations.

**Exit gate:** Leadership can run weekly sales and operations reviews from AIOS without assembling separate spreadsheets.

## Phase 19 — Integration hardening, quality assurance, and security review

**Goal:** Prove the product is dependable under real-world conditions.

- Complete unit, integration, end-to-end, accessibility, cross-browser, mobile, load, retry, and failure-mode testing.
- Test integration webhook signatures, duplicate delivery, timeouts, partial failures, rate limits, and reconciliation.
- Run RLS/authorization test suites, dependency scanning, secret scanning, threat-model review, and external security assessment.
- Require CI to fail on missing migrations/types, failed policy tests, secret findings, high/critical dependency advisories (when the registry is available), and unsafe agent-evaluation regressions.
- Establish backup restore drills, retention tests, incident runbooks, support playbooks, and disaster-recovery objectives.
- Run AI red-team/evaluation cases for unsafe tool use, prompt injection, hallucination, sensitive-data exposure, and approval bypass attempts.

**Current progress:** Local release verification currently passes a clean migration replay, generated-type drift check, schema lint, Supabase security and performance advisors, 113 behavioral tests, 15 no-provider AI safety evaluations, strict TypeScript, ESLint, source secret scanning, a production build, zero known npm vulnerabilities, a 47-table anonymous-access probe, and a disposable owner/viewer authorization suite covering cross-tenant reads/writes/RPCs, governed deal/trip changes, idempotent won-deal conversion, qualification evidence, internal follow-up playbooks, lead capture, and private storage. The prior hosted schema and probes were synchronized; the new operational-trip migration is intentionally pending a staging-first hosted deployment. All 38 Chromium journeys pass, including public lead capture, authenticated tenant switching, every implemented workspace surface, mobile overflow, response acknowledgement, commercial planning, atomic evidence-gated stage movement, governed drag/drop plus selector fallback, Contacts/Inbox/Tasks/Quotes/Itinerary/Trip Operations/Team/AIOS mutation workflows, internal sequence tasks, analytics, human approval resolution, private document upload/download, live TOTP enrollment/removal, and a protected-route sweep with no browser errors or warnings. The complete matrix and defects corrected during the review are recorded in `docs/ui-wiring-audit.md`. Remaining work is CI confirmation on a protected remote, staged migration deployment, WebKit/Firefox, authenticated keyboard/assistive-technology testing, load/failure/webhook tests, production-like restore and rollback drills, external review, and launch-threshold acceptance.

**Exit gate:** Critical paths meet defined reliability/security thresholds and all launch-blocking issues are resolved or formally accepted.

## Phase 20 — Pilot, launch, and continuous improvement

**Goal:** Release safely, learn from real operators, and establish the operating cadence.

- Onboard a small pilot group with migrated contacts, controlled permissions, training, and named support owners.
- Measure actual response time, conversion, time saved, margin, exception rate, and AI approval/rejection rate against Phase 01 targets.
- Run weekly pilot review, fix adoption friction, and tune automations/prompts using evaluation data.
- Prepare production rollout checklist: DNS, email domain verification, monitoring, on-call, support intake, release notes, data-processing material, and rollback plan.
- Graduate from pilot to general availability only after business metrics, security controls, and support readiness are met.

**Exit gate:** AIOS is running real travel workflows in production with monitored reliability, trained users, secure controls, and a prioritized post-launch roadmap.

## Cross-phase release gates

No phase may be marked complete unless it includes:

1. Typed domain models and migration/repository changes where data is involved.
2. Authorization and RLS verification for any tenant-owned or sensitive data.
3. Empty, loading, error, permission-denied, and mobile states.
4. Audit events for high-impact actions.
5. Tests proportional to the risk of the change.
6. Documentation for user-visible behavior and operational support.
7. Product-owner acceptance against its phase exit gate.

## Suggested implementation cadence

- **Stabilization release (current):** The local engineering slice—source-control initialization, reproducible schema/seed/types, database-advisor remediation, Auth parity, responsive dashboard/AIOS fixes, authenticated browser coverage, and CI migration validation—is complete. The release still waits on credential rotation, external email setup, environment separation, observability, and broader acceptance evidence.
- **CRM release:** Complete Phases 07–09 with real customer/activity/inbox data, not placeholder dashboard modules.
- **AI-assisted sales release:** Complete Phases 10–13 with tool contracts, evaluation gates, and approval-first external actions.
- **Travel operations release:** Phases 14–16.
- **Intelligence and launch release:** Phases 17–20.

This sequence intentionally makes AIOS trustworthy before it becomes powerful. The first agent already proves the desired operating model—AIOS can analyse and propose, a human can selectively accept, and low-risk follow-up work can proceed only inside policy. Each new agent must earn broader authority through the same evidence, policy, and audit gates.
