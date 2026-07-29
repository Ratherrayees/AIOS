/* eslint-disable @typescript-eslint/no-require-imports */

const { spawn } = require("node:child_process");
const { createHmac, randomBytes, randomInt, randomUUID } = require("node:crypto");

const { loadEnvConfig } = require("@next/env");
const { createClient } = require("@supabase/supabase-js");

loadEnvConfig(process.cwd());

const ownsServer = !process.env.WEBHOOK_TEST_BASE_URL;
const localPort = ownsServer ? randomInt(32_000, 40_000) : null;
const persistenceFailurePort = ownsServer
  ? localPort === 39_999
    ? 32_000
    : localPort + 1
  : null;
const baseUrl = new URL(
  process.env.WEBHOOK_TEST_BASE_URL ||
    `http://127.0.0.1:${String(localPort)}`,
);
const supabaseUrl = new URL(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
);
const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
const localWebhookSecret = (() => {
  while (true) {
    const candidate = randomBytes(27).toString("base64");
    if (/^[A-Za-z0-9]+$/.test(candidate)) return `whsec_${candidate}`;
  }
})();
const webhookSecret =
  process.env.RESEND_WEBHOOK_SECRET || localWebhookSecret;
const allowExternal = process.env.ALLOW_EXTERNAL_WEBHOOK_TEST === "true";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (!allowExternal && !loopbackHosts.has(baseUrl.hostname)) {
  throw new Error(
    "Webhook verification is local-only unless ALLOW_EXTERNAL_WEBHOOK_TEST=true.",
  );
}
if (
  !allowExternal &&
  (!loopbackHosts.has(supabaseUrl.hostname) || supabaseUrl.port !== "54321")
) {
  throw new Error(
    "Set the local Supabase URL and secret before running webhook verification.",
  );
}
if (!supabaseSecret || !webhookSecret.startsWith("whsec_")) {
  throw new Error("Supabase and Resend webhook test credentials are required.");
}

const endpoint = new URL("/api/webhooks/resend", baseUrl);
const admin = createClient(supabaseUrl.toString(), supabaseSecret, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const providerEventId = `evt_local_${randomUUID()}`;
const persistenceFailureEventId = `${providerEventId}_persistence`;
const payload = JSON.stringify({
  type: "email.delivered",
  created_at: new Date().toISOString(),
  data: { email_id: `email_local_${randomUUID()}` },
});
let serverProcess = null;
let persistenceFailureServerProcess = null;

async function startIsolatedServer() {
  if (!ownsServer) return;
  serverProcess = spawn(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "start", "--port", String(localPort)],
    {
      cwd: process.cwd(),
      env: { ...process.env, RESEND_WEBHOOK_SECRET: webhookSecret },
      stdio: "ignore",
    },
  );

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error("The isolated webhook server exited before becoming ready.");
    }
    try {
      const response = await fetch(new URL("/api/health", baseUrl));
      if (response.ok) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The isolated webhook server did not become ready.");
}

