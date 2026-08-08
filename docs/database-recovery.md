# Database backup and recovery runbook

The automated local database recovery gate passed on 1 August 2026. A hosted staging restore, Storage-object recovery, and provider point-in-time recovery exercise remain release gates.

## Automated local recovery gate

With the disposable local Supabase stack running, execute:

```text
npm run test:restore
```

The verifier creates a PostgreSQL custom-format backup inside the local database container, calculates its SHA-256 digest, restores it into a randomly named disposable database, and compares source and restored structural evidence. It then force-drops only the validated `aios_restore_drill_<random>` database and removes only its matching temporary dump, including on failure.

The latest 8 August checkpoint restored 77 application tables with RLS, 185 policies, 412 indexes, 83 public functions, all 87 migrations through `20260801250000`, and representative organization, membership, and audit row counts. Source and restored evidence matched exactly. Backup plus restore completed in 6.9 seconds on the local workstation, and post-run inspection found no temporary database or dump. The verified dump SHA-256 was `39422fb1bd54f55fb03e18ed562c4570838fa8002803bb646b8b3b3911aba55d`.

This proves the logical PostgreSQL backup is restorable in the matching Supabase PostgreSQL image. It does not prove hosted recovery time, managed point-in-time recovery, Auth/provider configuration, secrets, or Storage object bytes.

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
   npm run test:restore
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
