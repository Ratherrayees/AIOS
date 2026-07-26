# Database backup and recovery runbook

This is a release gate, not a claim that a restore drill has already passed.

## Backup policy

- Enable Supabase managed backups appropriate to the production plan.
- Define recovery point and recovery time objectives before pilot data arrives.
- Keep development, staging, and production projects separate.
- Store exported backups encrypted, access-controlled, and outside the application repository.
- Back up Storage objects as well as Postgres; database metadata alone is not the underlying file.

## Pre-release verification

1. Confirm the migration history is current with a dry run against the target database.
2. Run public-schema lint and the anonymous/authenticated authorization probes.
3. Record table counts and critical configuration without exporting private row content into logs.
4. Create or confirm a provider-managed backup.

## Restore drill

1. Restore only into an isolated staging/recovery project.
2. Use new environment credentials; never point the application at production during validation.
3. Apply any migrations newer than the restore point.
4. Run:

   ```text
   npm run security:secrets
   npm run verify:supabase
   npm run verify:authz
   npm run typecheck
   npm test
   ```

5. Verify Auth configuration, private Storage bucket policies, object availability, webhook secrets, and scheduled/background work separately; these may not be fully represented in a database dump.
6. Perform tenant-isolation, invitation, MFA, approval, and signed-document checks with disposable staging users.
7. Delete or lock the recovery project after evidence is retained.

## Production recovery decision

The incident commander chooses point-in-time recovery, forward repair, or failover based on data-loss window, corruption scope, legal obligations, and provider status. Announce read-only or maintenance mode before a destructive recovery. Preserve forensic evidence and obtain explicit approval before replacing production state.

## Evidence

Record the backup timestamp, restore target, migration version, validation results, measured recovery time, observed data-loss window, failures, follow-up owner, and next drill date.
