"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { Button } from "../ui/button";
import { EmptyState, LoadingState } from "../ui/empty-state";
import { FormFeedback, FormField } from "../ui/form-field";
import { OperationalPageHeader } from "../ui/operational-page-header";

type TotpFactor = {
  id: string;
  friendly_name?: string;
  factor_type: "totp";
  status: "verified";
  created_at: string;
};

type Enrollment = {
  factorId: string;
  qrCodeUrl: string;
  secret: string;
};

type AccountSecurityPanelProps = {
  continueTo?: string;
  platformRequired?: boolean;
  surface?: "account" | "agency";
};

function qrCodeDataUrl(value: string) {
  return value.startsWith("data:")
    ? value
    : `data:image/svg+xml;utf-8,${encodeURIComponent(value)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

async function readSecurityState() {
  const supabase = createSupabaseBrowserClient();
  const [
    { data: factorData, error: factorError },
    { data: aalData, error: aalError },
  ] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (factorError || aalError) {
    throw factorError ?? aalError ?? new Error("MFA state is unavailable.");
  }

  return {
    factors: factorData.totp as TotpFactor[],
    assuranceLevel: aalData.currentLevel,
  };
}

export function AccountSecurityPanel({
  continueTo,
  platformRequired = false,
  surface = "agency",
}: AccountSecurityPanelProps) {
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [assuranceLevel, setAssuranceLevel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void readSecurityState()
      .then((securityState) => {
        setFactors(securityState.factors);
        setAssuranceLevel(securityState.assuranceLevel);
        setLoading(false);
      })
      .catch(() => {
        setFeedback({
          tone: "error",
          message: "AIOS could not load multi-factor security settings.",
        });
        setLoading(false);
      });
  }, []);

  async function refreshSecurityState() {
    const securityState = await readSecurityState();
    setFactors(securityState.factors);
    setAssuranceLevel(securityState.assuranceLevel);
    setLoading(false);
  }

  const protectionLabel = useMemo(() => {
    if (!factors.length) {
      return platformRequired ? "Setup required" : "Password protected";
    }
    return assuranceLevel === "aal2" ? "MFA verified" : "MFA challenge required";
  }, [assuranceLevel, factors.length, platformRequired]);

  const challengePath = continueTo
    ? `/auth/mfa?next=${encodeURIComponent(continueTo)}`
    : "/auth/mfa";

  async function beginEnrollment() {
    if (pending || enrollment) return;
    setPending(true);
    setFeedback(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: existing, error: listError } =
        await supabase.auth.mfa.listFactors();
      if (listError) throw listError;

      for (const factor of existing.all.filter(
        (candidate) =>
          candidate.factor_type === "totp" &&
          candidate.status === "unverified",
      )) {
        const { error } = await supabase.auth.mfa.unenroll({
          factorId: factor.id,
        });
        if (error) throw error;
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `AIOS authenticator ${factors.length + 1}`,
        issuer: "AIOS Travel CRM",
      });
      if (error) throw error;

      setEnrollment({
        factorId: data.id,
        qrCodeUrl: qrCodeDataUrl(data.totp.qr_code),
        secret: data.totp.secret,
      });
    } catch {
      setFeedback({
        tone: "error",
        message:
          "Authenticator setup could not start. Confirm TOTP enrollment is enabled in Supabase Auth.",
      });
    } finally {
      setPending(false);
    }
  }

  async function cancelEnrollment() {
    if (!enrollment || pending) return;
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    } finally {
      setEnrollment(null);
      setVerificationCode("");
      setPending(false);
    }
  }

  async function verifyEnrollment() {
    if (!enrollment || pending || !/^\d{6}$/.test(verificationCode)) {
      setFeedback({
        tone: "error",
        message: "Enter the current six-digit code from your authenticator app.",
      });
      return;
    }

    setPending(true);
    setFeedback(null);
    let verificationSucceeded = false;
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollment.factorId,
        code: verificationCode,
      });
      if (error) throw error;
      verificationSucceeded = true;

      setEnrollment(null);
      setVerificationCode("");
      setFeedback({
        tone: "success",
        message:
          "Authenticator verified. This account now protects every AIOS workspace with MFA.",
      });
      if (continueTo) {
        window.location.replace(continueTo);
        return;
      }
      await refreshSecurityState();
    } catch {
      setFeedback({
        tone: "error",
        message: verificationSucceeded
          ? "Authenticator verified, but the security summary could not refresh. Reload this page to continue."
          : "That code was not accepted. Wait for a fresh code and try again.",
      });
    } finally {
      setPending(false);
    }
  }

  async function removeFactor(factor: TotpFactor) {
    if (
      pending ||
      !window.confirm(
        `Remove ${factor.friendly_name || "this authenticator"}? The account will lose this second factor.`,
      )
    ) {
      return;
    }

    setPending(true);
    setFeedback(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: factor.id,
      });
      if (error) throw error;
      await supabase.auth.refreshSession();
      setFeedback({
        tone: "success",
        message: "Authenticator removed and the session was refreshed.",
      });
      await refreshSecurityState();
    } catch {
      setFeedback({
        tone: "error",
        message:
          "That authenticator could not be removed. Re-verify MFA and try again.",
      });
    } finally {
      setPending(false);
    }
  }

  const headerActions =
    continueTo && factors.length > 0 ? (
      assuranceLevel === "aal2" ? (
        <Link className="security-continue-link" href={continueTo}>
          Continue to platform
        </Link>
      ) : (
        <Link className="security-continue-link" href={challengePath}>
          Verify and continue
        </Link>
      )
    ) : undefined;

  return (
    <>
      <OperationalPageHeader
        section={surface === "account" ? "Your account" : "Administration"}
        title="Security"
        meta={protectionLabel}
        actions={headerActions}
      />

      {platformRequired && factors.length === 0 && !loading ? (
        <section className="security-platform-requirement" role="status">
          <span aria-hidden="true">2</span>
          <div>
            <strong>Platform administration requires an authenticator</strong>
            <p>
              Enroll and verify a TOTP app here. AIOS will return you to the
              protected platform after verification.
            </p>
          </div>
        </section>
      ) : null}

      {feedback ? (
        <div className="security-feedback">
          <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback>
        </div>
      ) : null}

      {loading ? (
        <LoadingState label="Loading account security" rows={3} />
      ) : (
        <section className="security-grid">
          <article className="security-card security-factor-card">
            <p>AUTHENTICATOR APPS</p>
            <h2>Time-based one-time passwords</h2>
            <span>
              Use 1Password, Google Authenticator, Microsoft Authenticator,
              Authy, or another standards-compatible TOTP app.
            </span>

            {factors.length === 0 ? (
              <EmptyState
                compact
                title="No authenticator enrolled"
                description={
                  platformRequired
                    ? "Enrollment is required before this account can enter platform administration."
                    : "Enrollment is optional, but once enabled every new session must complete the second factor."
                }
                action={
                  <Button
                    type="button"
                    disabled={pending || Boolean(enrollment)}
                    onClick={beginEnrollment}
                  >
                    {platformRequired ? "Set up authenticator" : "Begin setup"}
                  </Button>
                }
              />
            ) : (
              <div className="security-factor-list">
                {factors.map((factor) => {
                  const isRequiredLastFactor =
                    platformRequired && factors.length === 1;
                  return (
                    <div key={factor.id}>
                      <span aria-hidden="true">6</span>
                      <p>
                        <strong>
                          {factor.friendly_name || "Authenticator app"}
                        </strong>
                        <small>Added {formatDate(factor.created_at)}</small>
                      </p>
                      <b>Verified</b>
                      <Button
                        type="button"
                        variant="ghost"
                        size="small"
                        disabled={pending || isRequiredLastFactor}
                        title={
                          isRequiredLastFactor
                            ? "Add a backup authenticator before removing the platform account’s last factor."
                            : undefined
                        }
                        onClick={() => removeFactor(factor)}
                      >
                        Remove
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || Boolean(enrollment)}
                  onClick={beginEnrollment}
                >
                  Add another authenticator
                </Button>
                {platformRequired && factors.length === 1 ? (
                  <small className="security-factor-guidance">
                    Platform operators cannot remove their last authenticator.
                    Add a backup first, then remove the old factor.
                  </small>
                ) : null}
              </div>
            )}
          </article>

          <article className="security-policy-card">
            <p>ENFORCEMENT</p>
            <h2>What changes after enrollment</h2>
            <ul>
              <li>New password sessions stop at an MFA challenge.</li>
              <li>Restrictive RLS policies reject tenant data at AAL1.</li>
              <li>Membership changes also check MFA inside database triggers.</li>
              <li>Removing a factor refreshes the current session immediately.</li>
            </ul>
            <small>
              Recovery codes are not provided by Supabase. Enroll a second
              authenticator as a backup before relying on MFA for production.
            </small>
          </article>
        </section>
      )}

      {enrollment ? (
        <section className="security-enrollment" aria-labelledby="mfa-setup-title">
          <div>
            <p>STEP 1</p>
            <h2 id="mfa-setup-title">Scan this private QR code</h2>
            <span>
              Do not screenshot, email, or paste this code into support chat.
            </span>
            <Image
              src={enrollment.qrCodeUrl}
              alt="Authenticator enrollment QR code"
              width={230}
              height={230}
              unoptimized
            />
            <details>
              <summary>Can&apos;t scan? Enter the setup key</summary>
              <code>{enrollment.secret}</code>
            </details>
          </div>
          <div>
            <p>STEP 2</p>
            <h2>Verify a current code</h2>
            <span>
              Enter the six digits shown by your authenticator to activate the
              factor and upgrade this session.
            </span>
            <FormField label="Six-digit verification code">
              <input
                value={verificationCode}
                onChange={(event) =>
                  setVerificationCode(
                    event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
              />
            </FormField>
            <div className="security-enrollment-actions">
              <Button type="button" disabled={pending} onClick={verifyEnrollment}>
                {pending ? "Verifying…" : "Enable authenticator"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={cancelEnrollment}
              >
                Cancel setup
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
