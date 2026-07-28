import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlausibleLeadCaptureTiming,
  leadDedupeKey,
  leadRequestFingerprint,
  publicLeadCaptureSchema,
} from "../lib/crm/lead-capture";

const lead = publicLeadCaptureSchema.parse({
  fullName: "Rayees Amin",
  email: "rayees@stateai.in",
  phone: "",
  destination: "Kyoto",
  budgetAmount: 450000,
  currency: "inr",
  notes: "",
  communicationConsent: true,
  utmSource: "newsletter",
  utmMedium: "email",
  utmCampaign: "summer",
  landingPath: "/lead/example",
  referrerHost: "",
  website: "",
  startedAt: 1_000,
});

test("public lead capture normalizes optional fields and currency", () => {
  assert.equal(lead.phone, null);
  assert.equal(lead.notes, null);
  assert.equal(lead.currency, "INR");
});

test("lead dedupe identity is stable but form-specific", () => {
  const first = leadDedupeKey(
    "11111111-1111-4111-8111-111111111111",
    lead,
  );
  const second = leadDedupeKey(
    "11111111-1111-4111-8111-111111111111",
    lead,
  );
  const otherForm = leadDedupeKey(
    "22222222-2222-4222-8222-222222222222",
    lead,
  );
  assert.equal(first, second);
  assert.notEqual(first, otherForm);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("request fingerprints are keyed and raw-address free", () => {
  const fingerprint = leadRequestFingerprint(
    "server-only-secret",
    "203.0.113.10",
  );
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes("203.0.113.10"), false);
  assert.notEqual(
    fingerprint,
    leadRequestFingerprint("different-secret", "203.0.113.10"),
  );
});

test("capture timing rejects instant and stale form submissions", () => {
  const now = 10_000_000;
  assert.equal(isPlausibleLeadCaptureTiming(now - 999, now), false);
  assert.equal(isPlausibleLeadCaptureTiming(now - 1_001, now), true);
  assert.equal(
    isPlausibleLeadCaptureTiming(now - 2 * 60 * 60 * 1_000 - 1, now),
    false,
  );
});
