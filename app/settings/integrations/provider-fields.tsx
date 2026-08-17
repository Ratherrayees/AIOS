"use client";

import { FormField } from "../../../components/ui/form-field";
import type {
  IntegrationProvider,
  IntegrationPublicConfig,
  IntegrationSummary,
} from "../../../lib/integrations/catalog";

function value(config: IntegrationPublicConfig | undefined, key: string) {
  const item = config?.[key];
  return typeof item === "string" || typeof item === "number" ? item : "";
}

function enabled(config: IntegrationPublicConfig | undefined, key: string) {
  return config?.[key] === true;
}

function SavedCredentialNote({ integration }: { integration?: IntegrationSummary }) {
  if (!integration) return null;
  return (
    <p className="integration-saved-credential">
      Saved securely <strong>{integration.credentialHint}</strong>. Enter a replacement only when rotating credentials.
    </p>
  );
}

function SecretInput({
  name,
  label,
  integration,
  required = true,
  placeholder,
}: {
  name: string;
  label: string;
  integration?: IntegrationSummary;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <FormField label={label}>
      <input
        name={name}
        type="password"
        autoComplete="new-password"
        placeholder={
          integration
            ? "Leave blank to keep the saved credential"
            : placeholder ?? (required ? "Required" : "Optional")
        }
        required={required && !integration}
      />
    </FormField>
  );
}

