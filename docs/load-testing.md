# Bounded load and failure smoke

The local production smoke is an early-warning reliability gate, not a production capacity claim. It exercises only read-only health traffic and anonymous security boundaries, so it never invokes a model, sends mail, runs a worker, or mutates customer records.

## Default contract

After building the production bundle with the disposable local Supabase environment loaded, run:

```text
npm run test:load
```

The command starts an isolated Next.js production server on a random loopback port, gives it a disposable worker secret, and runs:

- 240 concurrent-scheduled health requests, all requiring HTTP 200
- 80 anonymous AIOS-status requests, all requiring HTTP 401
- 80 anonymous worker POST requests, all requiring HTTP 401

The default concurrency is 16. Every response body is consumed, transport failures must be zero, health p95 must stay at or below 750 ms, and protected-boundary p95 must stay at or below 2,000 ms. The isolated server is stopped even when an assertion fails.

The verifier refuses a non-loopback application or Supabase target by default. It can target an already-running local server with `LOAD_SMOKE_BASE_URL`. External execution requires the explicit `ALLOW_EXTERNAL_LOAD_SMOKE=true` opt-in and must be separately authorized for that environment.

## Bounded tuning

These variables may tune a deliberate test without editing the script:

```text
LOAD_SMOKE_HEALTH_REQUESTS=240
LOAD_SMOKE_BOUNDARY_REQUESTS=80
LOAD_SMOKE_CONCURRENCY=16
LOAD_SMOKE_REQUEST_TIMEOUT_MS=5000
LOAD_SMOKE_HEALTH_P95_MS=750
LOAD_SMOKE_BOUNDARY_P95_MS=2000
```

Every value has a hard upper and lower bound. Do not raise concurrency or point the command at staging/production without checking provider quotas, deployment limits, monitoring, and explicit authorization.

## What remains for launch

Before production acceptance, add workload-informed scenarios for authenticated reads, representative tenant sizes, queued workers, database pool saturation, rate limits, provider timeouts, recovery, and sustained soak behavior. Run them in a production-like staging environment with structured telemetry and an agreed performance budget.
