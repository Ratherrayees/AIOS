"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  getPlatformOverview,
  savePlatformEmailIntegration,
  setPlatformEmailProviderEnabled,
  testPlatformEmailIntegration,
} from "../../actions/platform";
import { Button } from "../../../components/ui/button";
import { ErrorState, LoadingState } from "../../../components/ui/empty-state";
import { FormFeedback, FormField } from "../../../components/ui/form-field";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";
import { AUTH_EMAIL_ADDRESS } from "../../../lib/auth/signup-verification-contract";
import type { IntegrationProvider, IntegrationSummary } from "../../../lib/integrations/catalog";

const PLATFORM_EMAIL = "travel@lumierah.in";
type EmailProvider = Extract<IntegrationProvider, "resend" | "custom_smtp">;
type Overview = Awaited<ReturnType<typeof getPlatformOverview>>;

function configValue(integration: IntegrationSummary | undefined, key: string) {
  const value = integration?.publicConfig[key];
  return typeof value === "string" || typeof value === "number" ? value : "";
}

export default function PlatformEmailPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<EmailProvider | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [, startTransition] = useTransition();

  function load() {
    setLoadError(false);
    void getPlatformOverview()
      .then(setOverview)
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    void getPlatformOverview()
      .then(setOverview)
      .catch(() => setLoadError(true));
  }, []);

  function integration(provider: EmailProvider) {
    return overview?.integrations.find((item) => item.provider === provider);
  }

  function saveAndVerify(provider: EmailProvider, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingProvider) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const publicConfig =
      provider === "resend"
        ? {
            fromName: String(data.get("fromName") || "").trim(),
            fromEmail: PLATFORM_EMAIL,
            replyTo: String(data.get("replyTo") || "").trim(),
          }
        : {
            host: String(data.get("host") || "").trim(),
            port: Number(data.get("port") || 587),
            security: String(data.get("security") || "starttls"),
            username: String(data.get("username") || "").trim(),
            fromName: String(data.get("fromName") || "").trim(),
            fromEmail: PLATFORM_EMAIL,
            replyTo: String(data.get("replyTo") || "").trim(),
          };
    const secretUpdates =
      provider === "resend"
        ? { apiKey: String(data.get("apiKey") || "").trim(), webhookSecret: "" }
        : { password: String(data.get("password") || "").trim(), imapPassword: "" };
    setPendingProvider(provider);
    setFeedback(null);
    startTransition(async () => {
      try {
        await savePlatformEmailIntegration({
          provider,
          isEnabled: false,
          publicConfig,
          secretUpdates,
        });
        const tested = await testPlatformEmailIntegration({ provider });
        setFeedback({
          tone: tested.connectionStatus === "connected" ? "success" : "error",
          message: tested.lastTestMessage || "Connection test completed.",
        });
        form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
          input.value = "";
        });
        load();
      } catch (error) {
        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "Platform email could not be saved.",
        });
      } finally {
        setPendingProvider(null);
      }
    });
  }

  function setEnabled(provider: EmailProvider, enabled: boolean) {
    setPendingProvider(provider);
    setFeedback(null);
    startTransition(async () => {
      try {
        await setPlatformEmailProviderEnabled({ provider, enabled });
        setFeedback({
          tone: "success",
          message: enabled
            ? `${provider === "resend" ? "Resend" : "Custom SMTP"} is now the platform sender.`
            : "Platform email delivery is disabled.",
        });
        load();
      } catch (error) {
        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "Provider state could not be changed.",
        });
      } finally {
        setPendingProvider(null);
      }
    });
  }

  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader
        section="Platform administration"
        title="Platform email"
        meta={PLATFORM_EMAIL}
      />
      {loadError ? (
        <ErrorState
          title="Platform email settings unavailable"
          description="Platform administrator access is required."
          onRetry={load}
        />
      ) : !overview ? (
        <LoadingState label="Loading platform email" rows={4} />
      ) : (
        <div className="platform-content">
          {feedback ? <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback> : null}
          {!overview.vaultConfigured ? (
            <section className="platform-warning" role="alert">
              Secure credential storage is not ready. Add the deployment encryption key before storing platform credentials.
            </section>
          ) : null}
          {!overview.mfaVerified ? (
            <section className="platform-warning" role="alert">
              Verify multi-factor authentication before changing or testing platform email.
            </section>
          ) : null}
          <section className="platform-email-lanes" aria-labelledby="platform-email-lanes-title">
            <header>
              <div>
                <p>DELIVERY BOUNDARIES</p>
                <h2 id="platform-email-lanes-title">Two platform-owned email lanes</h2>
              </div>
              <span>Tenant senders stay separate</span>
            </header>
            <div>
              <article>
                <span className="platform-email-lane-icon" aria-hidden="true">6</span>
                <div>
                  <small>AUTHENTICATION EMAIL · DEPLOYMENT-MANAGED</small>
                  <b>{AUTH_EMAIL_ADDRESS}</b>
                  <p>Six-digit signup verification codes and identity-security mail. Configure this sender in hosted Supabase Auth SMTP, not in this credential vault.</p>
                </div>
                <em>OTP sender</em>
              </article>
              <article>
                <span className="platform-email-lane-icon" aria-hidden="true">@</span>
                <div>
                  <small>PLATFORM TRANSACTIONAL EMAIL · OPERATOR-MANAGED</small>
                  <b>{PLATFORM_EMAIL}</b>
                  <p>Platform invitations and operational notices. Configure and verify its Resend or custom SMTP provider below.</p>
                </div>
                <em>Product sender</em>
              </article>
            </div>
          </section>
          <div className="platform-email-grid">
            {(["resend", "custom_smtp"] as const).map((provider) => {
              const saved = integration(provider);
              const connected = saved?.connectionStatus === "connected";
              return (
                <section className="platform-email-card" key={provider}>
                  <header>
                    <div>
                      <h2>{provider === "resend" ? "Resend" : "Custom SMTP"}</h2>
                      <p>{provider === "resend" ? "Platform-owned transactional API." : "Platform-owned SMTP relay."}</p>
                    </div>
                    <span className={saved?.isEnabled ? "is-active" : ""}>
                      {saved?.isEnabled ? "Active" : connected ? "Verified" : "Not active"}
                    </span>
                  </header>
                  <form onSubmit={(event) => saveAndVerify(provider, event)}>
                    <FormField label="From name">
                      <input name="fromName" defaultValue={configValue(saved, "fromName") || "AIOS Travel"} required maxLength={120} />
                    </FormField>
                    <FormField label="From email">
                      <input value={PLATFORM_EMAIL} readOnly />
                    </FormField>
                    <FormField label="Reply-to email">
                      <input name="replyTo" type="email" defaultValue={configValue(saved, "replyTo") || PLATFORM_EMAIL} />
                    </FormField>
                    {provider === "resend" ? (
                      <FormField label="API key">
                        <input name="apiKey" type="password" autoComplete="new-password" required={!saved} placeholder={saved ? "Leave blank to keep saved key" : "Required"} />
                      </FormField>
                    ) : (
                      <>
                        <FormField label="SMTP host">
                          <input name="host" defaultValue={configValue(saved, "host")} required />
                        </FormField>
                        <div className="platform-inline-fields">
                          <FormField label="Port">
                            <input name="port" type="number" min={1} max={65535} defaultValue={configValue(saved, "port") || 587} required />
                          </FormField>
                          <FormField label="Security">
                            <select name="security" defaultValue={configValue(saved, "security") || "starttls"}>
                              <option value="starttls">STARTTLS</option>
                              <option value="tls">TLS</option>
                            </select>
                          </FormField>
                        </div>
                        <FormField label="Username">
                          <input name="username" defaultValue={configValue(saved, "username")} required />
                        </FormField>
                        <FormField label="Password">
                          <input name="password" type="password" autoComplete="new-password" required={!saved} placeholder={saved ? "Leave blank to keep saved password" : "Required"} />
                        </FormField>
                      </>
                    )}
                    <div className="platform-card-actions">
                      <Button type="submit" disabled={Boolean(pendingProvider) || !overview.vaultConfigured || !overview.mfaVerified}>
                        {pendingProvider === provider ? "Working…" : "Save and verify"}
                      </Button>
                      {connected ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={Boolean(pendingProvider) || !overview.mfaVerified}
                          onClick={() => setEnabled(provider, !saved?.isEnabled)}
                        >
                          {saved?.isEnabled ? "Disable" : "Use as platform sender"}
                        </Button>
                      ) : null}
                    </div>
                  </form>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
