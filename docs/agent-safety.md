# AIOS agent safety contract

## What an agent may do autonomously

- Create internal task drafts
- Create one deduplicated internal task for an objectively overdue Inbox
  response deadline when the `inbox.sla.triage` policy permits Auto
- Create internal notes and summaries
- Prepare structured CRM field drafts for human review
- Prepare tenant-scoped message drafts for human review, without delivery
- Search only tenant-permitted, cited sources

## What requires human approval

- Send an email, WhatsApp, or any customer/supplier message
- Share a quote or document externally
- Change pricing, discounts, or commercial terms
- Confirm, amend, or cancel a booking
- Process a payment or refund
- Share sensitive traveller documents

## What is blocked by default

Every tool/action not explicitly added to the reviewed catalog in `lib/ai/autonomy.ts` is blocked. The same external-effect boundary is enforced by database constraints so direct Data API access cannot persist an unsafe Auto policy. Agent output is treated as untrusted until validated with Zod and checked against authorization, tenant scope, citations, and approval policy.

Inbox SLA triage is deliberately narrow: it scans at most 25 overdue,
non-archived conversations, creates no more than one open internal task per
conversation, preserves same-tenant links, and cannot call an email or
messaging tool. Its deterministic ladder is L1 when overdue, L2 after four
hours, and L3 after 24 hours; urgent work advances one tier. L2/L3 may reassign
the internal task to an active owner, admin, or operations member. Escalation
state must include its evidence time, never exceeds L3, and is reset when a
human changes the SLA or closes the conversation. Observe and Assist modes do
not write; Approval mode creates a durable human decision and resumes the same
recorded run only after approval.

Message templates and drafts are internal planning records. A planned time and
`ready_for_review` status express workflow intent only: neither can enqueue or
send a message. External delivery requires a separate catalogued tool, a
non-bypassable human approval, idempotency, and verified-provider handling.

The Sales Copilot is a draft-preparation workflow, not a messaging agent. It
re-fetches at most the latest 12 same-tenant conversation messages, caps each
message at 2,500 characters and the transcript at 12,000 characters, blocks
missing or instruction-like evidence, and redacts common direct identifiers
before provider transit. Recipient addresses are absent from the model
contract, durable job payload, and generated draft. Structured output may
contain only an evidence summary, enumerated proposed next steps, missing
information, confidence, and one reply subject/body. AIOS stores at most one
`ready_for_review` draft per run; a database trigger validates the same-tenant
conversation-agent provenance and prevents it from being replaced. Browser
clients may revise ordinary draft copy under existing Inbox permissions but
cannot forge AI provenance. No step in this workflow sends, schedules, or
delivers a message.

Provider-backed runs must pass the current workspace model policy immediately
before execution. The selected provider must be in the workspace allow-list,
model execution must be enabled, and the UTC daily ceiling must not be
exceeded. An approved run rechecks these conditions when it resumes; approval
does not freeze or bypass later safety-policy changes.

One optional fallback provider may be configured per workspace. It must differ
from the primary provider and remain inside the same explicit allow-list. AIOS
uses it for at most one second attempt, and only after a network/timeout,
408/409/425/429, or selected 5xx provider failure. Authentication,
configuration, policy, approval, safety, budget, and invalid structured-output
failures never trigger fallback. An unconfigured fallback is ignored rather
than weakening the fail-closed primary-provider boundary.

Provider execution is represented by a server-only, tenant-linked AI job before
the model call begins. The job payload may contain only record IDs, workflow,
prompt version, primary provider, and optional fallback selection—never raw
customer text. Claims are
atomic and leased, settlement requires the same worker identity, idempotency is
enforced per run, and retry delays are bounded. Authenticated browser clients
may inspect queue status through RLS but cannot enqueue, claim, update, cancel,
or settle jobs. Inline execution uses this boundary today; an automatic
retry/replay worker is not considered active until its deployment runtime and
operational controls are separately verified.

The retry runner re-fetches current tenant records and re-applies input safety,
redaction, budget, kill-switch, provider allow-list, configured-provider, and
prompt-version checks before every model call. Stale, malformed, missing-record,
or newly unsafe jobs are dead-lettered through a service-only database
operation. A bounded internal endpoint uses a constant-time server bearer
credential; without that credential it returns unavailable and performs no
work. The owner/admin manual runner is always restricted to the caller's
authorized organization.

Dead-letter replay is never automatic. The browser can only request it through
an owner/admin-authorized server action, which verifies the tenant and current
dead-letter state before a service-only RPC resets the job. The decision is
audited, and requeueing does not execute the model; processing remains a
separate action.

Model cost is never inferred from a vendor name. An owner/admin must add an
exact provider/model price version, currency, and per-million input/output
rates. Approved versions cannot be rewritten, and a run links its estimate to
the same tenant's exact price row. Missing token telemetry or a missing
effective price leaves cost unset rather than guessed.

Free-text model context is treated as untrusted and privacy-sensitive. Before
provider transit, AIOS removes disallowed control characters and redacts common
email addresses, contextual phone/WhatsApp numbers, and passport references.
Audit records keep category counts only, never the original identifier.

## Required audit fields

Every AI run must retain the organization, initiating user, agent version, prompt/version reference, source citations, primary and actual provider, attempted-provider route, fallback-used state, tool-call decisions, approval reference, status, duration, and token/cost metadata. Do not store secrets in these records.
