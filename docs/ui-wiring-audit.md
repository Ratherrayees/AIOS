# UI Wiring Audit

Reviewed: 29 July 2026

## Outcome

Every currently implemented workspace surface has been exercised against a disposable local Supabase instance through the real browser UI. The release suite now contains 44 Chromium journeys: 22 public/authentication and security-boundary checks plus 22 authenticated, browser-to-database workflows.

The July clarity pass also verifies the shared customer-journey rail, owner setup checklist, global AIOS field guide, contextual purpose/next-action/AIOS explanations across every protected feature, direct Lead-pipeline routing, and the simplified five-destination mobile command bar.

The audited build passed with:

- 44/44 browser journeys
- 144/144 behavioral tests
- 21/21 zero-provider AI safety evaluations
- zero TypeScript errors
- zero ESLint errors or warnings
- zero browser console errors or warnings across the protected-route sweep
- zero source-secret findings
- zero known npm vulnerabilities
- zero local Supabase schema-lint findings
- all 59-table/34-RPC anonymous-access probes and 218 authenticated authorization assertions

## Feature evidence

| Surface | UI wiring exercised | Persistence or security evidence | Result |
| --- | --- | --- | --- |
| Public and authentication routes | Health, sign-in, sign-up, recovery, recovery-session guard, invitation return path, MFA challenge path, anonymous 404 behavior | Private/no-store responses, security headers, protected redirects, guarded worker endpoint | Pass |
| Command center | Dynamic signed-in identity/role, tenant switching, route navigation, command search, lead creation, private pipeline views, mobile layout | Only the verified profile and RLS-visible organizations can be presented; created lead and view are persisted | Pass |
| Lead pipeline and detail | Public capture, attribution, response acknowledgement, commercial planning, qualification evidence, governed stage selector and drag/drop, follow-up playbook, direct follow-up, approvals, analytics linkage | Server and database rules block illegal movement; history, tasks, approvals, activity and audit evidence are persisted | Pass |
| Contacts and companies | Company/contact creation, optional company linkage, ownership, communication consent/preferences, internal notes, CSV-style import, search and private saved views | Tenant-scoped rows, ownership, consent evidence, imported records, timeline events and views are persisted | Pass |
| Duplicate review | Same-name/company candidate review, clearly differentiated older/newer records, explicit confirmation and merge | One record remains live, the other is archived, dependent data is re-linked and the merge is audited | Pass |
| Inbox | Conversation creation, linked contact/opportunity, status lifecycle, ownership, priority/deadline, reply-template creation/application/retirement, review draft/revision, internal note and private view | Conversation, SLA, draft, message, template and view state are persisted without sending externally | Pass |
| Tasks | Creation, due date, ownership, open/in-progress/completed/reopened lifecycle, unassignment, filters, private views and deletion | Task state and ownership changes persist within the tenant | Pass |
| Quotes | Draft creation, immutable revision, internal cost/margin signal and quote-sharing approval request | Version history and internal cost persist; sharing remains approval-gated and unsent | Pass |
| Itinerary Studio | Trip drafts, day items, comments, conflict/readiness checks, reusable template creation and application | Trips, items, comments, readiness tasks and copied template items persist; no booking or external share occurs | Pass |
| Trip Operations | Won-deal handoff, operating details, lead/additional travellers, human-reviewed passport/visa checkpoints, internal booking request/confirmation states, trip-linked task completion, private expiry-aware upload and signed download, governed trip movement, and Operations Radar scan/clear behavior | Conversion is idempotent, direct trip/traveler-entry/booking/exception status writes are blocked, lifecycle history and actor/audit evidence persist, twelve objective risk types are deduplicated and routed, and no immigration decision, supplier message, inventory reservation, or money movement occurs | Pass |
| Traveler entry readiness | Per-traveler/destination citizenship and issuer codes, passport expiry/buffer, visa requirement/workflow, action deadline, evidence source, clear/attention presentation, and edit/upsert behavior | The guarded RPC records reviewer/audit evidence, requires a named source for non-unknown visa requirements, stores no passport number, rejects viewers/direct writes/foreign relationships, and feeds passport/visa/itinerary risks into Radar | Pass |
| Durable Operations Radar | Enable/pause, cadence, bounded confirmation/document/payment/task thresholds, same-workspace fallback owner, operator-triggered durable run, recent history, and unavailable-without-secret worker endpoint | Policy/run tables are browser-read-only; service claims are tenant-scoped and `SKIP LOCKED`; one active lease is enforced; abandoned leases and failure retry state are bounded; wrong workers, viewers, foreign owners, duplicate claims, and anonymous calls are denied | Pass |
| Traveler Portal | Traveler-file classification, exact-scope approval request, human approval, expiring publication, safe public journey/payment/document rendering, approved voucher download, and immediate evidence-backed revocation | Only a frozen narrow snapshot and selected normal-sensitivity file mappings are exposed; raw tokens are returned once and stored only as SHA-256 hashes; identity documents, internal notes, supplier terms, margins, payables, and storage paths remain absent | Pass |
| Suppliers & Finance | Supplier profile, named contact, contract terms, receivable creation, settlement evidence, currency-separated balances, due-date Radar signal, and settled-filter workflow | Tenant and role boundaries persist; direct payment/allocation writes are denied; guarded RPCs record actor/audit evidence; the ledger records facts without charging, paying, refunding, or messaging anyone | Pass |
| Lead Capture settings | Form creation, public preview route, pause and resume | Form configuration and active state persist; public submission uses the governed endpoint | Pass |
| Sales Workflows | Qualification and follow-up configuration visibility plus application from the lead workspace | Evidence and sequence operations use guarded tenant RPCs | Pass |
| Team Access | Role change, teammate suspension/restoration, invitation creation and revocation | Membership state and one-way invitation-token hash persist; final-owner safeguards remain enforced | Pass |
| Account Security | TOTP enrollment, live code verification, verified-factor display and removal | Supabase Auth reports the factor, then confirms it is removed | Pass |
| AIOS Control | Daily budget, provider selection, model kill switch, approved price version, lead and Inbox triage, autonomy modes, workflow disable/enable and non-bypassable external-action guard | Budget, price and autonomy policy rows persist; triage writes only bounded internal work; quote sharing cannot be set to Auto | Pass |
| Governed Knowledge | Versioned source draft, source authority/sensitivity/freshness metadata, citation-ready passages, human review, approval, stale-source queue, controlled replacement draft, draft-only passage revision, atomic supersession, approved retrieval, side-by-side factual Conflict Watch with human evidence decisions, and an Answer Desk with claim-level source links, explicit unsupported/stale states, and high-impact human review | Direct writes are denied; drafts, restricted material, conflict evidence, and retired sources are permission-filtered by role; guarded transitions, renewal, scanning, and conflict-review RPCs record reviewer/lineage/audit evidence; the conflict detector flags but never resolves semantics; the answer path sends only permitted fresh evidence, validates model claims against exact retrieved passages, attaches citations server-side, and makes no provider call for unsupported evidence | Pass |
| Analytics | Authenticated loading and lead/source conversion evidence from prior workflow tests | Metrics derive from tenant-authorized deal/history data | Pass |
| Private document vault | UI upload from lead detail and metadata verification | Object bytes and metadata exist in the private tenant path; anonymous/foreign access and browser deletion are denied | Pass |
| Responsive and runtime integrity | All principal protected routes at desktop and 390px mobile widths | No horizontal overflow; route sweep produced no browser errors or warnings | Pass |