async function stopIsolatedServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function startPersistenceFailureServer() {
  if (!ownsServer) return;
  persistenceFailureServerProcess = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "start",
      "--port",
      String(persistenceFailurePort),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RESEND_WEBHOOK_SECRET: webhookSecret,
        SUPABASE_SECRET_KEY: "invalid-local-webhook-test-key",
      },
      stdio: "ignore",
    },
  );

  const failureBaseUrl = new URL(
    `http://127.0.0.1:${String(persistenceFailurePort)}`,
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (persistenceFailureServerProcess.exitCode !== null) {
      throw new Error(
        "The persistence-failure server exited before becoming ready.",
      );
    }
    try {
      const response = await fetch(new URL("/api/health", failureBaseUrl));
      if (response.ok) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The persistence-failure server did not become ready.");
}

async function stopPersistenceFailureServer() {
  if (
    !persistenceFailureServerProcess ||
    persistenceFailureServerProcess.exitCode !== null
  ) {
    return;
  }
  persistenceFailureServerProcess.kill();
  await Promise.race([
    new Promise((resolve) =>
      persistenceFailureServerProcess.once("exit", resolve),
    ),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

function webhookSignature(id, timestamp, rawPayload) {
  const key = Buffer.from(webhookSecret.slice("whsec_".length), "base64");
  const digest = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawPayload}`)
    .digest("base64");
  return `v1,${digest}`;
}

async function post(rawPayload, headers = {}, target = endpoint) {
  return fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawPayload,
    redirect: "manual",
  });
}

async function cleanupFixture() {
  const { error } = await admin
    .from("email_webhook_events")
    .delete()
    .in("provider_event_id", [providerEventId, persistenceFailureEventId]);
  if (error) throw error;
}

async function expectJson(response, status, expected) {
  const body = await response.json();
  if (response.status !== status) {
    throw new Error(
      `Expected webhook status ${status}, received ${response.status}.`,
    );
  }
  for (const [key, value] of Object.entries(expected)) {
    if (body[key] !== value) {
      throw new Error(`Expected webhook response ${key}=${String(value)}.`);
    }
  }
}

async function main() {
  const checks = [];
  const record = (name) => checks.push({ name, passed: true });
  const currentTimestamp = Math.floor(Date.now() / 1000);

  try {
    await startIsolatedServer();

    await expectJson(await post(payload), 400, { error: "invalid_webhook" });
    record("missing signatures fail closed");

    await expectJson(
      await post(payload, {
        "svix-id": providerEventId,
        "svix-timestamp": String(currentTimestamp),
        "svix-signature": "v1,invalid",
      }),
      400,
      { error: "invalid_webhook" },
    );
    record("invalid signatures fail closed");

    const staleTimestamp = currentTimestamp - 601;
    await expectJson(
      await post(payload, {
        "svix-id": providerEventId,
        "svix-timestamp": String(staleTimestamp),
        "svix-signature": webhookSignature(
          providerEventId,
          staleTimestamp,
          payload,
        ),
      }),
      400,
      { error: "invalid_webhook" },
    );
    record("stale signed requests fail closed");

    await expectJson(
      await post("x".repeat(1_000_001), {
        "svix-id": `${providerEventId}_oversized`,
        "svix-timestamp": String(currentTimestamp),
        "svix-signature": "v1,invalid",
      }),
      400,
      { error: "invalid_webhook" },
    );
    record("oversized payloads fail closed");

    const validHeaders = {
      "svix-id": providerEventId,
      "svix-timestamp": String(currentTimestamp),
      "svix-signature": webhookSignature(
        providerEventId,
        currentTimestamp,
        payload,
      ),
    };
    await expectJson(await post(payload, validHeaders), 200, {
      received: true,
    });
    record("a current signed event is accepted");

    await expectJson(await post(payload, validHeaders), 200, {
      received: true,
      duplicate: true,
    });
    record("duplicate delivery is acknowledged idempotently");

    const { data: storedEvents, error } = await admin
      .from("email_webhook_events")
      .select("provider_event_id, event_type, payload")
      .eq("provider_event_id", providerEventId);
    if (error) throw error;
    if (
      storedEvents.length !== 1 ||
      storedEvents[0].event_type !== "email.delivered" ||
      storedEvents[0].provider_event_id !== providerEventId
    ) {
      throw new Error("Webhook persistence was not exactly once.");
    }
    record("one private event is persisted exactly once");

    if (ownsServer) {
      await startPersistenceFailureServer();
      const failureTimestamp = Math.floor(Date.now() / 1000);
      const failureEndpoint = new URL(
        "/api/webhooks/resend",
        `http://127.0.0.1:${String(persistenceFailurePort)}`,
      );
      await expectJson(
        await post(
          payload,
          {
            "svix-id": persistenceFailureEventId,
            "svix-timestamp": String(failureTimestamp),
            "svix-signature": webhookSignature(
              persistenceFailureEventId,
              failureTimestamp,
              payload,
            ),
          },
          failureEndpoint,
        ),
        500,
        { error: "webhook_persistence_failed" },
      );
      record("persistence failures remain distinct from invalid traffic");
    }

    process.stdout.write(`${JSON.stringify({ checks })}\n`);
  } finally {
    try {
      await cleanupFixture();
    } finally {
      await Promise.all([
        stopIsolatedServer(),
        stopPersistenceFailureServer(),
      ]);
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Webhook verification failed."}\n`,
  );
  process.exitCode = 1;
});
