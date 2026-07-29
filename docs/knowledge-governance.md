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
5. **Retired:** Remove an approved version from retrieval without deleting its audit evidence.

Approved and retired versions are immutable through the application. Correct material by creating a new version, not by silently rewriting what AIOS previously cited.

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

Before a future AI answer composer uses this material, it must:

1. retrieve through the permission-aware function as the requesting user;
2. cite every material factual or policy assertion;
3. preserve stale and restricted states;
4. say that evidence is missing when retrieval has no supported result;
5. route conflicting or high-impact guidance to a human;
6. never transform advisory material into a booking, payment, message, legal, visa, or immigration decision.

## Operational review

- Review the **In review** queue before expanding agent access.
- Treat **Stale** as work requiring source verification and a new version.
- Retire superseded versions after the replacement is approved.
- Use restricted sensitivity for commercial or operational content that ordinary members should not retrieve.
- Confirm the source URL and citation labels are useful to a human reviewer, not only machine-readable.

## Release status

The current foundation supports manual curation, lifecycle review, permission-aware lexical retrieval, freshness disclosure, citations, and audit evidence. File parsing, automated chunking, pgvector semantic retrieval, conflict resolution, and the cited AI answer composer remain Phase 17 work and require their own evaluation and release gates.
