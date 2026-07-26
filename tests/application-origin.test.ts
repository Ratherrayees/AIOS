import assert from "node:assert/strict";
import test from "node:test";

import { resolveApplicationOrigin } from "../lib/auth/application-origin";

test("production authentication callbacks use the configured HTTPS origin", () => {
  assert.equal(
    resolveApplicationOrigin({
      configuredOrigin: "https://travel.stateai.in",
      requestOrigin: "https://malicious.example",
      production: true,
    }),
    "https://travel.stateai.in",
  );
});

test("production callbacks fail closed without a configured origin", () => {
  assert.equal(
    resolveApplicationOrigin({
      requestOrigin: "https://travel.stateai.in",
      production: true,
    }),
    null,
  );
});

test("configured callback origins reject insecure non-loopback URLs", () => {
  assert.equal(
    resolveApplicationOrigin({
      configuredOrigin: "http://travel.stateai.in",
      production: true,
    }),
    null,
  );
});

test("configured callback origins reject paths, credentials, and fragments", () => {
  assert.equal(
    resolveApplicationOrigin({
      configuredOrigin: "https://user@travel.stateai.in/auth#fragment",
      production: true,
    }),
    null,
  );
});

test("local development may preserve a loopback request origin", () => {
  assert.equal(
    resolveApplicationOrigin({
      requestOrigin: "http://127.0.0.1:3000",
      production: false,
    }),
    "http://127.0.0.1:3000",
  );
});

test("local development does not reflect a foreign request origin", () => {
  assert.equal(
    resolveApplicationOrigin({
      requestOrigin: "https://malicious.example",
      production: false,
    }),
    "http://localhost:3000",
  );
});
