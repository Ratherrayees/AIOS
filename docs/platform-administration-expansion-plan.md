# AIOS platform administration expansion plan

Prepared: 17 August 2026

## Outcome

Expand the existing, independently authorized `/platform` control plane into a production-grade SaaS administration system without weakening tenant row-level security or disrupting the agency CRM.

The current platform workspace remains the baseline. Overview, Agencies, System Health, Platform Email, Audit Log, Platform Access, MFA mutation gates, and the final-superadmin database invariant must continue to work throughout the program.

## Current implementation checkpoint — 17 August 2026

Batch A (Phases 0–4) is implemented through its application and database gates:

- Platform and agency authority are formally separated in [`adr-platform-tenant-authority.md`](adr-platform-tenant-authority.md); unreleased commercial, reliability, rollout, support, and analytics modules have typed server-only flags that default to disabled.
- Post-auth routing sends platform-only users to `/platform`, agency-only users to the CRM, and dual-role users to a neutral chooser until they select a context. The selected authority is stored in an HttpOnly preference cookie and is revalidated against live membership/platform authority before use.
- One server capability catalog protects every platform read and mutation. Superadmin-only operations remain unavailable to `platform_admin`, and sensitive mutations require AAL2 MFA.
- Agencies have metadata-only detail, additive lifecycle state/history, immediate tenant access enforcement, atomic superadmin-only provisioning, one-way owner invitation tokens, and safe invitation rotation/resend using platform-owned email. No platform role receives tenant CRM access.
- Users & Security has a privacy-minimized global directory/detail, provider-backed MFA status, canonical account suspension, Auth ban alignment, immediate session invalidation, required password reset, security history, and deterministic missing-MFA/dormant-privilege/orphaned-agency signals. Repeated failed-sign-in alerting remains explicitly assigned to external Auth log monitoring rather than inferred from successful-session metadata.

Hosted Supabase is synchronized through migration `20260817100000`. The final checkpoint passes 316 behavioral tests, strict TypeScript, ESLint, the style guard, a source scan with zero detected secrets, the Next.js 16.3 production build, 92 protected-table probes, 76 RPC boundary probes, all 485 disposable authenticated authorization assertions locally and hosted, and all three focused Chromium platform journeys. A signed-in visual pass also verified the superadmin agency registry/provisioner and identity-security signal desk; it found and corrected a false MFA warning by switching from paginated user metadata to Supabase's dedicated admin factor endpoint.

The remaining Batch A release item is production Auth failure-log ingestion/alerting plus the deployment-wide environment, monitoring, backup, rollback, credential-rotation, and operator-acceptance gates. Provider-backed commercial processing and Phases 6–12 remain deliberately unreleased and server-disabled.

## Current Phase 5 foundation checkpoint — 17 August 2026

The provider-neutral commercial foundation is now implemented and deployed through migration `20260817101000`:

- Immutable, versioned platform plans carry a currency-safe price and a complete typed entitlement set. Draft versions may activate once; active versions may retire once; product versions are never edited in place.
- One canonical organization subscription supports trialing, active, past-due, grace, and canceled states with reviewed transition rules, optimistic concurrency, immutable events, and a new entitlement snapshot for every version.
- `/platform/billing` gives both platform roles a metadata-only portfolio view. `platform_admin` is read-only; only an MFA-verified `superadmin` can create a plan version, activate/retire it, or assign/change an agency subscription with a reason and exact confirmation.
- `/settings/billing` gives agency owners/admins only their plan, subscription dates/status, prices, and canonical entitlement snapshot. It exposes no other tenant, provider reference, credential, platform audit, or commercial mutation.
- Platform billing credentials remain separate from agency Stripe/Razorpay integrations. Existing provider setup does not authorize product access, and no live checkout, charge, webhook, refund, invoice, credit, or automatic suspension was enabled.
- The local and hosted projects now pass 99 protected-table probes, 80 guarded-RPC probes, and all 490 disposable authorization assertions. The application passes 316 behavioral tests, strict TypeScript, ESLint, style/secret guards, and the Next.js 16.3 production build.

