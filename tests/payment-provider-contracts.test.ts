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
