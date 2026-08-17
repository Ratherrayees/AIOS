# AIOS Travel CRM product UX architecture

## Product rule

AIOS must remain an excellent travel CRM when AI is disabled. When AI is enabled, it should reduce work inside the CRM instead of becoming a second application that users must operate.

The interface therefore follows three layers:

1. **Run the business** — Home, Inbox, Tasks, Leads, Contacts, Pipeline, Itineraries, Quotes, Trips, Suppliers, and Finance.
2. **Review AI work** — AI activity, approvals, automations, and knowledge.
3. **Administer the workspace** — Team, lead capture, workflows, integrations, AI settings, security, and billing.

## Global information architecture

The persistent application shell is the only primary navigation on authenticated routes.

- **Today:** Home, Inbox, Tasks
- **Sales:** Leads & pipeline, Contacts, Quotes
- **Travel:** Itineraries, Trips
- **Operations:** Suppliers, Finance
- **Intelligence:** Analytics, Knowledge
- **AIOS:** Activity & approvals, Automations
- **Administration:** Team, Lead capture, Workflows, Security

Context links may appear inside a page, but they must not replace or compete with the global shell.

## Standard operational page

Every primary module should use the same hierarchy:

1. Compact page title, object count or state, and one primary action.
2. Tabs, filters, saved views, or search.
3. The primary business object: table, board, inbox, document, ledger, chart, or record.
4. Secondary tools in a drawer, modal, or progressively disclosed section.

Marketing copy, product philosophy, and repeated safety explanations do not belong above the working surface. Empty states appear only after loading is complete and provide a clear next action.

## AI interaction pattern

AI appears where the work happens:

- A lead shows an evidence-based summary, missing information, and a recommended next step.
- Inbox shows a reviewable draft beside the conversation.
- Trips show detected operational risks beside the affected trip.
- Finance shows proposed matches beside the relevant invoice or booking.

AI recommendations must state their evidence or limitation in compact language. External actions use a consistent `Review and approve` interaction. Provider routing, durable queues, retry behavior, and model diagnostics belong under advanced administration.

## Daily coordination pattern

AIOS is embedded into Home as one understandable operational control: `Run daily AIOS sweep`. The same action remains available in the AI workspace for policy and evidence review. It coordinates only internal work—unassigned opportunity routing, objective lead and Inbox follow-ups, and deterministic trip-risk reconciliation—and reports internal updates, approvals, and safely isolated failures in ordinary CRM language.

This parent workflow never weakens a child permission. If routing is Assist, Inbox triage is disabled, or trip monitoring requires Approval, those child policies still win even when the parent is Auto. External customer, supplier, pricing, booking, document, invoice, payment, and refund effects are not tools available to the coordinator. A parent approval pauses the entire sweep before child work and resumes the same durable run after the human decision.

## Operating modes

- **Manual:** AI recommends; people execute every action.
- **Assisted:** AI prepares work and performs permitted low-risk internal actions.
- **Autopilot:** AI executes permitted workflows and requests approval whenever policy requires it.

Advanced controls expose per-action policies only after an administrator chooses to configure them. Non-bypassable approval rules remain enforced in code and the database regardless of presentation.

## Learnability without page clutter

Operational pages do not repeat tutorials. One persistent field guide explains the record model, the customer journey, the daily operator loop, and Manual / Assisted / Autopilot behavior. Its daily loop links directly to Home attention, Inbox replies, Leads, Itineraries, Quotes, Trips, Finance, and AIOS approvals. This is the Level 1 explanation for a new teammate; detailed policies and system diagnostics remain Level 2 administration.

The application shell must never imply that an unresolved tenant is live. Workspace context has four explicit states: connecting, ready, no assignment, and failed. A failed or timed-out lookup provides an in-place retry and must not remain an indefinite loading label.

## Density and visual system

- One neutral workspace background and one shared component language across modules.
- Purple is the primary brand accent; module accents may clarify status but must not create separate visual environments.
- Serif typography is reserved for occasional welcome or empty-state moments. Operational headings and repeated labels use sans-serif.
- Tables, boards, inbox panes, ledgers, and charts dominate the first viewport.
- Loading skeletons disappear as soon as loading resolves; zero data becomes an actionable empty state.

## Refactor order and acceptance

1. Global shell and navigation
2. Leads and opportunity workspace
3. Inbox
4. Tasks
5. Contacts
6. Pipeline
7. Itineraries and quotes
8. Trips
9. Finance
10. Home
11. AIOS controls
12. Knowledge and analytics
13. Administration
14. Final visual polish

A module is not considered migrated because its hero was shortened. It is accepted only when its main object is visible early, the core journey is wired, empty/loading/error states are distinct, the page works with the persistent shell on desktop and mobile, and browser tests assert operational behavior rather than marketing copy.
