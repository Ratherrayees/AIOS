# AIOS screen, component, flow, and role audit

Reviewed: 12 August 2026

## Executive verdict

The product now behaves as one travel CRM with AIOS embedded into daily work, not as a collection of feature landing pages. The agency workspace uses one persistent shell and task-first hierarchy. Platform administration now uses a deliberately separate control-plane shell and never inherits agency navigation or customer-data context.

The remaining release work is deployment configuration and hands-on accessibility acceptance, not a missing primary CRM or platform-admin screen. Live Stripe/Razorpay money movement and WhatsApp execution remain honest post-MVP integrations; their current settings surfaces are configuration-only.

| Audit dimension | Earlier structural risk | Current verdict |
| --- | --- | --- |
| Information architecture | Module-specific navigation and competing page hierarchies | Pass: one agency shell, one separate platform shell |
| Daily CRM usability | Marketing copy displaced business objects | Pass: operational header, filters/actions, then business object |
| AIOS comprehension | AI machinery dominated the product | Pass: AI work is embedded; diagnostics are secondary |
| Tenant/platform separation | Platform pages appeared inside the active agency shell | Pass: separate layout, navigation, role labels, and data contract |
| Privileged authorization | Platform roles were nearly identical and mutations had no MFA gate | Pass: superadmin-only authority management; every platform mutation requires AAL2 |
| Responsive behavior | Dense tables and controls could expand the mobile page | Pass: page stays viewport-bound; data tables scroll inside their container |
| Loading/empty/error truth | Some empty states resembled unresolved loading | Pass: shared loading, empty, and retryable error states |
| Visual consistency | Several modules felt like separate products | Pass with minor polish debt: one neutral system and purple accent |

## Platform and tenant authority model

Platform authority and agency membership are independent records. Neither platform role can read leads, contacts, conversations, quotes, trips, documents, finance records, model prompts, or tenant credentials unless the same person also receives an explicit membership in that agency. Platform screens expose registry metadata and aggregate reliability signals only.

| Capability | Agency owner/admin | Platform admin | Platform superadmin |
| --- | ---: | ---: | ---: |
| Operate one agency CRM | With membership | No implicit access | No implicit access |
| Manage agency team and tenant integrations | Yes, role permitting | No | No |
| Review platform overview, agency readiness, and aggregate health | No | Yes | Yes |
| Configure platform-owned email | No | Yes, with MFA | Yes, with MFA |
| Review privacy-minimized platform audit events | No | Yes | Yes |
| Grant, change, or suspend platform operators | No | No | Yes, with MFA |
| Demote, suspend, or delete the last active superadmin | No | No | Database blocks it |
| Read tenant or platform credential ciphertext in a browser | No | No | No |

`platform_admin` is the day-to-day operations role. `superadmin` adds only authority-directory management. Sensitive writes are performed by server actions after verified identity, active role, and MFA checks; browser RLS remains read-minimized. The database independently protects the final active superadmin.

## Screen-by-screen audit

### Public, identity, and account recovery

| Screen | Primary job | QA and UX verdict | Remaining acceptance |
| --- | --- | --- | --- |
| `/sign-in` | Authenticate and preserve safe return path | Clear fields, recovery link, private response, helpful errors | Production Auth SMTP and callback allow-list |
| `/sign-up` and `/auth/verify-email` | Create an account with a strong password and prove email ownership | Name/email/password requirements, in-app six-digit OTP, masked address, resend cooldown, expiry recovery, and safe invitation/onboarding return paths | Hosted `auth@lumierah.in` SMTP and code-only Supabase template activation |
| `/forgot-password` | Request recovery without account enumeration | Generic success language and bounded input | Production SMTP |
| `/update-password` | Change password only inside a recovery session | Fails closed without session; strengthened password guidance | Final production callback test |
| `/auth/invite` | Accept a tenant invitation safely | Preserves secure sign-in return path and no-store behavior | Production invite-email test |
| `/auth/mfa` | Complete second-factor verification | Authenticator flow, retry, and sign-out escape are wired | Hands-on recovery-code/support procedure |
| `/onboarding` | Create the first agency and owner context | Clear transition from account to tenant; protected server mutation | Pilot copy review |
| Unknown routes | Recover from invalid navigation | Branded, concise 404 with one safe return action | None |

### Today and daily operations

| Screen | Primary job | QA and UX verdict | Remaining acceptance |
| --- | --- | --- | --- |
| `/` | Show what needs attention now | Attention, replies, tasks, pipeline, departures, money, and AI approvals are prioritized; no marketing hero | Tune ranking with pilot usage |
| `/inbox` | Work customer conversations | Three-pane mental model, ownership/SLA controls, templates, internal notes, AI draft review, saved views | Live inbound/outbound provider acceptance |
| `/tasks` | Work owned follow-ups | Board/list work appears early; personal/all/overdue scope and lifecycle are wired | Pilot density preference |

### Sales and customer records

