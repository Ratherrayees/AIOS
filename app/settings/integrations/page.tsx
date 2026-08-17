"use client";

import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  listOrganizationIntegrations,
  removeOrganizationIntegration,
  saveOrganizationIntegration,
  testOrganizationIntegration,
} from "../../actions/integrations";
import { Button } from "../../../components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../../components/ui/empty-state";
import { FormFeedback } from "../../../components/ui/form-field";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";
import { SettingsNavigation } from "../../../components/ui/settings-navigation";
import {
  INTEGRATION_CATALOG,
  type IntegrationCategory,
  type IntegrationProvider,
  type IntegrationSummary,
} from "../../../lib/integrations/catalog";
import {
  deriveIntegrationUiState,
  integrationPrimaryAction,
  INTEGRATION_UI_STATE_LABELS,
} from "../../../lib/integrations/presentation";
import { providerFormPayload } from "../../../lib/integrations/form-payload";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../lib/supabase/workspace-context";
import { IntegrationDrawer } from "./integration-drawer";
import { ProviderFields } from "./provider-fields";
import "./integrations.css";

type IntegrationFilter = "all" | "communication" | "payment" | "ai";

const categoryGroups: {
  key: IntegrationCategory;
  label: string;
  description: string;
  providers: IntegrationProvider[];
}[] = [
  {
    key: "email",
    label: "Email",
    description: "Agency-owned outbound senders and inbound mailboxes.",
    providers: ["resend", "custom_smtp"],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    description: "Business messaging account and webhook identity.",
    providers: ["whatsapp_cloud"],
  },
  {
    key: "payment",
    label: "Payments",
    description: "Provider accounts prepared for governed payment execution.",
    providers: ["stripe", "razorpay"],
  },
  {
    key: "ai",
    label: "AI providers",
    description: "Agency-owned model accounts used through AIOS policy.",
    providers: ["openai", "anthropic"],
  },
];

const filters: { key: IntegrationFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "communication", label: "Communication" },
  { key: "payment", label: "Payments" },
  { key: "ai", label: "AI providers" },
];

function categoryMatchesFilter(
  category: IntegrationCategory,
  filter: IntegrationFilter,
) {
  if (filter === "all") return true;
  if (filter === "communication") {
    return category === "email" || category === "whatsapp";
  }
  return category === filter;
}

function formatTestTime(value: string | null) {
  if (!value) return "Never tested";
  return `Checked ${new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))}`;
}

