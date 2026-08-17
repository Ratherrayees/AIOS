import assert from "node:assert/strict";
import test from "node:test";

import {
  assertIntegrationActivationAvailable,
  enabledAfterConnectionTest,
  resolveIntegrationSaveActivation,
} from "../lib/integrations/activation";
import {
  isIntegrationRuntimeReady,
} from "../lib/integrations/catalog";
import {
  deriveIntegrationUiState,
  integrationPrimaryAction,
} from "../lib/integrations/presentation";
import type { IntegrationSummary } from "../lib/integrations/catalog";

function summary(
  overrides: Partial<IntegrationSummary> = {},
): IntegrationSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    provider: "openai",
    category: "ai",
    isEnabled: false,
    publicConfig: { model: "model-id" },
    credentialHint: "••••test",
    connectionStatus: "not_tested",
    lastTestedAt: null,
    lastTestMessage: null,
    updatedAt: "2026-08-11T10:00:00.000Z",
    ...overrides,
  };
}

test("new tenant credentials cannot activate before a successful test", () => {
  assert.deepEqual(
    resolveIntegrationSaveActivation({
      requestedEnabled: true,
      materialChanged: true,
    }),
    {
      connectionStatus: "not_tested",
      isEnabled: false,
      lastTestedAt: null,
      lastTestMessage: null,
    },
  );
});

test("unchanged connected credentials can be enabled explicitly", () => {
  assert.deepEqual(
    resolveIntegrationSaveActivation({
      requestedEnabled: true,
      materialChanged: false,
      existingStatus: "connected",
      lastTestedAt: "2026-08-11T10:00:00.000Z",
      lastTestMessage: "Connection verified.",
    }),
    {
      connectionStatus: "connected",
      isEnabled: true,
      lastTestedAt: "2026-08-11T10:00:00.000Z",
      lastTestMessage: "Connection verified.",
    },
  );
});

test("changing active credentials revokes their verification and activation", () => {
  const result = resolveIntegrationSaveActivation({
    requestedEnabled: true,
    materialChanged: true,
    existingStatus: "connected",
    lastTestedAt: "2026-08-11T10:00:00.000Z",
    lastTestMessage: "Connection verified.",
  });
  assert.equal(result.connectionStatus, "not_tested");
  assert.equal(result.isEnabled, false);
  assert.equal(result.lastTestedAt, null);
  assert.equal(result.lastTestMessage, null);
});

test("a failed connection cannot be enabled without a new successful test", () => {
  const result = resolveIntegrationSaveActivation({
    requestedEnabled: true,
    materialChanged: false,
    existingStatus: "failed",
  });
  assert.equal(result.isEnabled, false);
  assert.equal(result.connectionStatus, "failed");
});

test("a failed retest disables an active provider while a successful retest preserves state", () => {
  assert.equal(enabledAfterConnectionTest(true, "failed"), false);
  assert.equal(enabledAfterConnectionTest(true, "connected"), true);
  assert.equal(enabledAfterConnectionTest(false, "connected"), false);
});

test("the presentation model derives one canonical state from existing records", () => {
  assert.equal(deriveIntegrationUiState(undefined), "setup_required");
  assert.equal(deriveIntegrationUiState(summary()), "not_verified");
  assert.equal(
    deriveIntegrationUiState(
      summary({
        connectionStatus: "connected",
        lastTestedAt: "2026-08-11T10:00:00.000Z",
        lastTestMessage: "Connection verified.",
      }),
    ),
    "connected",
  );
  assert.equal(
    deriveIntegrationUiState(
      summary({
        connectionStatus: "connected",
        isEnabled: true,
        lastTestedAt: "2026-08-11T10:00:00.000Z",
        lastTestMessage: "Connection verified.",
      }),
    ),
    "active",
  );
  assert.equal(
    deriveIntegrationUiState(
      summary({
        connectionStatus: "failed",
        lastTestedAt: "2026-08-11T10:00:00.000Z",
        lastTestMessage: "Authentication failed.",
      }),
    ),
    "needs_attention",
  );
});

test("provider actions follow state without overstating setup-only capabilities", () => {
  assert.equal(integrationPrimaryAction("resend", undefined), "Connect");
  assert.equal(integrationPrimaryAction("openai", summary()), "Verify");
  assert.equal(
    integrationPrimaryAction(
      "openai",
      summary({ connectionStatus: "failed" }),
    ),
    "Repair",
  );
  assert.equal(
    integrationPrimaryAction(
      "openai",
      summary({ connectionStatus: "connected" }),
    ),
    "Activate",
  );
  assert.equal(
    integrationPrimaryAction(
      "stripe",
      summary({ provider: "stripe", category: "payment", connectionStatus: "connected" }),
    ),
    "Manage",
  );
  assert.equal(
    deriveIntegrationUiState(
      summary({
        provider: "stripe",
        category: "payment",
        connectionStatus: "connected",
        isEnabled: true,
      }),
    ),
    "connected",
  );
});

test("only released provider adapters can be activated", () => {
  assert.equal(isIntegrationRuntimeReady("resend"), true);
  assert.equal(isIntegrationRuntimeReady("custom_smtp"), true);
  assert.equal(isIntegrationRuntimeReady("openai"), true);
  assert.equal(isIntegrationRuntimeReady("anthropic"), true);
  assert.equal(isIntegrationRuntimeReady("stripe"), false);
  assert.equal(isIntegrationRuntimeReady("razorpay"), false);
  assert.equal(isIntegrationRuntimeReady("whatsapp_cloud"), false);
  assert.doesNotThrow(() => assertIntegrationActivationAvailable("resend", true));
  assert.doesNotThrow(() => assertIntegrationActivationAvailable("stripe", false));
  assert.throws(
    () => assertIntegrationActivationAvailable("stripe", true),
    /live execution is not available yet/i,
  );
});