| Screen | Primary job | QA and UX verdict | Remaining acceptance |
| --- | --- | --- | --- |
| `/leads` | Work the governed pipeline | First-class route, board movement, accessible stage control, filters, saved views, and no 404 | Pilot stage naming |
| `/leads/[dealId]` | Join opportunity, person, conversation, quote, itinerary, and activity context | Central opportunity workspace is now the sales hub; AI summary and next steps remain reviewable | More compact activity timeline at very high volume |
| `/contacts` | Search and manage traveller/company records | Directory first; creation/import/merge are progressive actions; consent, ownership, preferences, and saved views are wired | Large-dataset virtualisation after pilot scale |
| `/quotes` | Build and govern commercial proposals | Drafts, immutable revisions, costs/margins, catalog rates, guardrails, approval, schedule, and next action are explicit | Jurisdiction-specific tax/legal approval |
| `/quotes/[quoteId]/preview` | Review exact customer-safe proposal | Protected, version-bound preview without internal cost leakage | Print/mobile acceptance on target devices |

### Travel and operations

| Screen | Primary job | QA and UX verdict | Remaining acceptance |
| --- | --- | --- | --- |
| `/itineraries` | Design the trip plan | Day/time/time-zone plan, templates, comments, readiness, AI suggestions, and explicit empty-plan state | Pilot drag/reorder feedback |
| `/trips` | Prioritize active travel operations | Departure, risk, documents, payment, and lifecycle are visible in one consistent workspace | Pilot exception-severity tuning |
| `/trips/[tripId]` | Operate one trip | Traveller readiness, bookings, tasks, documents, radar, lifecycle, and commercial handoff are connected | Destination-specific checklist templates |
| `/trips/[tripId]/portal` | Configure approved traveller visibility | Scope is explicit and publication/revocation are governed | Production storage/CDN acceptance |
| `/portal/[token]` | Give travellers a deliberately narrow trip view | Invalid/revoked links fail closed; internal finance and operations data are excluded | Production-domain/device acceptance |
| `/suppliers` | Maintain supplier memory and commercial terms | Dedicated route; contacts, rates, contracts, and finance handoff are no longer bundled | Supplier dedupe at scale |
| `/finance` | Work receivables, payables, invoices, settlements, and exports | Dedicated money workspace, role gates, exact evidence, and no mixed-currency totals | Live payments remain post-MVP |
| `/sandbox/pay/[token]` | Demonstrate provider flow without money movement | Clearly labeled zero-money environment and bounded token | Remove/disable if a live provider replaces it |

### Intelligence and AI work

| Screen | Primary job | QA and UX verdict | Remaining acceptance |
| --- | --- | --- | --- |
| `/analytics` | Explain management performance | Charts and evidence links dominate; overflow repaired; aggregates remain currency-safe | Pilot KPI prioritization |
| `/knowledge` | Curate sources and answer with citations | Repository-first hierarchy, lifecycle/review, conflict handling, and cited Answer Desk | Production source ownership process |
| `/aios/activity` | Review what AIOS did and why | Separate route with filters, bounded evidence, cost/run status, and diagnostics beneath ordinary language | High-volume retention/pagination policy |
| `/aios/approvals` | Decide external or sensitive effects | Personal/workspace queues, role-aware decision rights, escalation, and exact evidence | Approval SLA notification channels |
| `/aios/automations` | Choose Manual, Assisted, or Autopilot and advanced policy | Operating mode is Level 1; granular categories and budgets are Level 2 | Pilot-safe default calibration |
| `/aios` | Preserve legacy AIOS entry links | Redirects to the relevant first-class AIOS surface | Remove only after bookmark telemetry permits |

### Agency administration

| Screen | Primary job | QA and UX verdict | Remaining acceptance |
| --- | --- | --- | --- |
| `/settings/team` | Manage members, invitations, and agency roles | Owner safeguards, suspension, invite/revoke, and plain role names are wired | Production invitation delivery |
| `/settings/integrations` | Configure tenant-owned providers | Category overview plus one-provider drawer; secrets appear only on intent; setup/test/enable states are truthful | Provider credentials and deployed callbacks/workers |
| `/settings/lead-capture` | Create and manage public intake forms | Create, preview, pause/resume, SLA, and public route are connected | Production-domain spam/rate acceptance |
| `/settings/sales-workflows` | Configure qualification and follow-up rules | Structured editor replaces punctuation syntax while preserving action contracts | Pilot template defaults |
| `/settings/security` | Manage password and MFA | Account-scoped security is separate from team roles; TOTP enrol/verify/remove passes | Recovery/support runbook |
| `/lead/[token]` | Capture a public agency lead | Bounded, deduplicated, rate-aware endpoint; unknown tokens fail closed | Production abuse monitoring |
| `/proposal/[token]` | Present and accept an approved quote | Customer-safe immutable snapshot, exact acceptance, and revocation | Production email/link delivery |

### Platform administration