export function ProviderFields({
  provider,
  integration,
}: {
  provider: IntegrationProvider;
  integration?: IntegrationSummary;
}) {
  const config = integration?.publicConfig;

  if (provider === "resend") {
    return (
      <>
        <section className="integration-form-section" aria-labelledby="resend-sender">
          <header>
            <h3 id="resend-sender">Sender identity</h3>
            <p>The verified identity recipients will see.</p>
          </header>
          <div className="integration-field-grid">
            <FormField label="From name">
              <input name="fromName" defaultValue={value(config, "fromName") || "AIOS Travel"} required maxLength={120} />
            </FormField>
            <FormField label="From email">
              <input name="fromEmail" type="email" defaultValue={value(config, "fromEmail")} placeholder="hello@travel.example" required />
            </FormField>
            <FormField label="Reply-to email">
              <input name="replyTo" type="email" defaultValue={value(config, "replyTo")} placeholder="Optional" />
            </FormField>
          </div>
        </section>
        <section className="integration-form-section" aria-labelledby="resend-credentials">
          <header>
            <h3 id="resend-credentials">Credentials</h3>
            <p>The API key stays encrypted and write-only.</p>
          </header>
          <SavedCredentialNote integration={integration} />
          <SecretInput name="apiKey" label="API key" integration={integration} />
        </section>
        <section className="integration-form-section" aria-labelledby="resend-inbound">
          <header>
            <h3 id="resend-inbound">Inbound email</h3>
            <p>Resend receiving sends signed events into this agency&apos;s Inbox.</p>
          </header>
          <label className="integration-capability-toggle">
            <input
              name="inboundEnabled"
              type="checkbox"
              defaultChecked={enabled(config, "inboundEnabled")}
            />
            <span>
              <strong>Receive customer email</strong>
              <small>Requires a receiving domain, MX record, and signed webhook.</small>
            </span>
          </label>
          <div className="integration-field-grid">
            <FormField label="Inbound address">
              <input
                name="inboundAddress"
                type="email"
                defaultValue={value(config, "inboundAddress")}
                placeholder="inbox@reply.agency.example"
              />
            </FormField>
            <FormField label="Receiving domain">
              <input
                name="receivingDomain"
                defaultValue={value(config, "receivingDomain")}
                placeholder="reply.agency.example"
                maxLength={253}
              />
            </FormField>
            <SecretInput
              name="webhookSecret"
              label="Webhook signing secret"
              integration={integration}
              required={false}
              placeholder="Required when inbound email is enabled"
            />
            {value(config, "inboundRouteKey") ? (
              <FormField label="Agency webhook endpoint">
                <input
                  readOnly
                  value={`/api/webhooks/email/resend/${value(config, "inboundRouteKey")}`}
                  aria-describedby="resend-webhook-help"
                />
                <small id="resend-webhook-help" className="integration-field-help">
                  Prefix this path with the production app URL and subscribe it to <code>email.received</code> in this agency&apos;s Resend account.
                </small>
              </FormField>
            ) : null}
          </div>
        </section>
      </>
    );
  }

  if (provider === "custom_smtp") {
    return (
      <>
        <section className="integration-form-section" aria-labelledby="smtp-connection">
          <header>
            <h3 id="smtp-connection">SMTP connection</h3>
            <p>AIOS rejects loopback and private-network destinations.</p>
          </header>
          <div className="integration-field-grid">
            <FormField label="SMTP host">
              <input name="host" defaultValue={value(config, "host")} placeholder="smtp.example.com" required maxLength={253} />
            </FormField>
            <div className="integration-inline-fields">
              <FormField label="Port">
                <input name="port" type="number" min={1} max={65535} defaultValue={value(config, "port") || 587} required />
              </FormField>
              <FormField label="Security">
                <select name="security" defaultValue={value(config, "security") || "starttls"}>
                  <option value="starttls">STARTTLS</option>
                  <option value="tls">TLS</option>
                  <option value="none">None</option>
                </select>
              </FormField>
            </div>
            <FormField label="Username">
              <input name="username" defaultValue={value(config, "username")} autoComplete="username" required maxLength={320} />
            </FormField>
            <SavedCredentialNote integration={integration} />
            <SecretInput name="password" label="Password" integration={integration} />
          </div>
        </section>
        <section className="integration-form-section" aria-labelledby="smtp-sender">
          <header>
            <h3 id="smtp-sender">Sender identity</h3>
            <p>The identity used for governed transactional email.</p>
          </header>
          <div className="integration-field-grid">
            <FormField label="From name">
              <input name="fromName" defaultValue={value(config, "fromName") || "AIOS Travel"} required maxLength={120} />
            </FormField>
            <FormField label="From email">
              <input name="fromEmail" type="email" defaultValue={value(config, "fromEmail")} required />
            </FormField>
            <FormField label="Reply-to email">
              <input name="replyTo" type="email" defaultValue={value(config, "replyTo")} placeholder="Optional" />
            </FormField>
          </div>
        </section>
        <section className="integration-form-section" aria-labelledby="imap-inbound">
          <header>
            <h3 id="imap-inbound">Inbound mailbox (IMAP)</h3>
            <p>SMTP cannot receive mail. AIOS reads this mailbox through a bounded IMAP worker.</p>
          </header>
          <label className="integration-capability-toggle">
            <input
              name="inboundEnabled"
              type="checkbox"
              defaultChecked={enabled(config, "inboundEnabled")}
            />
            <span>
              <strong>Sync incoming customer email</strong>
              <small>Only new messages are imported; credentials stay encrypted.</small>
            </span>
          </label>
          <div className="integration-field-grid">
            <FormField label="Mailbox email address">
              <input
                name="inboundAddress"
                type="email"
                defaultValue={value(config, "inboundAddress")}
                placeholder="travel@agency.example"
              />
            </FormField>
            <FormField label="IMAP host">
              <input
                name="imapHost"
                defaultValue={value(config, "imapHost")}
                placeholder="imap.example.com"
                maxLength={253}
              />
            </FormField>
            <div className="integration-inline-fields">
              <FormField label="IMAP port">
                <input
                  name="imapPort"
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={value(config, "imapPort") || 993}
                />
              </FormField>
              <FormField label="Security">
                <select
                  name="imapSecurity"
                  defaultValue={value(config, "imapSecurity") || "tls"}
                >
                  <option value="tls">TLS</option>
                  <option value="starttls">STARTTLS</option>
                </select>
              </FormField>
            </div>
            <FormField label="IMAP username">
              <input
                name="imapUsername"
                defaultValue={value(config, "imapUsername")}
                autoComplete="username"
                maxLength={320}
              />
            </FormField>
            <SecretInput
              name="imapPassword"
              label="IMAP password"
              integration={integration}
              required={false}
              placeholder="Required when inbound sync is enabled"
            />
            <FormField label="Mailbox folder">
              <input
                name="imapMailbox"
                defaultValue={value(config, "imapMailbox") || "INBOX"}
                maxLength={255}
              />
            </FormField>
          </div>
        </section>
      </>
    );
  }

  if (provider === "stripe") {
    return (
      <>
        <section className="integration-form-section" aria-labelledby="stripe-account">
          <header>
            <h3 id="stripe-account">Stripe account</h3>
            <p>Test and live credentials cannot be mixed.</p>
          </header>
          <div className="integration-field-grid">
            <FormField label="Environment">
              <select name="environment" defaultValue={value(config, "environment") || "test"}>
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </FormField>
            <FormField label="Publishable key">
              <input name="publishableKey" defaultValue={value(config, "publishableKey")} placeholder="pk_test_…" required autoComplete="off" />
            </FormField>
            <SavedCredentialNote integration={integration} />
            <SecretInput name="secretKey" label="Secret key" integration={integration} />
          </div>
        </section>
        <details className="integration-advanced">
          <summary>Advanced webhook setup</summary>
          <div>
            <SecretInput name="webhookSecret" label="Webhook signing secret" integration={integration} required={false} placeholder="Optional until webhook deployment" />
          </div>
        </details>
      </>
    );
  }

  if (provider === "razorpay") {
    return (
      <>
        <section className="integration-form-section" aria-labelledby="razorpay-account">
          <header>
            <h3 id="razorpay-account">Razorpay account</h3>
            <p>Test and live credentials cannot be mixed.</p>
          </header>
          <div className="integration-field-grid">
            <FormField label="Environment">
              <select name="environment" defaultValue={value(config, "environment") || "test"}>
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </FormField>
            <FormField label="Key ID">
              <input name="keyId" defaultValue={value(config, "keyId")} placeholder="rzp_test_…" required autoComplete="off" />
            </FormField>
            <SavedCredentialNote integration={integration} />
            <SecretInput name="keySecret" label="Key secret" integration={integration} />
          </div>
        </section>
        <details className="integration-advanced">
          <summary>Advanced webhook setup</summary>
          <div>
            <SecretInput name="webhookSecret" label="Webhook secret" integration={integration} required={false} placeholder="Optional until webhook deployment" />
          </div>
        </details>
      </>
    );
  }

  if (provider === "whatsapp_cloud") {
    return (
      <>
        <section className="integration-form-section" aria-labelledby="whatsapp-account">
          <header>
            <h3 id="whatsapp-account">WhatsApp Business account</h3>
            <p>Use identifiers from the Meta application connected to this agency.</p>
          </header>
          <div className="integration-field-grid">
            <FormField label="Phone number ID">
              <input name="phoneNumberId" inputMode="numeric" defaultValue={value(config, "phoneNumberId")} required />
            </FormField>
            <FormField label="Business account ID">
              <input name="businessAccountId" inputMode="numeric" defaultValue={value(config, "businessAccountId")} placeholder="Optional" />
            </FormField>
            <FormField label="Graph API version">
              <input name="graphApiVersion" defaultValue={value(config, "graphApiVersion")} placeholder="vXX.X" required pattern="v\d{1,2}\.\d{1,2}" />
            </FormField>
            <FormField label="Display phone">
              <input name="displayPhone" defaultValue={value(config, "displayPhone")} placeholder="Optional label" maxLength={180} />
            </FormField>
          </div>
        </section>
        <section className="integration-form-section" aria-labelledby="whatsapp-credentials">
          <header>
            <h3 id="whatsapp-credentials">Credentials</h3>
            <p>Tokens stay encrypted and are never returned to the browser.</p>
          </header>
          <SavedCredentialNote integration={integration} />
          <div className="integration-field-grid">
            <SecretInput name="accessToken" label="Permanent access token" integration={integration} />
            <SecretInput name="verifyToken" label="Webhook verify token" integration={integration} />
          </div>
        </section>
        <details className="integration-advanced">
          <summary>Advanced webhook setup</summary>
          <div>
            <SecretInput name="appSecret" label="Meta app secret" integration={integration} required={false} placeholder="Optional until webhook deployment" />
          </div>
        </details>
      </>
    );
  }

  if (provider === "openai") {
    return (
      <>
        <section className="integration-form-section" aria-labelledby="openai-routing">
          <header>
            <h3 id="openai-routing">Model routing</h3>
            <p>Enter the exact model ID enabled for this account.</p>
          </header>
          <div className="integration-field-grid">
            <FormField label="Model ID">
              <input name="model" defaultValue={value(config, "model") || "gpt-5.6-terra"} required maxLength={120} />
            </FormField>
            <FormField label="Project ID">
              <input name="projectId" defaultValue={value(config, "projectId")} placeholder="Optional" maxLength={180} />
            </FormField>
          </div>
        </section>
        <section className="integration-form-section" aria-labelledby="openai-credentials">
          <header>
            <h3 id="openai-credentials">Credentials</h3>
            <p>The key is write-only and encrypted at rest.</p>
          </header>
          <SavedCredentialNote integration={integration} />
          <SecretInput name="apiKey" label="API key" integration={integration} />
        </section>
      </>
    );
  }

  return (
    <>
      <section className="integration-form-section" aria-labelledby="anthropic-routing">
        <header>
          <h3 id="anthropic-routing">Model routing</h3>
          <p>Enter the exact Claude model ID enabled for this account.</p>
        </header>
        <FormField label="Model ID">
          <input name="model" defaultValue={value(config, "model") || "claude-sonnet-4-6"} required maxLength={120} />
        </FormField>
      </section>
      <section className="integration-form-section" aria-labelledby="anthropic-credentials">
        <header>
          <h3 id="anthropic-credentials">Credentials</h3>
          <p>The key is write-only and encrypted at rest.</p>
        </header>
        <SavedCredentialNote integration={integration} />
        <SecretInput name="apiKey" label="API key" integration={integration} />
      </section>
    </>
  );
}