export default function IntegrationsSettingsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Travel workspace");
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [vaultConfigured, setVaultConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingProvider, setPendingProvider] = useState<IntegrationProvider | null>(null);
  const [editingProvider, setEditingProvider] = useState<IntegrationProvider | null>(null);
  const [filter, setFilter] = useState<IntegrationFilter>("all");
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [removalConfirmation, setRemovalConfirmation] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const { active } = await loadWorkspaceContext(supabase);
      if (!active) return;
      setOrganizationId(active.organization_id);
      setWorkspaceName(active.name);
      const result = await listOrganizationIntegrations({
        organizationId: active.organization_id,
      });
      setVaultConfigured(result.vaultConfigured);
      setIntegrations(result.integrations);
    })()
      .catch((error) => {
        setLoadFailed(true);
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "AIOS could not load integration settings.",
        });
      })
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const integrationMap = useMemo(
    () => new Map(integrations.map((item) => [item.provider, item])),
    [integrations],
  );
  const activeCount = integrations.filter(
    (item) =>
      item.isEnabled &&
      INTEGRATION_CATALOG[item.provider].runtimeAvailability === "available",
  ).length;
  const attentionCount = integrations.filter(
    (item) => item.connectionStatus === "failed",
  ).length;
  const notConnectedCount = Object.keys(INTEGRATION_CATALOG).length - integrations.length;
  const editingIntegration = editingProvider
    ? integrationMap.get(editingProvider)
    : undefined;
  const editingCatalog = editingProvider
    ? INTEGRATION_CATALOG[editingProvider]
    : undefined;
  const editingState = deriveIntegrationUiState(editingIntegration);
  const isPending = editingProvider === pendingProvider;

  function replaceIntegration(integration: IntegrationSummary) {
    setIntegrations((current) => [
      ...current.filter((item) => item.provider !== integration.provider),
      integration,
    ]);
  }

  function openProvider(provider: IntegrationProvider) {
    setEditingProvider(provider);
    setDrawerDirty(false);
    setRemovalConfirmation("");
    setFeedback(null);
  }

  function closeProvider() {
    if (
      drawerDirty &&
      !window.confirm("Discard the unsaved integration changes?")
    ) {
      return;
    }
    setEditingProvider(null);
    setDrawerDirty(false);
    setRemovalConfirmation("");
  }

  function saveAndVerify(
    provider: IntegrationProvider,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!organizationId || pendingProvider) return;
    const formElement = event.currentTarget;
    const payload = providerFormPayload(provider, new FormData(formElement));
    const existing = integrationMap.get(provider);
    if (
      existing?.isEnabled &&
      drawerDirty &&
      !window.confirm(
        `Changing ${INTEGRATION_CATALOG[provider].label} credentials will temporarily deactivate it until verification succeeds. Continue?`,
      )
    ) {
      return;
    }
    const runtimeReady =
      INTEGRATION_CATALOG[provider].runtimeAvailability === "available";
    setPendingProvider(provider);
    setFeedback(null);
    startTransition(async () => {
      let saved = false;
      try {
        const stored = await saveOrganizationIntegration({
          organizationId,
          provider,
          isEnabled: runtimeReady ? (existing?.isEnabled ?? false) : false,
          ...payload,
        });
        saved = true;
        replaceIntegration(stored);
        formElement
          .querySelectorAll<HTMLInputElement>('input[type="password"]')
          .forEach((input) => {
            input.value = "";
          });

        const tested = await testOrganizationIntegration({
          organizationId,
          provider,
        });
        replaceIntegration(tested);
        setDrawerDirty(false);
        setFeedback({
          tone: tested.connectionStatus === "connected" ? "success" : "error",
          message:
            tested.connectionStatus === "connected"
              ? tested.isEnabled
                ? `${INTEGRATION_CATALOG[provider].label} was saved, verified and remains active.`
                : `${INTEGRATION_CATALOG[provider].label} was saved and verified. ${runtimeReady ? "Activate it when this agency is ready to use it." : "Live execution remains unavailable in this release."}`
              : `${INTEGRATION_CATALOG[provider].label} was saved securely but verification failed. ${tested.lastTestMessage}`,
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            saved
              ? `The configuration was saved, but verification could not complete. ${error instanceof Error ? error.message : "Try the saved connection again."}`
              : error instanceof Error
                ? error.message
                : "That integration could not be saved.",
        });
      } finally {
        setPendingProvider(null);
      }
    });
  }

  function verifySaved(provider: IntegrationProvider) {
    if (!organizationId || pendingProvider || !integrationMap.has(provider)) return;
    setPendingProvider(provider);
    setFeedback(null);
    startTransition(async () => {
      try {
        const integration = await testOrganizationIntegration({
          organizationId,
          provider,
        });
        replaceIntegration(integration);
        setFeedback({
          tone: integration.connectionStatus === "connected" ? "success" : "error",
          message: `${INTEGRATION_CATALOG[provider].label}: ${integration.lastTestMessage}`,
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "The connection test could not run.",
        });
      } finally {
        setPendingProvider(null);
      }
    });
  }

  function setProviderEnabled(provider: IntegrationProvider, enabled: boolean) {
    const integration = integrationMap.get(provider);
    if (!organizationId || pendingProvider || !integration) return;
    const isOnlyActiveProvider =
      !enabled &&
      integration.isEnabled &&
      integrations.filter(
        (item) =>
          item.category === integration.category &&
          item.isEnabled &&
          INTEGRATION_CATALOG[item.provider].runtimeAvailability === "available",
      ).length === 1;
    if (
      isOnlyActiveProvider &&
      !window.confirm(
        `Disable the only active ${INTEGRATION_CATALOG[provider].capability.toLowerCase()} provider for this agency?`,
      )
    ) {
      return;
    }
    setPendingProvider(provider);
    setFeedback(null);
    startTransition(async () => {
      try {
        const updated = await saveOrganizationIntegration({
          organizationId,
          provider,
          isEnabled: enabled,
          publicConfig: integration.publicConfig,
          secretUpdates: {},
        });
        replaceIntegration(updated);
        setFeedback({
          tone: "success",
          message: enabled
            ? `${INTEGRATION_CATALOG[provider].label} is now active for ${workspaceName}.`
            : `${INTEGRATION_CATALOG[provider].label} is connected but no longer active.`,
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "That provider state could not be changed.",
        });
      } finally {
        setPendingProvider(null);
      }
    });
  }

  function removeProvider(provider: IntegrationProvider) {
    if (!organizationId || pendingProvider) return;
    const providerName = INTEGRATION_CATALOG[provider].label;
    if (removalConfirmation.trim() !== providerName) return;
    setPendingProvider(provider);
    setFeedback(null);
    startTransition(async () => {
      try {
        await removeOrganizationIntegration({ organizationId, provider });
        setIntegrations((current) =>
          current.filter((item) => item.provider !== provider),
        );
        setEditingProvider(null);
        setDrawerDirty(false);
        setRemovalConfirmation("");
        setFeedback({
          tone: "success",
          message: `${providerName} and its encrypted credentials were removed from ${workspaceName}.`,
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "That integration could not be removed.",
        });
      } finally {
        setPendingProvider(null);
      }
    });
  }

  function reviewFirstIssue() {
    const issue = integrations.find(
      (integration) => integration.connectionStatus === "failed",
    );
    if (issue) {
      setFilter("all");
      openProvider(issue.provider);
    }
  }

  return (
    <main className="integrations-page" id="main-content" tabIndex={-1}>
      <SettingsNavigation />
      <OperationalPageHeader
        section="Administration"
        title="Integrations"
        meta={`${activeCount} active · ${attentionCount} needs attention · ${notConnectedCount} not connected`}
        actions={
          attentionCount > 0 ? (
            <Button variant="secondary" size="small" onClick={reviewFirstIssue}>
              Review issues
            </Button>
          ) : undefined
        }
      />

      <div className="integrations-intro">
        <p>Connect and monitor the services this agency uses. Credentials remain encrypted and tenant-scoped.</p>
      </div>

      {feedback && !editingProvider ? (
        <div className="integrations-feedback">
          <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback>
        </div>
      ) : null}

      {!vaultConfigured ? (
        <section className="integration-vault-warning" role="alert">
          <span aria-hidden="true">!</span>
          <div>
              <strong>Secure credential storage is not ready</strong>
              <p>
                Ask your platform administrator to finish credential-vault setup before this agency connects a provider. Existing CRM data and provider settings are unaffected.
              </p>
          </div>
        </section>
      ) : null}

      {loading ? (
        <LoadingState label="Loading tenant integrations" rows={5} />
      ) : loadFailed ? (
        <ErrorState
          title="Integration settings could not be loaded"
          description="No provider state has been assumed. Retry the tenant-authorized read."
          onRetry={() => {
            setLoading(true);
            setLoadFailed(false);
            setFeedback(null);
            setReloadKey((current) => current + 1);
          }}
        />
      ) : !organizationId ? (
        <EmptyState
          title="No active agency workspace"
          description="Choose an agency workspace before configuring its integrations."
        />
      ) : (
        <>
          <nav className="integration-filter-bar" aria-label="Integration categories">
            {filters.map((choice) => (
              <button
                key={choice.key}
                type="button"
                aria-pressed={filter === choice.key}
                onClick={() => setFilter(choice.key)}
              >
                {choice.label}
              </button>
            ))}
          </nav>

          <div className="integration-category-stack">
            {categoryGroups
              .filter((category) => categoryMatchesFilter(category.key, filter))
              .map((category) => {
                const configured = category.providers.filter((provider) =>
                  integrationMap.has(provider),
                ).length;
                return (
                  <section
                    className="integration-category"
                    key={category.key}
                    id={`integration-${category.key}`}
                    aria-labelledby={`integration-${category.key}-title`}
                  >
                    <header>
                      <div>
                        <h2 id={`integration-${category.key}-title`}>{category.label}</h2>
                        <p>{category.description}</p>
                      </div>
                      <span>{configured} of {category.providers.length} configured</span>
                    </header>
                    <div className="integration-provider-list">
                      {category.providers.map((provider) => {
                        const catalog = INTEGRATION_CATALOG[provider];
                        const integration = integrationMap.get(provider);
                        const state = deriveIntegrationUiState(integration);
                        const action = integrationPrimaryAction(provider, integration);
                        return (
                          <article className="integration-provider-row" key={provider}>
                            <div className={`integration-provider-mark mark-${provider}`} aria-hidden="true">
                              {catalog.label.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="integration-provider-identity">
                              <div>
                                <h3>{catalog.label}</h3>
                                {catalog.runtimeAvailability === "configuration_only" ? (
                                  <span>Configuration only</span>
                                ) : null}
                              </div>
                              <p>{catalog.description}</p>
                              <small>{integration ? formatTestTime(integration.lastTestedAt) : catalog.capability}</small>
                            </div>
                            <span className={`integration-state state-${state}`}>
                              {INTEGRATION_UI_STATE_LABELS[state]}
                            </span>
                            <Button
                              type="button"
                              variant={state === "needs_attention" ? "primary" : "secondary"}
                              size="small"
                              disabled={Boolean(pendingProvider)}
                              onClick={() => openProvider(provider)}
                            >
                              {pendingProvider === provider ? "Working…" : action}
                            </Button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
          </div>
        </>
      )}

      {editingProvider && editingCatalog ? (
        <IntegrationDrawer
          title={editingCatalog.label}
          description={editingCatalog.description}
          onRequestClose={closeProvider}
        >
          <div className="integration-drawer-status">
            <span className={`integration-state state-${editingState}`}>
              {INTEGRATION_UI_STATE_LABELS[editingState]}
            </span>
            <span>{editingCatalog.capability}</span>
          </div>

          {feedback ? (
            <div className="integration-drawer-feedback">
              <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback>
            </div>
          ) : null}

          {editingCatalog.runtimeAvailability === "configuration_only" ? (
            <section className="integration-availability-notice" role="note">
              <strong>Configuration available</strong>
              <p>{editingCatalog.availabilityNote}</p>
            </section>
          ) : null}

          {editingIntegration?.lastTestMessage ? (
            <section className={`integration-test-result is-${editingIntegration.connectionStatus}`} aria-live="polite">
              <strong>{editingIntegration.connectionStatus === "connected" ? "Connection verified" : "Connection needs attention"}</strong>
              <p>{editingIntegration.lastTestMessage}</p>
              <small>{formatTestTime(editingIntegration.lastTestedAt)}</small>
            </section>
          ) : null}

          <form
            key={`${editingProvider}-${editingIntegration?.updatedAt ?? "new"}`}
            className="integration-editor"
            onChange={() => setDrawerDirty(true)}
            onSubmit={(event) => saveAndVerify(editingProvider, event)}
          >
            <ProviderFields provider={editingProvider} integration={editingIntegration} />
            {editingIntegration?.isEnabled && drawerDirty ? (
              <p className="integration-change-warning" role="note">
                Saving changed credentials temporarily deactivates this provider until the new connection is verified.
              </p>
            ) : null}
            <div className="integration-editor-actions">
              <Button type="submit" disabled={Boolean(pendingProvider) || !vaultConfigured}>
                {isPending ? "Saving and verifying…" : "Save and verify"}
              </Button>
              {editingIntegration ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(pendingProvider)}
                  onClick={() => verifySaved(editingProvider)}
                >
                  Test saved connection
                </Button>
              ) : null}
            </div>
          </form>

          {editingIntegration?.connectionStatus === "connected" &&
          editingCatalog.runtimeAvailability === "available" ? (
            <section className="integration-usage-panel">
              <div>
                <h3>{editingIntegration.isEnabled ? "Active for this agency" : "Connected but inactive"}</h3>
                <p>
                  {editingIntegration.isEnabled
                    ? editingCatalog.category === "email"
                      ? `Approved outbound delivery is enabled${editingIntegration.publicConfig.inboundEnabled === true ? ", and inbound email is configured for Inbox ingestion" : ""}.`
                      : "AIOS may use this provider through its existing approval and execution policies."
                    : editingCatalog.category === "email"
                      ? "Activate this verified provider to enable approved outbound delivery and its configured inbound path."
                      : "Activation makes this verified provider available to the relevant governed workflow."}
                </p>
              </div>
              <Button
                type="button"
                variant={editingIntegration.isEnabled ? "secondary" : "primary"}
                disabled={Boolean(pendingProvider)}
                onClick={() => setProviderEnabled(editingProvider, !editingIntegration.isEnabled)}
              >
                {editingIntegration.isEnabled
                  ? "Disable provider"
                  : editingCatalog.category === "email"
                    ? "Enable email delivery"
                    : "Activate provider"}
              </Button>
              {editingProvider === "openai" || editingProvider === "anthropic" ? (
                <Link href="/aios/automations">Manage AIOS routing</Link>
              ) : null}
            </section>
          ) : null}

          {editingIntegration ? (
            <details className="integration-danger-zone">
              <summary>Remove connection</summary>
              <div>
                <p>
                  This permanently removes the encrypted credentials and configuration. Type <strong>{editingCatalog.label}</strong> to confirm.
                </p>
                <input
                  value={removalConfirmation}
                  onChange={(event) => setRemovalConfirmation(event.target.value)}
                  aria-label={`Type ${editingCatalog.label} to confirm removal`}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={
                    Boolean(pendingProvider) ||
                    removalConfirmation.trim() !== editingCatalog.label
                  }
                  onClick={() => removeProvider(editingProvider)}
                >
                  Remove {editingCatalog.label}
                </Button>
              </div>
            </details>
          ) : null}
        </IntegrationDrawer>
      ) : null}
    </main>
  );
}
