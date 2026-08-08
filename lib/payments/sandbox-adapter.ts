import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  type PaymentLinkProviderAdapter,
  type PaymentLinkProviderRequest,
  paymentLinkProviderRequestSchema,
  paymentLinkProviderResultSchema,
} from "./contracts";

export const SANDBOX_PAYMENT_ADAPTER_VERSION = "sandbox-v1";
const sandboxCheckoutTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

type SandboxAdapterOptions = {
  now?: () => Date;
  createToken?: () => string;
};

/**
 * Local simulation adapter. It never calls a network provider and cannot move
 * money; its output follows the same contract a future live adapter must use.
 */
export class SandboxPaymentLinkAdapter implements PaymentLinkProviderAdapter {
  readonly providerKey = "sandbox";
  readonly providerEnvironment = "sandbox" as const;
  readonly adapterVersion = SANDBOX_PAYMENT_ADAPTER_VERSION;

  constructor(private readonly options: SandboxAdapterOptions = {}) {}

  async createPaymentLink(request: PaymentLinkProviderRequest) {
    const parsed = paymentLinkProviderRequestSchema.parse(request);
    const token = sandboxCheckoutTokenSchema.parse(
      this.options.createToken?.() ?? randomBytes(32).toString("base64url"),
    );
    const now = this.options.now?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return paymentLinkProviderResultSchema.parse({
      providerKey: this.providerKey,
      providerEnvironment: this.providerEnvironment,
      adapterVersion: this.adapterVersion,
      providerReference: `sbx_${parsed.idempotencyKey.slice(0, 32)}`,
      checkoutTarget: `/sandbox/pay/${token}`,
      checkoutTokenSha256: createHash("sha256")
        .update(token, "utf8")
        .digest("hex"),
      checkoutExpiresAt: expiresAt.toISOString(),
      realMoneyCapable: false,
      externalNetworkCallPerformed: false,
    });
  }
}
