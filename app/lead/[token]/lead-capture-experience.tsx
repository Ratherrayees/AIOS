"use client";

import { type FormEvent, useState } from "react";

type Props = {
  formToken: string;
  formName: string;
  headline: string;
};

export function LeadCaptureExperience({
  formToken,
  formName,
  headline,
}: Props) {
  const [status, setStatus] = useState<
    "ready" | "sending" | "complete" | "error"
  >("ready");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const search = new URLSearchParams(window.location.search);
    const budgetText = String(fields.get("budgetAmount") || "").trim();
    const startedAt = Math.floor(Date.now() - performance.now());
    setStatus("sending");
    setMessage("");
    try {
      const result = await fetch(`/api/public/leads/${formToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: String(fields.get("fullName") || ""),
          email: String(fields.get("email") || ""),
          phone: String(fields.get("phone") || ""),
          destination: String(fields.get("destination") || ""),
          budgetAmount: budgetText ? Number(budgetText) : null,
          currency: String(fields.get("currency") || "INR"),
          notes: String(fields.get("notes") || ""),
          communicationConsent: fields.get("communicationConsent") === "on",
          utmSource: search.get("utm_source") || "",
          utmMedium: search.get("utm_medium") || "",
          utmCampaign: search.get("utm_campaign") || "",
          landingPath: window.location.pathname,
          referrerHost: "",
          website: String(fields.get("website") || ""),
          startedAt,
        }),
      });
      const payload = (await result.json()) as {
        received?: boolean;
        error?: string;
      };
      if (!result.ok && result.status !== 202) {
        if (payload.error === "rate_limited")
          throw new Error("Too many attempts. Please try again in 15 minutes.");
        throw new Error("We could not save your request. Please try again.");
      }
      setStatus("complete");
      setMessage(
        "Your journey request is safely with our travel team. We’ll be in touch shortly.",
      );
      form.reset();
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "We could not save your request. Please try again.",
      );
    }
  }

  return (
    <section className="capture-shell">
      <div className="capture-story">
        <div className="capture-brand">
          <span aria-hidden="true">A</span>
          <b>AIOS TRAVEL</b>
        </div>
        <p className="capture-kicker">INTELLIGENT JOURNEY DESIGN</p>
        <h1>{headline}</h1>
        <p className="capture-intro">
          Tell us where you want to go. Our team and AIOS will organize the
          details, preserve your context, and make sure a human follows up.
        </p>
        <div className="capture-assurance">
          <span>01</span>
          <p>
            <b>One secure request</b>
            No fragmented chats or repeated details.
          </p>
        </div>
        <div className="capture-assurance">
          <span>02</span>
          <p>
            <b>Human-led service</b>
            AIOS supports the team; it never invents a commitment.
          </p>
        </div>
      </div>
      <div className="capture-form-card">
        <p className="capture-form-label">{formName}</p>
        <h2>Start with the essentials.</h2>
        {status === "complete" ? (
          <div className="capture-complete" role="status">
            <span aria-hidden="true">✓</span>
            <h3>Request received</h3>
            <p>{message}</p>
            <button type="button" onClick={() => setStatus("ready")}>
              Send another request
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Your name
              <input name="fullName" maxLength={100} autoComplete="name" required />
            </label>
            <div className="capture-grid">
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  maxLength={320}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Phone
                <input
                  name="phone"
                  type="tel"
                  maxLength={40}
                  autoComplete="tel"
                  placeholder="+91 …"
                />
              </label>
            </div>
            <label>
              Dream destination
              <input
                name="destination"
                maxLength={180}
                placeholder="Kyoto, Iceland, the Maldives…"
              />
            </label>
            <div className="capture-grid budget">
              <label>
                Approximate budget
                <input name="budgetAmount" type="number" min={0} step={1000} />
              </label>
              <label>
                Currency
                <select name="currency" defaultValue="INR">
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="AED">AED</option>
                </select>
              </label>
            </div>
            <label>
              What would make this trip exceptional?
              <textarea name="notes" maxLength={2000} rows={4} />
            </label>
            <label className="capture-consent">
              <input name="communicationConsent" type="checkbox" />
              <span>
                I agree to be contacted about this journey. I can withdraw
                consent at any time.
              </span>
            </label>
            <label className="capture-honeypot" aria-hidden="true">
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            {message && status === "error" && (
              <p className="capture-error" role="alert">
                {message}
              </p>
            )}
            <button type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Securing request…" : "Design my journey"}
            </button>
            <small>
              Your information is used only to plan and respond to this travel
              request.
            </small>
          </form>
        )}
      </div>
    </section>
  );
}
