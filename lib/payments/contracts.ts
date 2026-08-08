import { createHash } from "node:crypto";

import { z } from "zod";

export const PAYMENT_LINK_EXECUTION_CONTRACT_VERSION =
  "payment-link-execution-v1";

export const paymentLinkExecutionEvidenceSchema = z.object({
  organizationId: z.uuid(),
  paymentLinkDraftId: z.uuid(),
  approvalRequestId: z.uuid(),
  paymentId: z.uuid(),
  invoiceIssuanceId: z.uuid(),
  invoiceNumber: z.string().trim().min(4).max(40),
  currency: z.string().regex(/^[A-Z]{3}$/),
  requestedAmount: z.number().positive().max(999_999_999_999.99),
  sourceEvidenceSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const paymentLinkProviderRequestSchema =
  paymentLinkExecutionEvidenceSchema.extend({
    idempotencyKey: z.string().regex(/^[0-9a-f]{64}$/),
  });

export const paymentLinkProviderResultSchema = z.object({
  providerKey: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  providerEnvironment: z.enum(["sandbox", "production"]),
  adapterVersion: z.string().regex(/^[a-z0-9_-]+-v[0-9]+$/),
  providerReference: z.string().trim().min(8).max(180),
  checkoutTarget: z.string().trim().min(20).max(500),
  checkoutTokenSha256: z.string().regex(/^[0-9a-f]{64}$/),
  checkoutExpiresAt: z.iso.datetime({ offset: true }),
  realMoneyCapable: z.boolean(),
  externalNetworkCallPerformed: z.boolean(),
});

export type PaymentLinkExecutionEvidence = z.infer<
  typeof paymentLinkExecutionEvidenceSchema
>;
export type PaymentLinkProviderRequest = z.infer<
  typeof paymentLinkProviderRequestSchema
>;
export type PaymentLinkProviderResult = z.infer<
  typeof paymentLinkProviderResultSchema
>;

export interface PaymentLinkProviderAdapter {
  readonly providerKey: string;
  readonly providerEnvironment: "sandbox" | "production";
  readonly adapterVersion: string;
  createPaymentLink(
    request: PaymentLinkProviderRequest,
  ): Promise<PaymentLinkProviderResult>;
}

/**
 * Stable provider idempotency evidence shared with the database guard. It
 * intentionally contains identifiers and hashes only—never customer PII.
 */
export function paymentLinkExecutionIdempotencyKey(
  evidence: Pick<
    PaymentLinkExecutionEvidence,
    | "organizationId"
    | "paymentLinkDraftId"
    | "approvalRequestId"
    | "sourceEvidenceSha256"
  > & {
    providerKey: string;
    providerEnvironment: "sandbox" | "production";
  },
) {
  const normalizedProvider = evidence.providerKey.trim().toLowerCase();
  const canonical = [
    PAYMENT_LINK_EXECUTION_CONTRACT_VERSION,
    evidence.organizationId,
    evidence.paymentLinkDraftId,
    evidence.approvalRequestId,
    normalizedProvider,
    evidence.providerEnvironment,
    evidence.sourceEvidenceSha256,
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
