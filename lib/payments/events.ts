import { createHash } from "node:crypto";

import { z } from "zod";

export const PAYMENT_PROVIDER_EVENT_CONTRACT_VERSION =
  "payment-provider-event-v1";
export const SANDBOX_PAYMENT_EVENT_TYPE = "payment.succeeded";

export const paymentProviderEventSimulationRequestSchema = z.object({
  organizationId: z.uuid(),
  paymentLinkExecutionId: z.uuid(),
  paymentId: z.uuid(),
  providerKey: z.literal("sandbox"),
  providerEnvironment: z.literal("sandbox"),
  idempotencyKey: z.string().regex(/^[0-9a-f]{64}$/),
  providerReference: z.string().regex(/^sbx_[0-9a-f]{32}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  requestedAmount: z.number().positive().max(999_999_999_999.99),
  executionCreatedAtEpochMs: z.number().int().safe().positive(),
});

export const paymentProviderEventResultSchema = z.object({
  providerEventId: z.string().regex(/^sbxevt_[0-9a-f]{32}$/),
  providerEventType: z.literal(SANDBOX_PAYMENT_EVENT_TYPE),
  providerReference: z.string().regex(/^sbx_[0-9a-f]{32}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reportedAmount: z.number().positive().max(999_999_999_999.99),
  occurredAtEpochMs: z.number().int().safe().positive(),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceKind: z.literal("sandbox_simulator"),
  signatureVerified: z.literal(false),
  externalNetworkCallPerformed: z.literal(false),
  paymentCollected: z.literal(false),
  settlementRecorded: z.literal(false),
});

export type PaymentProviderEventSimulationRequest = z.infer<
  typeof paymentProviderEventSimulationRequestSchema
>;
export type PaymentProviderEventResult = z.infer<
  typeof paymentProviderEventResultSchema
>;

function sha256(lines: Array<string | number>) {
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export function sandboxPaymentProviderEventId(
  request: Pick<
    PaymentProviderEventSimulationRequest,
    "paymentLinkExecutionId" | "idempotencyKey"
  >,
) {
  return `sbxevt_${sha256([
    "sandbox-payment-event-v1",
    request.paymentLinkExecutionId,
    request.idempotencyKey,
    SANDBOX_PAYMENT_EVENT_TYPE,
  ]).slice(0, 32)}`;
}

export function paymentProviderEventPayloadSha256(input: {
  organizationId: string;
  paymentLinkExecutionId: string;
  providerEventId: string;
  providerEventType: string;
  providerKey: string;
  providerEnvironment: string;
  providerReference: string;
  currency: string;
  reportedAmount: number;
  occurredAtEpochMs: number;
}) {
  return sha256([
    PAYMENT_PROVIDER_EVENT_CONTRACT_VERSION,
    input.organizationId,
    input.paymentLinkExecutionId,
    input.providerEventId,
    input.providerEventType,
    input.providerKey.trim().toLowerCase(),
    input.providerEnvironment.trim().toLowerCase(),
    input.providerReference.trim(),
    input.currency.trim().toUpperCase(),
    input.reportedAmount.toFixed(2),
    input.occurredAtEpochMs,
  ]);
}
