# UI Wiring Audit

Reviewed: 28 July 2026

## Outcome

Every currently implemented workspace surface has been exercised against a disposable local Supabase instance through the real browser UI. The release suite now contains 38 Chromium journeys: 19 public/authentication and security-boundary checks plus 19 authenticated, browser-to-database workflows.

The July clarity pass also verifies the shared customer-journey rail, owner setup checklist, global AIOS field guide, contextual purpose/next-action/AIOS explanations across every protected feature, direct Lead-pipeline routing, and the simplified five-destination mobile command bar.

The audited build passed with:

- 38/38 browser journeys
- 113/113 behavioral tests
- 15/15 zero-provider AI safety evaluations
- zero TypeScript errors
- zero ESLint errors or warnings
- zero browser console errors or warnings across the protected-route sweep
- zero source-secret findings
- zero known npm vulnerabilities
- zero local Supabase schema-lint findings
- all anonymous-access and authenticated authorization probes

## Feature evidence

| Surface | UI wiring exercised | Persistence or security evidence | Result |
| --- | --- | --- | --- |
| Public and authentication routes | Health, sign-in, sign-up, recovery, recovery-session guard, invitation return path, MFA challenge path, anonymous 404 behavior | Private/no-store responses, security headers, protected redirects, guarded worker endpoint | Pass |
| Command center | Tenant switching, route navigation, command search, lead creation, private pipeline views, mobile layout | Only RLS-visible organizations can be selected; created lead and view are persisted | Pass |
| Lead pipeline and detail | Public capture, attribution, response acknowledgement, commercial planning, qualification evidence, governed stage selector and drag/drop, follow-up playbook, direct follow-up, approvals, analytics linkage | Server and database rules block illegal movement; history, tasks, approvals, activity and audit evidence are persisted | Pass |
| Contacts and companies | Company/contact creation, optional company linkage, ownership, communication consent/preferences, internal notes, CSV-style import, search and private saved views | Tenant-scoped rows, ownership, consent evidence, imported records, timeline events and views are persisted | Pass |
| Duplicate review | Same-name/company candidate review, clearly differentiated older/newer records, explicit confirmation and merge | One record remains live, the other is archived, dependent data is re-linked and the merge is audited | Pass |
| Inbox | Conversation creation, linked contact/opportunity, status lifecycle, ownership, priority/deadline, reply-template creation/application/retirement, review draft/revision, internal note and private view | Conversation, SLA, draft, message, template and view state are persisted without sending externally | Pass |
| Tasks | Creation, due date, ownership, open/in-progress/completed/reopened lifecycle, unassignment, filters, private views and deletion | Task state and ownership changes persist within the tenant | Pass |
| Quotes | Draft creation, immutable revision, internal cost/margin signal and quote-sharing approval request | Version history and internal cost persist; sharing remains approval-gated and unsent | Pass |
| Itinerary Studio | Trip drafts, day items, comments, conflict/readiness checks, reusable template creation and application | Trips, items, comments, readiness tasks and copied template items persist; no booking or external share occurs | Pass |
| Trip Operations | Won-deal handoff, operating details, lead/additional travellers, internal booking request/confirmation states, trip-linked task completion, private expiry-aware upload and signed download, governed trip movement | Conversion is idempotent, direct status writes are blocked, lifecycle history and actor/audit evidence persist, and no supplier message, inventory reservation, or payment occurs | Pass |
| Lead Capture settings | Form creation, public preview route, pause and resume | Form configuration and active state persist; public submission uses the governed endpoint | Pass |
| Sales Workflows | Qualification and follow-up configuration visibility plus application from the lead workspace | Evidence and sequence operations use guarded tenant RPCs | Pass |
| Team Access | Role change, teammate suspension/restoration, invitation creation and revocation | Membership state and one-way invitation-token hash persist; final-owner safeguards remain enforced | Pass |
| Account Security | TOTP enrollment, live code verification, verified-factor display and removal | Supabase Auth reports the factor, then confirms it is removed | Pass |
| AIOS Control | Daily budget, provider selection, model kill switch, approved price version, lead and Inbox triage, autonomy modes, workflow disable/enable and non-bypassable external-action guard | Budget, price and autonomy policy rows persist; triage writes only bounded internal work; quote sharing cannot be set to Auto | Pass |
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
