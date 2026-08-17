import {
  INTEGRATION_CATALOG,
  isIntegrationRuntimeReady,
  type IntegrationConnectionStatus,
  type IntegrationProvider,
} from "./catalog";

type SaveActivationInput = {
  requestedEnabled: boolean;
  materialChanged: boolean;
  existingStatus?: IntegrationConnectionStatus | null;
  lastTestedAt?: string | null;
  lastTestMessage?: string | null;
};

export function assertIntegrationActivationAvailable(
  provider: IntegrationProvider,
  requestedEnabled: boolean,
) {
  if (requestedEnabled && !isIntegrationRuntimeReady(provider)) {
    throw new Error(
      `${INTEGRATION_CATALOG[provider].label} can be configured and verified, but live execution is not available yet.`,
    );
  }
}

export function resolveIntegrationSaveActivation({
  requestedEnabled,
  materialChanged,
  existingStatus,
  lastTestedAt,
  lastTestMessage,
}: SaveActivationInput) {
  const connectionStatus = materialChanged
    ? "not_tested"
    : existingStatus ?? "not_tested";
  const isEnabled =
    requestedEnabled && !materialChanged && connectionStatus === "connected";

  return {
    connectionStatus,
    isEnabled,
    lastTestedAt: materialChanged ? null : lastTestedAt ?? null,
    lastTestMessage: materialChanged ? null : lastTestMessage ?? null,
  } satisfies {
    connectionStatus: IntegrationConnectionStatus;
    isEnabled: boolean;
    lastTestedAt: string | null;
    lastTestMessage: string | null;
  };
}

export function enabledAfterConnectionTest(
  currentlyEnabled: boolean,
  connectionStatus: IntegrationConnectionStatus,
) {
  return connectionStatus === "failed" ? false : currentlyEnabled;
}