Remaining Phase 5 scope is provider-account selection, billing accounts, invoices/credits/adjustments, signed idempotent webhook ingestion and ordered reconciliation, self-service checkout/portal, grace-policy automation, server-side entitlement enforcement on billable features, provider outage behavior, operator/product acceptance, and production runbooks. Those capabilities remain disabled rather than simulated as live billing.

The first Phase 6 observation slice is also deployed through migration `20260817102000`. `/platform/usage` provides platform admins and superadmins a 30/90/365-day aggregate desk for active users, AI runs and token totals, currency-separated estimated model costs, current private-document bytes, inbound/outbound email counts, queued/failed AI jobs, and management-report deliveries. A service-only database function returns one bounded row per agency and rejects browser calls; it never returns customer records, prompts, model results, messages, file names, recipients, payloads, or credentials. Current plan limits are compared only where the entitlement snapshot makes that comparison coherent, and the screen explicitly remains observational rather than an invoice or enforcement event. Local and hosted authorization now pass 492/492 assertions with 81 guarded RPC probes. Remaining Phase 6 work is immutable daily usage settlement, quota policies and expiring overrides, warning/soft/hard enforcement, platform AI provider governance, anomaly alerting, and reconciliation/runbooks.

## Non-negotiable architecture

- Platform authority remains independent from agency membership.
- A platform role never implies access to leads, contacts, conversations, quotes, trips, documents, finance records, prompts, or tenant credentials.
- Cross-tenant reads use narrowly shaped server-side projections after verified platform authorization; never expose the service-role key or unrestricted clients.
- Every privileged mutation requires AAL2 MFA, an explicit capability, validation, an immutable audit event, and an idempotency strategy where retries are possible.
- Superadmin is not a permanent tenant-data bypass. Support access must be time-bound, purpose-bound, least-privileged, visible, revocable, and audited.
- New schema changes are additive first. Destructive migrations, renames, and enum replacement happen only after dual-read/dual-write compatibility and rollback evidence.
- Agency users must not see platform terminology, platform navigation, platform incidents, other tenant identities, platform credentials, or commercial administration that is outside their workspace.
- New platform features ship behind server-enforced capabilities and, where risk warrants it, disabled-by-default release flags.

## Target authority model

| Capability | Agency owner/admin | Platform admin | Superadmin |
| --- | --- | --- | --- |
| Operate an agency CRM | Explicit membership only | Explicit membership only | Explicit membership only |
| View tenant registry metadata and aggregate health | No | Yes | Yes |
| Manage platform service configuration | No | Yes, with MFA | Yes, with MFA |
| Retry bounded platform jobs and webhooks | No | Yes, with MFA | Yes, with MFA |
| Provision or suspend an agency | No | Capability-gated | Yes, with MFA |
| Manage plans, entitlements, and platform feature rollout | No | Capability-gated | Yes, with MFA |
| Grant or suspend platform authority | No | No | Yes, with MFA |
| Open tenant customer records | Membership or approved tenant role | No implicit access | No implicit access |
| Start a support session | No | Only through an approved grant | Only through an approved grant |

Keep `platform_admin` and `superadmin` as the initial roles. Introduce explicit capability checks before adding more named roles. Once real staffing requires it, the same capability system can safely support `support_admin`, `billing_admin`, `security_admin`, and `platform_auditor` without duplicating authorization logic.

## Phase 0 — Baseline and change controls

Goal: freeze the current platform behavior as a regression contract before expanding it.

Deliverables:

- Record the current platform route, action, schema, and role inventory.
- Convert the platform capability map into a single server-consumable catalog.
- Add an architectural decision record for the tenant/platform boundary.
- Tag all existing platform queries as metadata, aggregate, credential, or authority data.
- Add fixtures for platform-only, agency-only, dual-role, suspended-platform, and non-MFA identities.
- Establish feature flags for unreleased platform modules.

Exit gate:

- Existing platform and agency browser journeys remain green.
- A platform-only identity cannot query tenant CRM rows.
- A dual-role identity can access only explicitly selected agency memberships.

Dependencies: none.

## Phase 1 — Role-aware authentication and workspace entry

Goal: stop platform operators from feeling like agency customers after login.

Deliverables:

