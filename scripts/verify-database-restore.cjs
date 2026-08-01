/* eslint-disable @typescript-eslint/no-require-imports */

const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");

const restoreDatabase = `aios_restore_drill_${randomBytes(6).toString("hex")}`;
const dumpPath = `/tmp/${restoreDatabase}.dump`;
const databaseNamePattern = /^aios_restore_drill_[a-f0-9]{12}$/;
const expectedLocalHost = "127.0.0.1";
const expectedLocalPort = "54322";
let databaseCreated = false;
let containerName = null;

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr.trim();
    const detail =
      stderr.length > 2_000
        ? `${stderr.slice(0, 1_000)}\n...\n${stderr.slice(-1_000)}`
        : stderr;
    throw new Error(
      `${command} ${args.slice(0, 4).join(" ")} failed${
        detail ? `: ${detail}` : "."
      }`,
    );
  }
  return result;
}

function supabase(args) {
  const cliPath = path.join(
    process.cwd(),
    "node_modules",
    "supabase",
    "dist",
    "supabase.js",
  );
  return run(process.execPath, [cliPath, ...args]);
}

function docker(args, options) {
  return run("docker", args, options);
}

function dockerExec(args, options) {
  if (!containerName) throw new Error("The local database container is unknown.");
  return docker(["exec", containerName, ...args], options);
}

function loadLocalStatus() {
  const result = supabase(["status", "-o", "json"]);
  const status = JSON.parse(result.stdout);
  const dbUrl = new URL(status.DB_URL);
  if (
    dbUrl.hostname !== expectedLocalHost ||
    dbUrl.port !== expectedLocalPort ||
    dbUrl.pathname !== "/postgres"
  ) {
    throw new Error(
      "The restore drill requires the disposable local Supabase database.",
    );
  }
  return status;
}

function resolveDatabaseContainer() {
  const result = docker([
    "ps",
    "--format",
    "{{.Names}}|{{.Ports}}",
  ]);
  const matches = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("|");
      return {
        name: line.slice(0, separator),
        ports: line.slice(separator + 1),
      };
    })
    .filter(
      ({ name, ports }) =>
        name.startsWith("supabase_db_") &&
        ports.includes(`${expectedLocalPort}->5432/tcp`),
    );

  if (matches.length !== 1) {
    throw new Error(
      "Expected exactly one local Supabase database container on port 54322.",
    );
  }
  return matches[0].name;
}

function databaseSnapshot(database) {
  const sql = `
    select json_build_object(
      'application_tables', (
        select count(*) from pg_tables where schemaname = 'public'
      ),
      'rls_tables', (
        select count(*)
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind = 'r'
          and relation.relrowsecurity
      ),
      'policies', (
        select count(*) from pg_policies where schemaname = 'public'
      ),
      'indexes', (
        select count(*) from pg_indexes where schemaname = 'public'
      ),
      'functions', (
        select count(*)
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
      ),
      'migrations', (
        select count(*) from supabase_migrations.schema_migrations
      ),
      'latest_migration', (
        select max(version) from supabase_migrations.schema_migrations
      ),
      'organizations', (select count(*) from public.organizations),
      'memberships', (select count(*) from public.memberships),
      'audit_events', (select count(*) from public.audit_events)
    )::text;
  `;
  const result = dockerExec([
    "psql",
    "--username",
    "supabase_admin",
    "--dbname",
    database,
    "--tuples-only",
    "--no-align",
    "--quiet",
    "--command",
    sql,
  ]);
  return JSON.parse(result.stdout.trim());
}

function cleanup() {
  if (!containerName || !databaseNamePattern.test(restoreDatabase)) return;
  if (databaseCreated) {
    dockerExec(
      [
        "dropdb",
        "--username",
        "supabase_admin",
        "--if-exists",
        "--force",
        restoreDatabase,
      ],
      { allowFailure: true },
    );
  }
  dockerExec(["rm", "-f", dumpPath], { allowFailure: true });
}

function main() {
  const startedAt = performance.now();
  loadLocalStatus();
  containerName = resolveDatabaseContainer();

  try {
    dockerExec([
      "pg_dump",
      "--username",
      "supabase_admin",
      "--dbname",
      "postgres",
      "--format",
      "custom",
      "--compress",
      "6",
      "--file",
      dumpPath,
    ]);
    const dumpFinishedAt = performance.now();

    const checksumResult = dockerExec(["sha256sum", dumpPath]);
    const checksum = checksumResult.stdout.trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/.test(checksum)) {
      throw new Error("The backup checksum could not be verified.");
    }

    const sourceSnapshot = databaseSnapshot("postgres");
    dockerExec([
      "createdb",
      "--username",
      "supabase_admin",
      "--template",
      "template0",
      restoreDatabase,
    ]);
    databaseCreated = true;

    dockerExec([
      "pg_restore",
      "--username",
      "supabase_admin",
      "--dbname",
      restoreDatabase,
      "--exit-on-error",
      dumpPath,
    ]);
    const restoreFinishedAt = performance.now();
    const restoredSnapshot = databaseSnapshot(restoreDatabase);

    const sourceSerialized = JSON.stringify(sourceSnapshot);
    const restoredSerialized = JSON.stringify(restoredSnapshot);
    if (sourceSerialized !== restoredSerialized) {
      throw new Error(
        `Restored database evidence differs from the source: source=${sourceSerialized}, restored=${restoredSerialized}.`,
      );
    }
    if (
      Number(restoredSnapshot.application_tables) < 62 ||
      restoredSnapshot.application_tables !== restoredSnapshot.rls_tables
    ) {
      throw new Error(
        "The restored database does not preserve all expected RLS-protected application tables.",
      );
    }

    process.stdout.write(
      `${JSON.stringify({
        backupSha256: checksum,
        source: sourceSnapshot,
        restored: restoredSnapshot,
        timingMs: {
          backup: Math.round(dumpFinishedAt - startedAt),
          restore: Math.round(restoreFinishedAt - dumpFinishedAt),
          total: Math.round(restoreFinishedAt - startedAt),
        },
        cleanupTarget: "validated-disposable-local-database",
      })}\n`,
    );
  } finally {
    cleanup();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Restore verification failed."}\n`,
  );
  process.exitCode = 1;
}
