import {
  type PaymentProviderEventSimulationRequest,
  paymentProviderEventPayloadSha256,
  paymentProviderEventResultSchema,
  paymentProviderEventSimulationRequestSchema,
  SANDBOX_PAYMENT_EVENT_TYPE,
  sandboxPaymentProviderEventId,
} from "./events";

/**
 * Produces a synthetic provider event without a webhook or network call. The
 * event is reconciliation evidence only and cannot create a settlement.
 */
export class SandboxPaymentEventAdapter {
  async simulateSucceeded(request: PaymentProviderEventSimulationRequest) {
    const parsed = paymentProviderEventSimulationRequestSchema.parse(request);
    const occurredAtEpochMs = parsed.executionCreatedAtEpochMs;
    const providerEventId = sandboxPaymentProviderEventId(parsed);
    const event = {
      providerEventId,
      providerEventType: SANDBOX_PAYMENT_EVENT_TYPE,
      providerReference: parsed.providerReference,
      currency: parsed.currency,
      reportedAmount: parsed.requestedAmount,
      occurredAtEpochMs,
      payloadSha256: paymentProviderEventPayloadSha256({
        organizationId: parsed.organizationId,
        paymentLinkExecutionId: parsed.paymentLinkExecutionId,
        providerKey: parsed.providerKey,
        providerEnvironment: parsed.providerEnvironment,
        providerEventId,
        providerEventType: SANDBOX_PAYMENT_EVENT_TYPE,
        providerReference: parsed.providerReference,
        currency: parsed.currency,
        reportedAmount: parsed.requestedAmount,
        occurredAtEpochMs,
      }),
      sourceKind: "sandbox_simulator" as const,
      signatureVerified: false as const,
      externalNetworkCallPerformed: false as const,
      paymentCollected: false as const,
      settlementRecorded: false as const,
    };
    return paymentProviderEventResultSchema.parse(event);
  }
}
