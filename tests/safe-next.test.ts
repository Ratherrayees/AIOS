import assert from "node:assert/strict";
import test from "node:test";

import { safeInternalPath } from "../lib/auth/safe-next";

test("safe redirects preserve an internal path and query", () => {
  assert.equal(
    safeInternalPath("/auth/invite?token=abc"),
    "/auth/invite?token=abc",
  );
});

test("platform invitation bearers are never propagated through auth return URLs", () => {
  assert.equal(
    safeInternalPath(`/auth/platform-invite/redeem?token=${"a".repeat(43)}`),
    "/auth/platform-invite",
  );
  assert.equal(
    safeInternalPath(`/auth/platform-invite?token=${"b".repeat(43)}`),
    "/auth/platform-invite",
  );
});

test("safe redirects reject protocol-relative destinations", () => {
  assert.equal(safeInternalPath("//malicious.example/path"), "/");
});

test("safe redirects reject absolute external destinations", () => {
  assert.equal(safeInternalPath("https://malicious.example/path"), "/");
});

test("safe redirects fall back for missing values", () => {
  assert.equal(safeInternalPath(null), "/");
});
