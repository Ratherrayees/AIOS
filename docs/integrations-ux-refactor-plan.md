# Integrations UI/UX Refactor Plan

**Prepared:** 11 August 2026  
**Scope:** `/settings/integrations`, its shared settings navigation, and directly related administration-shell behavior  
**Objective:** Replace the expanded credential-form wall with a compact connection-management workspace without weakening or changing the existing tenant, encryption, authorization, audit, provider-test, or runtime contracts.

## Implementation checkpoint - 11 August 2026

Phases 1-7 are implemented. The page now opens as a compact, categorized connection overview; one provider is edited in an accessible drawer; `Save and verify` preserves the two existing audited server transitions; runtime-ready providers can be activated only after verification; and Stripe, Razorpay, and WhatsApp are truthfully presented as configuration-only until their execution adapters ship. Settings has one persistent secondary navigation, Today remains pinned in the application sidebar, and form-heavy integration routes no longer have controls covered by floating help.

The compatibility boundary remains intact: no database migration was introduced, existing Server Action names and provider payload fields are unchanged, blank secret fields still preserve encrypted values, and tenant authorization/runtime resolution continue through their original server-only contracts. A new server assertion also prevents crafted activation requests for configuration-only providers.

Automated verification currently passes: 298 behavioral tests, 27 AI safety evaluations, strict TypeScript, ESLint, the scoped integration CSS guard, source-secret scanning, production build, 82-table/68-RPC hosted access probes, and 459 authenticated authorization assertions. All 168 Playwright definitions compile for Chromium, Firefox, and WebKit, including the new overview/drawer/truthfulness assertions.

A signed-in in-app browser inspection now also passes at the 1280px desktop and 390px mobile viewports. It verified zero horizontal page or drawer overflow, all category filters, setup-only Stripe truthfulness, every Settings destination, drawer scroll locking, Escape focus restoration, Tab focus containment, and zero browser console warnings/errors. That inspection exposed and fixed two development-only visual blockers: `127.0.0.1` is now an explicitly allowed Next.js development origin, and the horizontally scrollable Settings tabs no longer render native Windows scrollbar chrome.

Phase 8 is implemented and has direct desktop/mobile browser evidence, but still needs the remaining target widths, 200% zoom, and hands-on assistive-technology review. Phase 9 is therefore partially complete: automated engineering gates and one signed-in browser surface pass, while real-provider staging tests, full Chromium/Firefox/WebKit replay, approved screenshots, and product-owner visual acceptance remain open. The app is intentionally not represented as production-ready until those acceptance gates pass.

## 1. Product outcome

An agency owner or administrator should be able to answer these questions immediately:

1. Which services are configured?
2. Which connections are healthy?
3. Which connections are actually active?
4. Which capability uses each provider?
5. What needs attention?
6. What can be configured now but is not yet executable in the product?

The target interaction is:

`Overview → Configure → Save and verify → Activate → Monitor or repair`

The page must expose status and decisions first. Credential fields appear only when the administrator chooses to connect, edit, replace, or repair a provider.

## 2. Non-negotiable compatibility boundaries

The refactor must preserve all of the following:

- The route remains `/settings/integrations`.
- Only active `owner` and `admin` memberships may list, save, test, enable, disable, or remove integrations.
- `organization_integrations` remains inaccessible to anonymous and authenticated browser Data API clients.
- Credentials remain write-only in the browser and AES-256-GCM encrypted before database persistence.
- Existing secrets remain unchanged when replacement fields are left blank.
- The browser receives only public configuration, bounded credential hints, state, timestamps, and sanitized test messages.
- New or materially changed credentials remain disabled and unverified.
- Activation remains impossible until a successful connection test.
- A failed retest disables an active provider without deleting its encrypted configuration.
- Connection tests remain non-destructive: no message, payment, customer contact, or model inference is created.
- Every create, update, test, enable, disable, and removal remains audited without plaintext secrets.
- Enabled tenant OpenAI/Claude routing and Resend/SMTP delivery continue to use the existing trusted server-only resolver.
- Deployment-level provider fallback continues to behave exactly as it does now.
- Current Supabase RLS, grants, table constraints, and authorization assertions remain intact.

