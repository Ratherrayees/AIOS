import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_RELEASE_KEYS,
  parsePlatformReleaseFlags,
} from "../lib/platform/release-contracts";

test("unreleased platform modules default to disabled", () => {
  const flags = parsePlatformReleaseFlags(undefined);
  for (const key of PLATFORM_RELEASE_KEYS) assert.equal(flags[key], false);
});

test("only known, explicitly listed server releases are enabled", () => {
  const flags = parsePlatformReleaseFlags("billing, support_access, forged, billing");
  assert.equal(flags.billing, true);
  assert.equal(flags.support_access, true);
  assert.equal(flags.usage_governance, false);
  assert.equal(Object.hasOwn(flags, "forged"), false);
});