- Add a server-side post-authentication router.
- Route platform-only identities directly to `/platform`.
- Route agency-only identities to their active agency workspace.
- Show a neutral workspace chooser for identities that hold both authorities and have no saved preference.
- Persist the last authorized context without trusting a client-supplied organization or route.
- Keep invitation and password-recovery destinations intact.
- Add separate platform-oriented sign-in context when `/platform` initiated authentication.

Exit gate:

- Platform-only users never see “No workspace assigned.”
- Open redirects and forged workspace preferences fail closed.
- Sign-in, signup verification, invitations, MFA challenges, and recovery retain their intended destinations.

Dependencies: Phase 0.

## Phase 2 — Capability-based platform authorization

Goal: make platform privileges explicit and extensible instead of relying on route-level role comparisons alone.

Deliverables:

- Define capabilities such as `platform.overview.read`, `tenant.registry.read`, `tenant.lifecycle.manage`, `platform.email.manage`, `platform.jobs.retry`, `platform.billing.manage`, `platform.flags.manage`, `platform.support.request`, `platform.audit.read`, and `platform.access.manage`.
- Map the existing two roles to capabilities on the server.
- Require capabilities inside every platform action as well as at page boundaries.
- Add database-backed overrides only if a real operational need is approved; default to immutable role maps for simpler review.
- Include actor role, capability, target type, target ID, reason, request ID, result, and timestamp in platform audit evidence.
- Add reauthentication or recent-MFA requirements for exceptionally sensitive actions.

Exit gate:

- Removing navigation never becomes the authorization control.
- Every platform mutation has a negative test for platform admin, superadmin, suspended operator, missing MFA, and ordinary agency member as applicable.
- No capability grants agency membership or blanket tenant RLS access.

Dependencies: Phase 0.

## Phase 3 — Agency detail and lifecycle administration

Goal: turn the read-only agency directory into a safe tenant-operations workspace.

Deliverables:

- Add `/platform/agencies/[organizationId]` with identity, owner contacts, lifecycle state, membership counts, integration readiness, usage summary, service incidents, and immutable lifecycle history.
- Introduce explicit lifecycle states such as `provisioning`, `active`, `restricted`, `suspended`, and `archived` in an additive lifecycle record rather than overloading membership status.
- Add platform-assisted agency provisioning with unique slug validation and owner invitation.
- Add suspend, reactivate, and archive workflows with reason, confirmation, impact preview, MFA, and audit evidence.
- Fail closed for suspended agencies at active-workspace resolution and protected mutations while preserving lawful data retention.
- Never hard-delete an agency from the UI. Define a separate privacy/legal erasure runbook.
- Add bulk operations only after single-agency lifecycle behavior is proven.

Exit gate:

- Suspending Agency A cannot affect Agency B.
- Existing sessions for a suspended agency lose access predictably.
- Reactivation restores authorized access without rewriting historical records.
- Lifecycle changes are idempotent, audited, and protected from self-inflicted platform lockout.

Dependencies: Phases 1 and 2.

## Phase 4 — Global identity and security operations

Goal: give platform security staff visibility into accounts without exposing credentials or tenant content.

Deliverables:

- Add a searchable global user directory with identity status, verified-email state, MFA enrollment state, last sign-in summary, platform role, and agency membership count.
- Add user detail showing memberships and security events without customer records.
- Support disable/restore account, revoke sessions, resend approved invitations, and require password reset using provider-supported administrative APIs.
- Require reason, MFA, confirmation, and audit evidence for security mutations.
- Separate identity suspension from agency membership suspension.
- Add anomaly signals for repeated failed sign-in, dormant privileged accounts, missing MFA, and orphaned agencies.

Exit gate:

- No password, token, recovery secret, raw session, or tenant payload reaches the browser.
- Revocation behavior is proven across existing sessions.
- Agency administrators retain control of their team within their agency boundary.

Dependencies: Phase 2; agency membership summaries benefit from Phase 3.

## Phase 5 — Plans, subscriptions, billing, and entitlements

Goal: add the commercial control plane without coupling payment-provider state directly to product authorization.

Deliverables:

- Add versioned plans, prices, subscriptions, trials, billing accounts, invoices, adjustments, and entitlement snapshots.
- Treat provider webhooks as evidence; settle canonical subscription state through idempotent service transactions.
- Add plan assignment, trial extension, scheduled change, cancellation, grace period, and manual adjustment workflows.
- Make entitlements the product-access contract; do not scatter Stripe/Razorpay plan-name checks through UI components.
- Keep platform billing credentials separate from agency payment integrations.
- Add customer-safe billing views for agency owners and privileged platform views for billing operations.
- Reconcile webhook replay, duplicate delivery, out-of-order events, refunds, failed payments, and provider outages.

Exit gate:

- Entitlement checks are enforced server-side and are tenant-scoped.
- Billing-provider retries cannot duplicate subscriptions, credits, or invoices.
- A billing outage does not erase CRM access without an approved grace policy.

Dependencies: Phases 2 and 3.

## Phase 6 — Usage, quotas, AI cost, and provider governance

Goal: let platform operators understand and govern resource consumption safely.

Deliverables:

- Add daily immutable or append-only usage aggregates for model tokens/cost, storage, email, WhatsApp, API calls, active users, jobs, and documents.
- Add tenant quota and rate-limit policies with warning, soft-limit, and hard-limit behavior.
- Add platform AI provider configuration, model catalog, data-region policy, price versions, fallback health, and tenant allow-list defaults.
- Keep tenant-owned provider credentials in the tenant vault and platform-owned credentials in the platform vault.
- Add cost anomaly alerts and explainable usage drill-downs that avoid prompt/customer content.
- Add controlled quota overrides with expiry, reason, and audit history.

Exit gate:

- Usage aggregation is currency-safe, retry-safe, and cannot mix tenants.
- Quota enforcement fails predictably and provides customer-safe recovery guidance.
- Model routing never crosses a tenant’s approved provider or data-handling policy.

Dependencies: Phases 2, 3, and the entitlement contract from Phase 5.

## Phase 7 — Reliability and incident operations

Goal: turn System Health from aggregate observation into bounded operational action.

Deliverables:

- Add queue and worker drill-downs using metadata-only payload summaries.
- Add retry/requeue for eligible AI jobs, inbound email events, outbound deliveries, reports, and webhooks.
- Require idempotency keys, attempt limits, dead-letter rules, and capability/MFA checks.
- Add provider status, worker heartbeat, queue age, error-rate, and latency signals.
- Add incident records, ownership, severity, timeline, affected tenants, status communication, and resolution evidence.
- Provide links to runbooks rather than exposing infrastructure secrets or raw logs.
- Add circuit breakers and visible degraded-mode behavior.

Exit gate:

- Replaying the same event cannot duplicate customer messages, payments, tasks, or model effects.
- Operators can resolve supported failures without database-console access.
- Tenant payloads remain hidden from general platform operations.

Dependencies: Phases 2 and 3. This phase can run in parallel with commercial work after those foundations.

## Phase 8 — Feature flags, releases, and platform communications

Goal: support controlled product rollout and customer communication.

Deliverables:

- Add typed platform feature definitions with environment, plan, tenant, cohort, percentage, start, expiry, owner, and kill-switch controls.
- Evaluate flags server-side for privileged or billable behavior; client flags control presentation only.
- Add change preview, conflict detection, approval for high-impact rollout, and immutable history.
- Add maintenance notices, incident banners, release notes, and onboarding announcements with tenant targeting.
- Keep external delivery approval-gated and provider-neutral.

Exit gate:

- A disabled feature cannot be invoked through a direct server request.
- Rollback is immediate and independently tested.
- Tenant targeting never leaks one agency’s identity or configuration to another.

Dependencies: Phases 2 and 3; plan targeting depends on Phase 5.

## Phase 9 — Time-bound support access

Goal: support agencies without creating permanent superadmin access to tenant records.

Deliverables:

- Add support-access requests with tenant, purpose, scope, requester, approver, start, expiry, and case reference.
- Default to read-only, masked, task-specific support views.
- Require tenant approval where operationally possible; define a separately reviewed break-glass process for security incidents.
- Display an unmistakable support-session banner and countdown.
- Record every viewed object category and every attempted mutation without storing sensitive content in platform audit metadata.
- Revoke automatically on expiry, sign-out, incident closure, or tenant revocation.
- Never represent the session as the tenant user and never silently impersonate an owner.

Exit gate:

- Expired grants fail immediately at the server boundary.
- Support access cannot be converted into ordinary membership accidentally.
- All support access is explainable to the affected tenant and an auditor.

Dependencies: Phases 2, 3, and 4. Build only after legal/privacy policy approval.

## Phase 10 — Platform analytics and executive reporting

Goal: provide platform decisions from aggregate evidence rather than tenant-record browsing.

Deliverables:

- Add activation, adoption, retention, churn, plan conversion, integration readiness, support volume, reliability, and AI cost dashboards.
- Define metric contracts and event provenance before drawing charts.
- Keep monetary values currency-separated and cohorts time-zone aware.
- Add formula-safe exports and scheduled aggregate reports.
- Add data-quality indicators, excluded-record counts, and freshness timestamps.

Exit gate:

- Metrics reconcile against canonical billing, lifecycle, usage, and incident records.
- Exports contain no customer conversation, document, prompt, credential, or unnecessary personal data.

Dependencies: Phases 3, 5, 6, and 7.

## Phase 11 — Security, privacy, resilience, and accessibility hardening

Goal: make the expanded control plane production defensible.

Deliverables:

- Threat-model every new platform capability and cross-tenant projection.
- Add authorization matrix tests, RLS probes, service-action tests, audit completeness tests, and secret scans.
- Add rate limits, CSRF/origin protection where applicable, secure headers, log redaction, and abuse monitoring.
- Verify backup/PITR, restore, credential rotation, provider failover, incident rollback, and lifecycle rollback.
- Complete keyboard, screen-reader, focus, zoom, responsive, empty/loading/error, and destructive-confirmation acceptance.
- Add observability for authentication failures, privileged mutations, job replay, support access, billing reconciliation, and flag changes.

Exit gate:

- No unresolved critical/high security finding.
- All platform mutations have successful, denied, replay, race, and rollback evidence.
- Platform pages pass the same design system, responsiveness, and console-clean standards as the agency CRM.

Dependencies: continuous; final gate follows Phases 1–10.

## Phase 12 — Staged release and operational acceptance

Goal: deploy without exposing unfinished authority or commercial behavior.

Deliverables:

- Deploy additive migrations to an isolated staging project.
- Run seeded multi-tenant scenarios including platform-only, agency-only, dual-role, suspended, billing-failed, incident-affected, and support-grant identities.
- Conduct operator acceptance with a superadmin, platform admin, agency owner, billing operator, and support operator.
- Release modules in order: entry routing → agency detail → identity security → incident operations → billing/entitlements → usage/AI governance → flags/communications → support access → analytics.
- Maintain per-module kill switches and tested rollback procedures.
- Record production owners, escalation paths, service-level objectives, and launch acceptance.

Exit gate:

- Every released module has an owner, runbook, alert, rollback, audit trail, and passing tenant-isolation evidence.
- Deferred modules remain inaccessible through both UI and server actions.

Dependencies: all applicable phases.

## Recommended delivery batches

### Batch A — Platform identity and tenant operations

Phases 0–4. The application/database slice is implemented and verified as described above. Production Auth failure-log monitoring and operational acceptance remain before this batch is formally released.

### Batch B — Reliability and commercial control

Phases 5–7. Entitlements, usage governance, and bounded incident actions establish the operational and economic foundation.

### Batch C — Controlled rollout and support

Phases 8–10. Feature delivery, approved support access, and executive analytics build on stable lifecycle, identity, billing, usage, and incident records.

### Batch D — Production acceptance

Phases 11–12. Security, resilience, accessibility, staging, rollback, and operator acceptance are release gates, not cleanup work.

## Definition of complete

The platform administration program is complete only when:

- Platform-only users enter a dedicated control plane directly.
- Agency lifecycle, identity security, billing, entitlements, usage, reliability, feature rollout, and aggregate reporting have working platform surfaces and server-enforced authority.
- Superadmin authority remains distinct from agency membership.
- Support access is temporary and auditable rather than an unrestricted tenant bypass.
- Every sensitive action requires the appropriate capability, MFA, reason, confirmation, audit evidence, and tested rollback.
- All existing CRM, AIOS, integration, approval, email, and tenant-isolation journeys continue to pass.
- Production monitoring, backups, recovery, credential rotation, incident ownership, and operator acceptance are complete.