The first UI release should require no database migration. Any later routing constraint must be introduced as a separate, reviewed migration after checking existing tenant data.

## 3. Current contract inventory

| Contract | Current implementation | Refactor rule |
|---|---|---|
| List summaries | `listOrganizationIntegrations` | Reuse unchanged as the overview source |
| Save configuration | `saveOrganizationIntegration` | Reuse; allow the new UI to sequence it before testing |
| Test connection | `testOrganizationIntegration` | Reuse; surface its sanitized result in the drawer and summary |
| Remove integration | `removeOrganizationIntegration` | Reuse with a stronger confirmation pattern |
| Activation policy | `resolveIntegrationSaveActivation` | Treat as the canonical state-transition rule |
| Retest failure policy | `enabledAfterConnectionTest` | Preserve automatic shutdown after a failed retest |
| Runtime credentials | `loadEnabledTenantIntegration` | Do not change during the presentation refactor |
| Provider validation | `lib/integrations/schemas.ts` | Keep provider-specific Zod contracts authoritative |
| Encrypted storage | `lib/integrations/vault.ts` | Do not move encryption into the browser |
| Tenant isolation | service-only table plus Server Action role checks | Preserve and rerun all access probes |

## 4. Truthful provider-availability model

Connection readiness and product execution readiness are separate facts. Add non-secret presentation metadata to the provider catalog rather than encoding these rules in page copy.

| Provider | Connection setup | Runtime availability today | Activation presentation |
|---|---:|---|---|
| Resend | Available | Tenant transactional email adapter available | Can become active after verification |
| Custom SMTP | Available | Tenant transactional email adapter available | Can become active after verification |
| OpenAI | Available | Tenant AIOS routing available | Can become active after verification |
| Claude | Available | Tenant AIOS routing available | Can become active after verification |
| Stripe | Available | Live payment execution/webhooks not released | Configuration and verification only |
| Razorpay | Available | Live payment execution/webhooks not released | Configuration and verification only |
| WhatsApp Cloud | Available | Inbound/outbound execution not released | Configuration and verification only |

For setup-only providers, the page must not imply that checking a box enables live payments or messages. It should say that credentials can be stored and tested now while live execution remains unavailable. Server-side activation should also fail closed for setup-only providers so a crafted request cannot create a misleading active state.

## 5. Canonical UI state model

No new database state is required for the first release. Derive the visible state from the existing record:

| UI state | Existing record mapping | Primary action |
|---|---|---|
| Setup required | No provider row | Connect |
| Not verified | Row exists and `connection_status = not_tested` | Verify connection |
| Connected | `connected` and `is_enabled = false` | Activate, when runtime-ready |
| Active | `connected` and `is_enabled = true` | Manage |
| Needs attention | `failed` | Repair connection |

Do not simultaneously present category counts, global counts, provider badges, and checkbox state as competing status systems. Use the canonical state label on the provider row and one aggregate summary in the page header.

## 6. Target information architecture

### Page header

- Breadcrumb: `Settings / Integrations`
- Title: `Integrations`
- One-line description: `Connect the services this agency uses.`
- Aggregate status: `2 active · 1 needs attention · 4 not connected`
- Optional primary action only when a problem needs attention: `Review issues`

### Sticky category navigation

- All
- Communication
- Payments
- AI providers

The category navigation stays visible after the title scrolls away and supports direct keyboard navigation.

### Provider rows

Each provider is initially one compact row or card containing:

- recognizable provider icon
- provider name
- one-sentence capability description
- canonical status
- role in the category, when applicable: primary, fallback, or alternative
- last successful or failed test time
- one context-sensitive action: Connect, Verify, Activate, Manage, or Repair

No credential input is rendered in the overview.

### Configuration drawer

Open one right-side drawer for one provider. Use a maximum content width around 520–600 px and a single-column reading flow, with two-column fields only for tightly related short values such as SMTP port/security.

Drawer sections:

