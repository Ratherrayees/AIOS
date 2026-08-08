import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  PAYMENT_LINK_EXECUTION_CONTRACT_VERSION,
  paymentLinkExecutionIdempotencyKey,
  paymentLinkProviderRequestSchema,
} from "../lib/payments/contracts";
import {
  SANDBOX_PAYMENT_ADAPTER_VERSION,
  SandboxPaymentLinkAdapter,
} from "../lib/payments/sandbox-adapter";
import {
  sandboxPaymentCheckoutTokenHash,
  sandboxPaymentCheckoutTokenSchema,
} from "../lib/payments/sandbox-token";
import {
  PAYMENT_PROVIDER_EVENT_CONTRACT_VERSION,
  paymentProviderEventPayloadSha256,
  paymentProviderEventSimulationRequestSchema,
  sandboxPaymentProviderEventId,
} from "../lib/payments/events";
import { SandboxPaymentEventAdapter } from "../lib/payments/sandbox-event-adapter";

const evidence = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  paymentLinkDraftId: "22222222-2222-4222-8222-222222222222",
  approvalRequestId: "33333333-3333-4333-8333-333333333333",
  paymentId: "44444444-4444-4444-8444-444444444444",
  invoiceIssuanceId: "55555555-5555-4555-8555-555555555555",
  invoiceNumber: "INV/2027-00043",
  currency: "INR",
  requestedAmount: 151_200,
  sourceEvidenceSha256: "a".repeat(64),
};

test("payment execution idempotency is exact-evidence and provider scoped", () => {
  const first = paymentLinkExecutionIdempotencyKey({
    ...evidence,
    providerKey: "sandbox",
    providerEnvironment: "sandbox",
  });
  const retry = paymentLinkExecutionIdempotencyKey({
    ...evidence,
    providerKey: "SANDBOX",
    providerEnvironment: "sandbox",
  });
  const changedApproval = paymentLinkExecutionIdempotencyKey({
    ...evidence,
    approvalRequestId: "66666666-6666-4666-8666-666666666666",
    providerKey: "sandbox",
    providerEnvironment: "sandbox",
  });

  assert.equal(PAYMENT_LINK_EXECUTION_CONTRACT_VERSION, "payment-link-execution-v1");
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, retry);
  assert.notEqual(first, changedApproval);
});

test("sandbox adapter produces a bounded zero-money provider result", async () => {
  const token = "A".repeat(43);
  const idempotencyKey = paymentLinkExecutionIdempotencyKey({
    ...evidence,
    providerKey: "sandbox",
    providerEnvironment: "sandbox",
  });
  const adapter = new SandboxPaymentLinkAdapter({
    now: () => new Date("2027-02-15T09:00:00Z"),
    createToken: () => token,
  });
  const result = await adapter.createPaymentLink({
    ...evidence,
    idempotencyKey,
  });

  assert.deepEqual(result, {
    providerKey: "sandbox",
    providerEnvironment: "sandbox",
    adapterVersion: SANDBOX_PAYMENT_ADAPTER_VERSION,
    providerReference: `sbx_${idempotencyKey.slice(0, 32)}`,
    checkoutTarget: `/sandbox/pay/${token}`,
    checkoutTokenSha256: createHash("sha256")
      .update(token, "utf8")
      .digest("hex"),
    checkoutExpiresAt: "2027-02-16T09:00:00.000Z",
    realMoneyCapable: false,
    externalNetworkCallPerformed: false,
  });
});

test("sandbox adapter rejects malformed provider input and checkout tokens", async () => {
  assert.throws(() =>
    paymentLinkProviderRequestSchema.parse({
      ...evidence,
      requestedAmount: 0,
      idempotencyKey: "0".repeat(64),
    }),
  );
  const adapter = new SandboxPaymentLinkAdapter({
    createToken: () => "too-short",
  });
  await assert.rejects(() =>
    adapter.createPaymentLink({
      ...evidence,
      idempotencyKey: "0".repeat(64),
    }),
  );
});

test("sandbox checkout tokens are full base64url bearer values", () => {
  const token = "z".repeat(43);
  assert.equal(sandboxPaymentCheckoutTokenSchema.safeParse(token).success, true);
  assert.equal(
    sandboxPaymentCheckoutTokenSchema.safeParse(`${token}=`).success,
    false,
  );
  assert.equal(
    sandboxPaymentCheckoutTokenHash(token),
    createHash("sha256").update(token, "utf8").digest("hex"),
  );
});

const eventRequest = {
  organizationId: evidence.organizationId,
  paymentLinkExecutionId: "77777777-7777-4777-8777-777777777777",
  paymentId: evidence.paymentId,
  providerKey: "sandbox" as const,
  providerEnvironment: "sandbox" as const,
  idempotencyKey: "b".repeat(64),
  providerReference: `sbx_${"c".repeat(32)}`,
  currency: "INR",
  requestedAmount: 151_200,
  executionCreatedAtEpochMs: 1_802_768_400_000,
};

test("sandbox provider event ids and payload hashes are deterministic", () => {
  const providerEventId = sandboxPaymentProviderEventId(eventRequest);
  const input = {
    ...eventRequest,
    providerEventId,
    providerEventType: "payment.succeeded",
    reportedAmount: eventRequest.requestedAmount,
    occurredAtEpochMs: 1_802_768_400_000,
  };
  const first = paymentProviderEventPayloadSha256(input);
  const retry = paymentProviderEventPayloadSha256(input);
  const changedAmount = paymentProviderEventPayloadSha256({
    ...input,
    reportedAmount: input.reportedAmount - 1,
  });

  assert.equal(
    PAYMENT_PROVIDER_EVENT_CONTRACT_VERSION,
    "payment-provider-event-v1",
  );
  assert.match(providerEventId, /^sbxevt_[0-9a-f]{32}$/);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, retry);
  assert.notEqual(first, changedAmount);
});

test("sandbox event adapter produces reconciliation-only evidence", async () => {
  const adapter = new SandboxPaymentEventAdapter();
  const result = await adapter.simulateSucceeded(eventRequest);

  assert.equal(result.providerEventId, sandboxPaymentProviderEventId(eventRequest));
  assert.equal(result.providerEventType, "payment.succeeded");
  assert.equal(result.reportedAmount, 151_200);
  assert.equal(result.occurredAtEpochMs, 1_802_768_400_000);
  assert.equal(result.sourceKind, "sandbox_simulator");
  assert.equal(result.signatureVerified, false);
  assert.equal(result.externalNetworkCallPerformed, false);
  assert.equal(result.paymentCollected, false);
  assert.equal(result.settlementRecorded, false);
});

test("sandbox event contract rejects forged provider and money evidence", () => {
  assert.equal(
    paymentProviderEventSimulationRequestSchema.safeParse({
      ...eventRequest,
      providerKey: "live-provider",
    }).success,
    false,
  );
  assert.equal(
    paymentProviderEventSimulationRequestSchema.safeParse({
      ...eventRequest,
      requestedAmount: 0,
    }).success,
    false,
  );
});