## Defects found and corrected

1. Async form handlers read `event.currentTarget` after entering a transition. React had already cleared that event reference, so successful database writes could be followed by a false `Cannot read properties of null (reading 'reset')` UI error. Each handler now captures the form element before asynchronous work.
2. Duplicate contacts with identical names produced indistinguishable “Keep” actions. The review now shows the older/newer contact channels and explicit “Keep older record” and “Keep newer record” controls.
3. Three dashboard briefing rows were coded as buttons without an action. They are now styled informational rows, so the interface no longer advertises inert controls.
4. Inbox and Itinerary creation controls were missing programmatic names. Their selects and inputs now have stable accessible labels.
5. Adding Trip Operations caused the 390px bottom route bar to wrap onto a second row. The clarity pass now keeps five high-frequency destinations in one row and moves full navigation into the grouped feature header; the one-row assertion remains enforced.
6. Feature depth outpaced product explanation: the dashboard, module headers, and settings used different navigation models and assumed prior CRM knowledge. The shell now groups work by intent, explains Contact → Lead → Trip, shows the four-stage customer journey, labels operational boundaries, and exposes a persistent field guide without adding another database dependency.
7. The dashboard identity and owner role were hard-coded to Rayees Amin, so every authenticated teammate would appear to be the owner. The shell now loads the verified signed-in profile plus the active RLS-visible membership role and derives the greeting and initials dynamically.
8. PostgreSQL could not resolve enum values returned by a finance status `CASE` expression during a clean replay. The function now casts every branch explicitly, and both schema lint and authorization tests cover it.
9. Finance evidence originally used membership-dependent audit foreign keys that could prevent tenant cleanup after membership changes. Allocation and contract audit actors now use nullable profile references, tenant-owned evidence cascades with its organization or obligation, and indexed foreign keys preserve query and lifecycle integrity.
10. The first traveler-portal migration linked a tenant/document pair without a matching composite unique key. The clean zero-state replay caught it; documents now expose the required tenant-safe key before the mapping foreign key is created.
11. PostgreSQL emits JSON timestamps with explicit numeric UTC offsets, while the first public snapshot parser accepted only a trailing `Z`. The parser now accepts valid ISO offsets, the unit fixture uses offset timestamps, and the full publish/view/download/revoke browser journey enforces the boundary.
12. The generic anonymous-access verifier assumed every protected table had a single `id` column. The portal document-mapping table correctly uses a composite primary key, so the verifier now selects the table shape generically and covers all 53 tables.
13. The first durable-schedule migration referenced the immutable-tenant trigger helper in the public schema instead of the established private schema. Clean zero-state replay failed immediately; the migration now uses the shared private helper and replays cleanly.
14. The initial schedule component mixed its external fetch and state application in one effect helper. React 19 lint rejected the cascading pattern; fetching is now side-effect-free and state is applied only from the guarded promise continuation.
15. The first entry-readiness placement put passport/visa controls before the traveller roster, and the compact global help trigger could overlap a status pill around the 733px breakpoint. The roster now establishes the people context first, while the readiness cards reserve space for the persistent help control at that intermediate width.
16. The first knowledge-source reviewer foreign key used `ON DELETE SET NULL`, which conflicted with the requirement that approved evidence preserve its reviewer and could block disposable tenant cleanup. Creator and reviewer relationships now use deferred same-tenant constraints, so an organization cascades atomically while standalone membership removal cannot erase historical review accountability.
17. The initial knowledge lifecycle allowed a curator to add passages while a source was already in review. The UI and guarded RPCs now freeze both metadata and passages in review; corrections require an explicit return to Draft before approval can resume.
18. The first Knowledge retrieval panel reused a legacy global `.knowledge-search` dashboard selector. At a mid-width viewport that inherited a fixed-height flex layout and let approved citation cards overlap the inventory below. The governed workspace now uses an isolated selector namespace, and browser layout inspection covers the exact failing width plus the 390px overflow boundary.
19. The initial Answer Desk browser assertion targeted a generic search button after the evidence preview label became more explicit. The journey now selects the actual “Preview evidence” control and separately proves that an unsupported question creates an auditable deterministic refusal with zero model job or token usage.

## Deferred external acceptance

The following items are not local UI wiring failures; they require external provider or deployment setup and remain explicitly deferred:

- verification of `travel.stateai.in`
- Supabase Auth SMTP and deployed callback allow-list
- public deployment and registration of the Resend webhook
- approved outbound email/scheduled-delivery worker
- deployed AIOS worker secret and schedule
- credential rotation before deployment
- WebKit, Firefox and hands-on assistive-technology acceptance
- production-like backup/restore and rollback drills
