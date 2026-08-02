"use client";

import { type FormEvent, useState, useTransition } from "react";

import {
  MAX_QUOTE_SIGNATORY_NAME_LENGTH,
  QUOTE_ACCEPTANCE_STATEMENT_VERSION,
  publicQuoteAcceptanceInputSchema,
} from "../../../lib/crm/quote-acceptance";
import { acceptPublicQuote } from "./actions";

export function QuoteAcceptanceForm({
  token,
  organizationName,
  proposalVersion,
}: {
  token: string;
  organizationName: string;
  proposalVersion: number;
}) {
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const parsed = publicQuoteAcceptanceInputSchema.safeParse({
      token,
      signatoryName: fields.get("signatoryName"),
      confirmed: fields.get("confirmed") === "on",
      statementVersion: QUOTE_ACCEPTANCE_STATEMENT_VERSION,
    });

    if (!parsed.success) {
      setError("Enter your full name and confirm the acceptance statement.");
      return;
    }

    setError("");
    startTransition(async () => {
      try {
        const result = await acceptPublicQuote(parsed.data);
        setAcceptedAt(result.acceptedAt);
      } catch (acceptanceError) {
        setError(
          acceptanceError instanceof Error
            ? acceptanceError.message
            : "This proposal could not be accepted.",
        );
      }
    });
  }

  if (acceptedAt) {
    return (
      <div className="proposal-acceptance-confirmed" role="status">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>Proposal accepted</strong>
          <p>
            Your acceptance was recorded {new Date(acceptedAt).toLocaleString("en-IN", {
              dateStyle: "long",
              timeStyle: "short",
            })}. Your travel advisor can now prepare the next steps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="proposal-acceptance-form" onSubmit={submit}>
      <header>
        <span>READY TO PROCEED?</span>
        <h2>Accept this proposal</h2>
        <p>
          Record your intent for exact proposal version {proposalVersion}. This
          does not confirm inventory, issue an invoice, or collect payment.
        </p>
      </header>
      <label>
        Your full name
        <input
          name="signatoryName"
          type="text"
          minLength={2}
          maxLength={MAX_QUOTE_SIGNATORY_NAME_LENGTH}
          autoComplete="name"
          required
          disabled={pending}
        />
      </label>
      <label className="proposal-acceptance-statement">
        <input name="confirmed" type="checkbox" required disabled={pending} />
        <span>
          I confirm I am authorized to accept proposal version {proposalVersion}
          and ask {organizationName} to proceed, subject to availability and the
          stated terms. I understand this does not itself confirm bookings or
          collect payment.
        </span>
      </label>
      {error && (
        <p className="proposal-acceptance-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Recording acceptance…" : "Accept this proposal"}
      </button>
      <small>
        Acceptance records the proposal version, time, and evidence hash for your
        travel advisor. It is not represented as a digital-signature service.
      </small>
    </form>
  );
}