| Screen | Primary job | QA and UX verdict | Role boundary |
| --- | --- | --- | --- |
| `/platform` | Platform operating overview | Real counts for agencies, active memberships, attention, approvals, readiness, platform email, tenant integration health, and recent tenants | Platform admin and superadmin |
| `/platform/agencies` | Search tenant registry and readiness | Paginated real directory; identity/counts/readiness only; no customer records or credential reveal | Platform admin and superadmin |
| `/platform/system` | Review release and aggregate queue health | Deployment readiness plus AI/email/provider/approval counts; no tenant payloads | Platform admin and superadmin |
| `/platform/email` | Configure service-owned `travel@lumierah.in` email | Resend/custom SMTP, encrypted credentials, verify-before-enable, no insecure SMTP option, MFA gate | Platform admin and superadmin with MFA |
| `/platform/audit` | Review immutable platform changes | Searchable, privacy-minimized ledger with safe metadata allow-list | Platform admin and superadmin |
| `/platform/access` | Manage independent platform operators | Grant registered accounts, change role/status, disable self-change, final-superadmin invariant | Superadmin with MFA only; platform admin gets 404 |

## Shared-component audit

| Component/pattern | Verdict | Guardrail |
| --- | --- | --- |
| Agency `ApplicationShell` | Pass | Persistent grouped navigation; platform is a deliberate workspace switch, not a tenant module |
| `PlatformShell` | Pass | Separate brand context, routes, role/MFA badges, tenant-boundary signal, mobile drawer |
| `OperationalPageHeader` | Pass | Compact title, count/state, optional primary action; no marketing hero |
| Buttons and form fields | Pass | Semantic controls, visible focus, disabled/loading truth, bounded feedback |
| Action drawers and modal boundary | Pass | Progressive disclosure; focus stays bounded and returns to its trigger |
| Tables/directories | Pass | Search/filter/pagination; page is viewport-bound and table owns horizontal overflow |
| Saved views | Pass | Scope is validated, tenant-scoped, and persisted for relevant modules |
| Loading/empty/error states | Pass | Loading is temporary; zero data becomes a useful next action; failures offer retry |
| AI recommendation pattern | Pass | Evidence, limitation, recommendation, then review/approval; no hidden external effect |
| Approval pattern | Pass | Exact action/evidence, decision authority, escalation, immutable result |
| Integration editor | Pass | Configure, test, and enable are distinct; stored secrets are never echoed |
| Product help | Pass | Persistent, dismissible field guide instead of repeated page-level tutorials |

## End-to-end flow audit

1. **Lead to operation:** capture lead → qualify and assign → work conversation/tasks → build itinerary → price/review/share quote → customer acceptance → finance-authorized receivable → won-deal trip → operate travellers/bookings/documents → settle/export. Browser-to-database coverage passes.
2. **AIOS work:** source evidence → policy gate → Manual recommendation, Assisted internal preparation, or permitted Autopilot work → exact approval for sensitive/external effect → immutable activity evidence. Pure policy and authenticated UI coverage pass.
3. **Tenant integration:** choose provider → enter/replace credentials → save and verify → enable only if released and verified → route through tenant-scoped adapter → record bounded result. Configuration truth tests pass; external deployment acceptance remains.
4. **Platform operation:** sign in with independent platform role → review aggregate health/agency readiness → configure platform email with MFA → review audit → superadmin manages platform access with MFA. Cross-role browser coverage passes.
5. **Support investigation:** platform signal identifies an affected agency but does not open its records. Customer-data investigation requires a separately granted agency membership. This prevents accidental support impersonation.

## Bad-practice register

Corrected:

- marketing heroes above operational objects
- competing side/top navigation systems
- hash-linked pseudo-pages for Suppliers/Finance and AIOS areas
- bundled platform pages inside the tenant shell
- identical platform-admin and superadmin capability surfaces
- privileged platform writes without MFA
- insecure unencrypted SMTP selection
- raw secret/ciphertext access from browser clients
- final-superadmin lockout risk
- mobile page overflow caused by intrinsic table width
- ambiguous loading-versus-empty states
- repeated governance slogans and provider-infrastructure jargon on daily screens

Still intentionally open:

- keyboard-only and screen-reader walkthroughs with real assistive technology
- 200% zoom and final target-device acceptance across the whole application
- production provider/DNS/webhook/worker acceptance
- large-volume usability/performance testing after realistic pilot data grows beyond the MVP seed
- billing/subscription administration, live payments, WhatsApp execution, and support-access workflows are separate post-MVP product decisions; they must not be implied by the current UI

## Acceptance evidence

- TypeScript: pass
- ESLint: pass with zero warnings
- Behavioral/contract tests: 311/311 pass
- Production build: pass for 39 application pages
- Platform migration: applied to hosted Supabase
- Full Chromium release suite: 58/58 journeys pass (30 authenticated agency, 2 platform-role, and 26 public/security journeys)
- Hosted Supabase access and authorization probes: pass
- Source secret scan: 528 files scanned with zero detected secrets
- Direct visual review: six desktop platform screens plus 390 px agency-registry view inspected; mobile overflow defect corrected
