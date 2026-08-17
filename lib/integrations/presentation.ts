import {
  INTEGRATION_CATALOG,
  type IntegrationProvider,
  type IntegrationSummary,
} from "./catalog";

export type IntegrationUiState =
  | "setup_required"
  | "not_verified"
  | "connected"
  | "active"
  | "needs_attention";

export const INTEGRATION_UI_STATE_LABELS: Record<IntegrationUiState, string> = {
  setup_required: "Setup required",
  not_verified: "Not verified",
  connected: "Connected",
  active: "Active",
  needs_attention: "Needs attention",
};

export function deriveIntegrationUiState(
  integration: IntegrationSummary | undefined,
): IntegrationUiState {
  if (!integration) return "setup_required";
  if (integration.connectionStatus === "failed") return "needs_attention";
  if (integration.connectionStatus === "not_tested") return "not_verified";
  return integration.isEnabled &&
    INTEGRATION_CATALOG[integration.provider].runtimeAvailability === "available"
    ? "active"
    : "connected";
}

export function integrationPrimaryAction(
  provider: IntegrationProvider,
  integration: IntegrationSummary | undefined,
) {
  const state = deriveIntegrationUiState(integration);
  if (state === "setup_required") return "Connect";
  if (state === "not_verified") return "Verify";
  if (state === "needs_attention") return "Repair";
  if (
    state === "connected" &&
    INTEGRATION_CATALOG[provider].runtimeAvailability === "available"
  ) {
    return "Activate";
  }
  return "Manage";
}