1. **Account and routing** — public provider metadata.
2. **Credentials** — write-only secrets with masked saved suffix and explicit Replace control.
3. **Connection verification** — latest result, timestamp, and retry action.
4. **Usage** — activation only after verification and only for runtime-ready providers.
5. **Advanced webhook setup** — collapsed until needed; copyable callback information when the corresponding public endpoint exists.
6. **Danger zone** — remove connection with provider-name confirmation.

The drawer must warn before closing when public fields or replacement credentials are dirty.

## 7. Interaction rules

### First-time connection

1. Administrator selects Connect.
2. Drawer asks only for required connection fields; optional webhook material is under Advanced.
3. Primary action is `Save and verify`.
4. Client calls the existing save action and waits for success.
5. Client then calls the existing side-effect-free test action.
6. If verification succeeds, show Connected and offer Activate when supported.
7. If verification fails, keep the saved configuration disabled and show Repair guidance.

The UI may combine save and test into one intent, but the server retains two explicit audited transitions.

### Editing an inactive connection

- Public values load from the summary.
- Secret fields remain blank and display the masked saved hint separately.
- Blank secret fields preserve existing encrypted values.
- Any material change resets verification and keeps the provider inactive.

### Editing an active connection

- Warn that changing credentials temporarily deactivates the provider until reverified.
- Require explicit confirmation before submitting the material change.
- On success, run Save and verify again.
- Never silently keep an active provider on unverified replacement credentials.

### Activating and disabling

- Activation appears only when state is Connected and the provider is runtime-ready.
- Disable is immediate but confirmed when it removes the agency's only active provider for a currently used capability.
- Provider routing choices must not be embedded in a generic checkbox.
- AI primary/fallback routing remains linked to AIOS configuration.
- Email-primary behavior should be designed explicitly before enforcing exclusivity.

### Removal

- Removal is separate from disabling.
- Confirmation states that encrypted credentials and configuration will be deleted.
- Require the provider name for active or failed production connections.
- Refresh the server-derived summary after deletion rather than relying only on optimistic state.

## 8. Visual-system corrections

Do not bulk-replace typography across the entire CRM in one change. The repository currently contains invalid shorthand patterns such as `font: 9px inherit`; browsers can discard them and inherit unintended sizes.

Safe sequence:

1. Add semantic typography and control tokens.
2. Apply them to the new Integrations components only.
3. Add CSS validation so invalid font declarations fail CI.
4. Migrate shared buttons and form fields after visual comparison on every consuming module.
5. Remove old invalid declarations only after their consumers have moved to valid tokens.

Initial Integrations targets:

- page title: 28–32 px
- section title: 16–18 px
- provider name: 14–15 px
- input and selected value: 14 px
- field label: 13 px
- supporting text: at least 12 px
- badge: at least 11 px
- controls: at least 40 px high on desktop and 44 px on touch layouts
- visible keyboard focus with at least 3:1 contrast against adjacent colors
- no essential status communicated by color alone

## 9. Application-shell improvements

The integrations redesign should not independently invent another shell.

- Preserve the existing global header and sidebar.
- Replace nested sidebar scrolling with one predictable navigation scroll region.
- Keep daily-work entry points discoverable while Administration is active.
- Evaluate collapsible navigation groups, with Today pinned and the current group expanded.
- Introduce a real Settings secondary navigation: Team, Lead Capture, Workflows, Integrations, Security.
- Remove the tiny Related link treatment once the settings navigation is in place.
- Move `How AIOS works` into the header or reduce it to a non-overlapping icon on form-heavy administration routes.
- Preserve keyboard order and mobile-menu behavior.

Shell changes must be delivered separately from the provider-form rewrite so regressions can be isolated.

## 10. Component architecture

Suggested boundaries:

- `IntegrationOverview` — aggregate status, filters, and categories.
- `IntegrationProviderRow` — compact provider summary and contextual action.
- `IntegrationStatusBadge` — one canonical state vocabulary.
- `IntegrationDrawer` — focus-managed editing surface and dirty-close protection.
- `IntegrationCredentialField` — saved hint, replace intent, and write-only input.
- `IntegrationConnectionResult` — success/failure message and timestamp.
- `IntegrationAvailabilityNotice` — truthful setup-only versus runtime-ready messaging.
- `ProviderFields` — provider-specific validated fields, retained from the current implementation and moved without changing names or payload shapes.
- `useIntegrationMutation` — one pending provider at a time; save/test orchestration and server refresh.
- `deriveIntegrationUiState` — pure mapping from `IntegrationSummary` to canonical UI state.

