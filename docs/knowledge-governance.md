# Governed Knowledge Operations

## Purpose

The Knowledge workspace is AIOS's reviewed evidence plane. It stores tenant-owned source metadata and citation-ready passages so people and agents can retrieve material without treating drafts, restricted documents, or stale guidance as current authority.

It is not a web crawler, a legal or immigration decision engine, or an external publishing system.

## Roles and visibility

- Owners, administrators, trip designers, and operations users can curate sources and passages.
- Only owners, administrators, and operations users can approve a source for retrieval.
- Ordinary active members can read and search approved sources with `normal` sensitivity.
- Curators may also inspect drafts, in-review sources, retired versions, and `restricted` sources.
- Anonymous users, foreign tenants, suspended members, and sessions that do not satisfy the workspace MFA requirement receive no access.

## Lifecycle

1. **Draft:** Record the source title, type, authority, sensitivity, version, optional HTTPS link, validity date, review deadline, and summary.
2. **Passages:** Add ordered, bounded evidence passages. Every passage needs its own human-readable citation label.
3. **In review:** Submit the complete source for a deliberate human review. Its metadata and passages are frozen and it is still excluded from approved retrieval. Return it to Draft before making a correction.
4. **Approved:** An authorized reviewer approves a source only when it has at least one cited passage and a current review deadline.
5. **Renewal:** Prepare a successor draft from an approved source. The system clones its passages into an editable draft, records the predecessor relationship, and keeps the approved version retrievable while people revise the replacement.
6. **Replacement approval:** The successor follows the same in-review and approval gates. Its approval atomically retires the superseded version, so retrieval never sees an unsafe gap or two active versions in the same lineage.
7. **Retired:** Remove an approved version from retrieval without deleting its audit evidence.

Approved, in-review, and retired versions are immutable through the application. Passages can be revised or removed only while their source is a draft. Correct approved material through the controlled replacement workflow, not by silently rewriting what AIOS previously cited.

## Retrieval contract

`search_approved_knowledge` always applies the signed-in user's tenant membership and sensitivity permissions. Each result contains:

- the source and passage identifiers;
- source title, type, authority, sensitivity, and version;
- the HTTPS source link when one was recorded;
- passage heading, bounded excerpt, and citation label;
- review deadline and an explicit `is_stale` flag;
- lexical relevance used only for ordering.

Drafts and retired sources are never returned. Restricted sources are returned only to curator roles. Stale sources may be returned so their historical evidence is visible, but the UI marks them as expired and AIOS must not present them as current.

## AIOS use

The Answer Desk is the only current AIOS path that turns this material into a
natural-language answer. Its contract is:

1. retrieve through the permission-aware function as the requesting user;
2. send only approved, fresh, tenant-permitted passages to the configured model;
3. treat both the question and retrieved passages as untrusted input, reject
   prompt-like instructions, and redact direct identifiers before model use;
4. require structured claims that name the exact retrieved passage IDs they
   rely on;
5. attach the authoritative citation label, source/version, link, and freshness
   state on the server rather than trusting model-written citation text;
6. reject unknown or stale passage IDs, materially unsupported claims, and
   invented dates or numbers;
7. return an explicit unsupported or out-of-date state without a provider call
   when current evidence is absent;
8. route visa, passport, immigration, legal, medical, refund, payment, price,
   and booking questions to human review even when the cited draft answer is
   grounded; and
9. never transform an answer into a booking, payment, message, legal, visa, or
   immigration decision.

Provider execution uses the workspace's governed model router, daily budget,
kill switch, approved-model allow-list, durable job lease, retry/dead-letter
behavior, token/cost telemetry, and immutable run record. The durable job stores
only an internal run reference and prompt version; it does not store the raw
question in its payload.

## Operational review

- Review the **In review** queue before expanding agent access.
- Treat **Stale** as work requiring source verification and a controlled replacement version.
- Review every cloned passage in the replacement draft. Its approval retires the superseded version atomically.
- Use restricted sensitivity for commercial or operational content that ordinary members should not retrieve.
- Confirm the source URL and citation labels are useful to a human reviewer, not only machine-readable.
- In the Answer Desk, inspect each claim and its cited passages before acting.
  “Needs human review” is an escalation, not permission to execute an external
  effect.

## Release status

The current foundation supports manual curation, lifecycle review, immutable
source renewal, draft passage revision/removal, permission-aware lexical
retrieval, freshness queues, claim-level cited AI answers, deterministic
unsupported/stale refusal, high-impact human escalation, durable model
execution, and audit evidence. The grounding rules are covered by behavioral
and zero-provider adversarial evaluations; a fictional, non-CRM GLM-4.7-Flash
smoke test also confirmed the provider adapter accepts the structured contract.
Private file parsing, automated chunking, pgvector semantic retrieval where
lexical search is insufficient, source-conflict resolution, bulk freshness
policy, staging deployment, and product-owner acceptance remain Phase 17 work.
