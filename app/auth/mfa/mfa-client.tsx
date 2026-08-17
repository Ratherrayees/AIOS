"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState, useTransition } from "react";

import { Button } from "../../../components/ui/button";
import {
  FormFeedback,
  FormField,
} from "../../../components/ui/form-field";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";

type ChallengeFactor = {
  id: string;
  friendly_name?: string;
};

export function MfaChallenge({
  accountSecurityPath,
  nextPath,
}: {
  accountSecurityPath: string;
  nextPath: string;
}) {
  const [factors, setFactors] = useState<ChallengeFactor[]>([]);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { data, error: factorError } =
        await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;
      setFactors(data.totp);
      setFactorId(data.totp[0]?.id || "");
      setLoading(false);
    };
    void load().catch(() => {
      setError("AIOS could not load your authenticator factors.");
      setLoading(false);
    });
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || pending || !/^\d{6}$/.test(code)) {
      setError("Enter the current six-digit authenticator code.");
      return;
    }

    setError("");
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: verificationError } =
        await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code,
        });
      if (verificationError) {
        setError("That code was not accepted. Wait for a fresh code and retry.");
        return;
      }
      window.location.replace(nextPath);
    });
  }

  if (loading) {
    return <p className="mfa-loading">Loading your authenticators…</p>;
  }

  if (!factors.length) {
    return (
      <div className="mfa-no-factor">
        <FormFeedback tone="error">
          No verified authenticator is available for this account. Set one up
          before continuing to protected administration.
        </FormFeedback>
        <Link href={accountSecurityPath}>Set up an authenticator</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {error && <FormFeedback tone="error">{error}</FormFeedback>}
      {factors.length > 1 && (
        <FormField label="Authenticator">
          <select
            value={factorId}
            onChange={(event) => setFactorId(event.target.value)}
          >
            {factors.map((factor, index) => (
              <option value={factor.id} key={factor.id}>
                {factor.friendly_name || `Authenticator ${index + 1}`}
              </option>
            ))}
          </select>
        </FormField>
      )}
      <FormField label="Six-digit code">
        <input
          value={code}
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="000000"
          autoFocus
          required
        />
      </FormField>
      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Verifying…" : "Verify and continue"}
      </Button>
    </form>
  );
}