Keep provider field names and action payload shapes stable in the first refactor. Do not duplicate provider validation rules in React; client hints complement, but never replace, the Zod/server contracts.

## 11. Phased delivery plan

### Phase 0 — Baseline and recovery checkpoint

**Work**

- Record the current 294-test, 27-evaluation, 82-table, and 459-authorization baselines.
- Capture desktop screenshots of every current provider and saved/tested/failed states where safe fixtures exist.
- Preserve a reviewed Git checkpoint before UI replacement.
- Document current action payloads and returned summaries.

**Exit gate**

- Clean typecheck, lint, secret scan, production build, provider state tests, hosted access probe, and authorization suite.

### Phase 1 — Truth metadata and derived UI state

**Work**

- Extend the public provider catalog with icon, capability, setup availability, runtime availability, and optional configuration guidance.
- Add `deriveIntegrationUiState` as a pure function.
- Add server enforcement preventing setup-only providers from being marked active.
- Add unit tests for all record/state combinations and provider availability rules.

**Exit gate**

- Existing runtime-ready providers behave unchanged.
- Crafted activation attempts for setup-only providers fail closed.

### Phase 2 — Scoped visual foundation

**Work**

- Introduce valid Integrations typography, spacing, focus, badge, and control tokens.
- Add CSS validation to CI.
- Fix the Integrations page without globally changing every historical consumer.
- Establish desktop, tablet, and mobile layout constraints.

**Exit gate**

- No text below the agreed minimums.
- No invalid CSS declarations in the new component surface.
- Keyboard focus is visible throughout the current page.

### Phase 3 — Compact overview

**Work**

- Replace expanded forms with provider rows.
- Add aggregate status and sticky category filters.
- Use one canonical status per provider.
- Preserve current list loading, retry, empty, and vault-warning behavior.

**Exit gate**

- Every provider and current state is visible without opening a form.
- The initial desktop viewport shows the page header and at least the first two categories.
- No mutation behavior changes yet.

### Phase 4 — Accessible configuration drawer

**Work**

- Move existing provider fields into the drawer without renaming form fields.
- Add saved-secret hint and Replace interaction.
- Implement focus trapping, Escape/close behavior, focus restoration, scroll locking, and dirty-form confirmation.
- Put optional webhook fields under Advanced.

**Exit gate**

- All seven providers produce the same action payloads as the current forms.
- Keyboard-only completion works.
- Screen reader names, descriptions, errors, and state announcements are present.

### Phase 5 — Save-and-verify orchestration

**Work**

- Implement one user intent that calls save, then test.
- Prevent double submission and provider switching while a mutation is pending.
- Distinguish save failure from verification failure.
- Refresh the authoritative summary after each transition.
- Preserve the server's disabled-until-tested rule.

**Exit gate**

- New, changed, connected, failed, and reverified workflows pass deterministic tests.
- A successful save followed by failed verification is shown as saved but inactive, not as total data loss.

### Phase 6 — Activation and provider-specific behavior

**Work**

- Present Activate only for verified runtime-ready providers.
- Mark Stripe, Razorpay, and WhatsApp as configuration-only until their execution layers ship.
- Link AI providers to AIOS routing rather than treating activation as model priority.
- Design email primary-provider behavior and audit existing data before adding exclusivity.
- Add warnings for changes/removal that affect an active capability.

**Exit gate**

- UI capability claims match actual runtime behavior.
- No payment or WhatsApp screen implies that live execution is available.

### Phase 7 — Settings and sidebar navigation

**Work**

- Add persistent Settings secondary navigation.
- Remove nested sidebar scrolling and verify current-group visibility.
- Keep Today and primary business work discoverable.
- Reposition contextual help so it never covers controls.

**Exit gate**

- Active route remains obvious.
- All CRM groups are keyboard reachable at 768 px viewport height.
- Help controls do not overlap actionable content.

