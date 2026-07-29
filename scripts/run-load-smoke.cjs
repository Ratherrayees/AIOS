/* eslint-disable @typescript-eslint/no-require-imports */

const { spawn } = require("node:child_process");
const { randomBytes, randomInt } = require("node:crypto");

const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const ownsServer = !process.env.LOAD_SMOKE_BASE_URL;
const localPort = ownsServer ? randomInt(40_000, 48_000) : null;
const baseUrl = new URL(
  process.env.LOAD_SMOKE_BASE_URL ||
    `http://127.0.0.1:${String(localPort)}`,
);
const allowExternal = process.env.ALLOW_EXTERNAL_LOAD_SMOKE === "true";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const supabaseUrl = new URL(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
);

if (!allowExternal && !loopbackHosts.has(baseUrl.hostname)) {
  throw new Error(
    "Load verification is local-only unless ALLOW_EXTERNAL_LOAD_SMOKE=true.",
  );
}
if (
  !allowExternal &&
  (!loopbackHosts.has(supabaseUrl.hostname) || supabaseUrl.port !== "54321")
) {
  throw new Error(
    "Set the local Supabase URL before running the load verification.",
  );
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

const healthRequests = boundedInteger(
  "LOAD_SMOKE_HEALTH_REQUESTS",
  240,
  10,
  2_000,
);
const boundaryRequests = boundedInteger(
  "LOAD_SMOKE_BOUNDARY_REQUESTS",
  80,
  10,
  500,
);
const concurrency = boundedInteger("LOAD_SMOKE_CONCURRENCY", 16, 1, 50);
const requestTimeoutMs = boundedInteger(
  "LOAD_SMOKE_REQUEST_TIMEOUT_MS",
  5_000,
  500,
  30_000,
);
const healthP95LimitMs = boundedInteger(
  "LOAD_SMOKE_HEALTH_P95_MS",
  750,
  50,
  10_000,
);
const boundaryP95LimitMs = boundedInteger(
  "LOAD_SMOKE_BOUNDARY_P95_MS",
  2_000,
  100,
  15_000,
);
const workerSecret = randomBytes(48).toString("base64url");
let serverProcess = null;

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  const index = Math.max(
    0,
    Math.ceil(sortedValues.length * fraction) - 1,
  );
  return sortedValues[index];
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error("The isolated load server exited before becoming ready.");
    }
    try {
      const response = await fetch(new URL("/api/health", baseUrl), {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The isolated load server did not become ready.");
}

async function startIsolatedServer() {
  if (!ownsServer) return;
  serverProcess = spawn(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "start", "--port", String(localPort)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AIOS_WORKER_SECRET: workerSecret,
      },
      stdio: "ignore",
    },
  );
  await waitForHealth();
}

async function stopIsolatedServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function validateHealthContract() {
  const response = await fetch(new URL("/api/health", baseUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json();
  if (
    response.status !== 200 ||
    body.status !== "ok" ||
    body.service !== "aios-travel-crm"
  ) {
    throw new Error("The target does not expose the expected AIOS health contract.");
  }
}

async function runScenario({
  name,
  pathname,
  method = "GET",
  requests,
  allowedStatuses,
  p95LimitMs,
}) {
  const latencies = [];
  const statusCounts = new Map();
  const failures = [];
  let nextRequest = 0;

  async function worker() {
    while (true) {
      const requestIndex = nextRequest;
      nextRequest += 1;
      if (requestIndex >= requests) return;

      const startedAt = performance.now();
      try {
        const response = await fetch(new URL(pathname, baseUrl), {
          method,
          cache: "no-store",
          headers: { "user-agent": "aios-local-load-smoke" },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        await response.arrayBuffer();
        latencies.push(performance.now() - startedAt);
        statusCounts.set(
          response.status,
          (statusCounts.get(response.status) || 0) + 1,
        );
        if (!allowedStatuses.includes(response.status)) {
          failures.push(
            `request ${requestIndex + 1} returned ${response.status}`,
          );
        }
      } catch (error) {
        failures.push(
          `request ${requestIndex + 1} failed: ${
            error instanceof Error ? error.name : "unknown error"
          }`,
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, requests) },
      () => worker(),
    ),
  );

  const sortedLatencies = latencies.toSorted((left, right) => left - right);
  const result = {
    name,
    requests,
    concurrency: Math.min(concurrency, requests),
    statuses: Object.fromEntries(
      [...statusCounts.entries()].sort(([left], [right]) => left - right),
    ),
    transportFailures: failures.length,
    latencyMs: {
      p50: Math.round(percentile(sortedLatencies, 0.5)),
      p95: Math.round(percentile(sortedLatencies, 0.95)),
      p99: Math.round(percentile(sortedLatencies, 0.99)),
      max: Math.round(sortedLatencies.at(-1) || 0),
      p95Limit: p95LimitMs,
    },
  };

  if (failures.length) {
    throw new Error(`${name} failed: ${failures.slice(0, 3).join("; ")}.`);
  }
  if (result.latencyMs.p95 > p95LimitMs) {
    throw new Error(
      `${name} p95 ${result.latencyMs.p95}ms exceeded ${p95LimitMs}ms.`,
    );
  }
  return result;
}

async function main() {
  try {
    await startIsolatedServer();
    await validateHealthContract();

    const workerStatuses = ownsServer ? [401] : [401, 503];
    const scenarios = [];
    scenarios.push(
      await runScenario({
        name: "health availability",
        pathname: "/api/health",
        requests: healthRequests,
        allowedStatuses: [200],
        p95LimitMs: healthP95LimitMs,
      }),
    );
    scenarios.push(
      await runScenario({
        name: "anonymous AIOS status boundary",
        pathname: "/api/aios/status",
        requests: boundaryRequests,
        allowedStatuses: [401],
        p95LimitMs: boundaryP95LimitMs,
      }),
    );
    scenarios.push(
      await runScenario({
        name: "anonymous worker boundary",
        pathname: "/api/internal/aios/jobs",
        method: "POST",
        requests: boundaryRequests,
        allowedStatuses: workerStatuses,
        p95LimitMs: boundaryP95LimitMs,
      }),
    );

    process.stdout.write(
      `${JSON.stringify({
        target: allowExternal ? baseUrl.origin : "local-isolated-production",
        totalRequests: scenarios.reduce(
          (total, scenario) => total + scenario.requests,
          0,
        ),
        scenarios,
      })}\n`,
    );
  } finally {
    await stopIsolatedServer();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Load verification failed."}\n`,
  );
  process.exitCode = 1;
});
