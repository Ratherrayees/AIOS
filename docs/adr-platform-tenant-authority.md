# ADR: platform authority is not tenant authority

Status: accepted  
Date: 17 August 2026

## Decision

AIOS has two independent authorization planes:

1. **Agency authority** comes only from an active `memberships` record for one organization and remains subject to that tenant's row-level security policies.
2. **Platform authority** comes only from an active `platform_admins` record and a server-side capability map. It permits platform metadata, aggregate health, and explicitly bounded platform operations. It never implies agency membership or a tenant-record bypass.

An identity may hold either authority or both. A dual-authority identity (including Rayees's owner account) receives each role through its own explicit record; neither role ever implies the other. The identity chooses an operating context, and no client-supplied organization ID, URL, or stored preference creates authority.

## Data classifications

| Class | Examples | Platform handling |
| --- | --- | --- |
| Registry metadata | Agency ID, name, slug, lifecycle, owner identity reference | Read through bounded service projections after a platform capability check |
| Aggregate operations | Counts, queue state, integration readiness, delivery failure counts | Read as aggregates; no customer payloads or provider secrets |
| Credential data | Platform sender credentials, tenant provider credentials | Separate encrypted vault records; never return plaintext to the browser |
| Authority data | Platform roles, tenant memberships, MFA state, identity security state | Dedicated capability, MFA, confirmation, version check, and immutable audit for mutations |
| Tenant customer data | Leads, contacts, conversations, quotes, trips, documents, finance, prompts | No platform access without a separate active agency membership or a future time-bound approved support grant |

## Enforcement

- Page navigation is informational; every server action enforces an explicit capability.
- Privileged mutations require AAL2 MFA, validated bounded input, exact confirmation where destructive, and immutable evidence.
- Sensitive service RPCs revoke `anon` and `authenticated`; the application authorizes the actor before using the service client, while high-risk RPCs also verify the actor's canonical platform role.
- Agency lifecycle state participates in workspace resolution so restricted or suspended tenants fail closed.
- Identity suspension and session revocation are independent of tenant memberships and platform-role records.
- Unreleased modules have typed, server-only, disabled-by-default release gates.
- Any future support access must be purpose-bound, scoped, time-limited, visible, revocable, and audited. Superadmin alone is insufficient.

## Platform operator invitations

- A superadmin at AAL2 may invite either a platform admin or another superadmin through a dedicated platform-only invitation record. Creating, rotating, or revoking the invitation requires a bounded reason, exact email confirmation, and version check where a record already exists.
- Only a SHA-256 token digest is stored. Public snapshot and acceptance RPCs receive the raw 43-character bearer and hash it inside PostgreSQL, so the stored digest is never accepted as a bearer credential.
- The email link performs a private 303 exchange into a 30-minute, path-scoped, HttpOnly, SameSite=Lax cookie and immediately redirects to tokenless `/auth/platform-invite`. Authentication and MFA return paths never carry the bearer.
- An invitee may create an account through the existing Supabase six-digit signup OTP. Acceptance then requires that same verified email, a currently verified TOTP factor, an AAL2 session issued strictly after the account's session-validity cutoff, and an inviting superadmin who remains authorized.
- Acceptance consumes the invitation, creates the `platform_admins` authority row, and writes platform audit evidence in one transaction. Immutable actor snapshots preserve attribution even if an identity is later removed. It inserts no organization or membership row.
- A registered account may still receive direct platform access through the separate reviewed grant flow. An existing authority record cannot be reactivated through a new invitation.

## Consequences

Platform operators receive a real SaaS control plane rather than a disguised customer workspace. Agencies remain isolated by default. Operational tooling uses deliberately small projections and may require extra queries, but the resulting boundary is reviewable and cannot be bypassed merely by hiding or revealing a route.