### Phase 8 — Responsive, accessibility, and content pass

**Work**

- Test 390, 430, 768, 1024, 1440, and 1920 px viewport widths.
- Verify browser zoom at 200% and text-only zoom where supported.
- Review contrast, error placement, target sizes, status announcements, and reduced motion.
- Replace implementation-heavy copy with capability and consequence language.
- Confirm long provider errors wrap without exposing raw responses.

**Exit gate**

- No horizontal overflow.
- No clipped or overlapping actions.
- Complete keyboard and screen-reader smoke paths.

### Phase 9 — Verification and controlled replacement

**Work**

- Run the complete test and security matrix.
- Add authenticated UI journeys for owner, admin, operations, and viewer access.
- Test each canonical provider state, including dirty close, replacement credentials, failed verification, failed retest, disable, and removal.
- Capture approved desktop/mobile screenshots.
- Retain the old editor component until all provider contracts pass; then remove it in a separate cleanup commit.

**Exit gate**

- Product-owner visual acceptance.
- No decrease from the existing authorization/security baselines.
- Production build and strict CSP pass.
- Rollback procedure proven from the pre-refactor checkpoint.

## 12. Required verification matrix

### Unit and contract tests

- provider catalog completeness
- public versus secret field separation
- canonical UI state derivation
- new/change/save/test/enable state transitions
- setup-only activation denial
- failed retest deactivation
- blank secret preservation
- credential hint bounds
- sanitized provider errors
- custom SMTP private-network rejection

### Server and database tests

- owner/admin success
- operations/viewer denial
- foreign-tenant denial
- browser ciphertext read/write denial
- audit event creation without secrets
- runtime-ready provider lookup unchanged
- no new anonymous or authenticated grants

### UI journeys

- first-time provider connection
- saved but not verified
- successful verification
- activation and disable
- failed connection repair
- active credential replacement
- remove inactive and active provider
- setup-only provider notice
- vault-key-missing state
- refresh and workspace switching
- multiple providers in one category
- keyboard-only drawer workflow
- mobile drawer and category navigation
- zero console errors and strict CSP

### Real-provider staging acceptance

- Resend verified-domain account
- public SMTP relay using TLS and STARTTLS cases
- OpenAI organization/project account
- Anthropic account
- Stripe and Razorpay test accounts, configuration verification only
- WhatsApp test business number, configuration verification only

Production credentials must never be used in automated browser fixtures.

## 13. Rollout and rollback

- Deliver one phase per reviewed checkpoint; do not combine shell, typography, drawer, and server-policy changes in one commit.
- Keep the current editor component until the new drawer passes all seven provider contracts.
- In pre-production, rollback is the reviewed checkpoint plus unchanged database schema.
- If staging exists before release, use a short-lived server-controlled UI flag and remove it after acceptance.
- Do not delete or migrate tenant credentials during the UI rollout.
- On rollback, existing records remain valid because the database/action/runtime contracts were preserved.
- Any future email-primary uniqueness migration requires a preflight duplicate query, deterministic reconciliation, tenant notification where relevant, and a separate restore plan.

## 14. Explicitly out of scope

This refactor does not deliver:

- live Stripe or Razorpay collection
- payment refunds, chargebacks, or reconciliation webhooks
- WhatsApp inbound/outbound execution
- Meta template approval or customer-consent workflows
- new AI providers
- automatic production credential rotation
- secret reveal or browser-side decryption
- a redesign of every CRM module

Those capabilities may use the resulting integration-management pattern later, but they must not be smuggled into this presentation refactor.

## 15. Definition of done

The Integrations experience is complete when:

- an owner can understand the entire integration state without scrolling through credential forms;
- one provider can be configured, verified, activated, repaired, disabled, and removed without ambiguity;
- the page accurately distinguishes connected, active, and product-ready capabilities;
- secrets remain write-only, encrypted, tenant-isolated, and absent from client/audit output;
- no current runtime provider behavior regresses;
- desktop, mobile, keyboard, screen-reader, failure, and strict-CSP paths pass;
- the product owner approves the rendered states;
- the old expanded-form editor can be removed without losing any provider field or workflow.
