import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  sandboxPaymentCheckoutTokenHash,
  sandboxPaymentCheckoutTokenSchema,
} from "../../../../lib/payments/sandbox-token";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import "./sandbox-payment.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Payment sandbox",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
export default async function SandboxPaymentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.PAYMENT_SANDBOX_ENABLED !== "true"
  )
    notFound();

  const { token } = await params;
  if (!sandboxPaymentCheckoutTokenSchema.safeParse(token).success) notFound();

  const admin = createSupabaseAdminClient();
  const { data: checkout, error } = await admin
    .rpc("get_sandbox_payment_checkout", {
      target_checkout_token_sha256: sandboxPaymentCheckoutTokenHash(token),
    })
    .maybeSingle();
  if (error || !checkout) notFound();

  return (
    <main className="sandbox-payment-page" id="main-content" tabIndex={-1}>
      <div className="sandbox-orbit sandbox-orbit-one" />
      <div className="sandbox-orbit sandbox-orbit-two" />
      <article className="sandbox-checkout-card">
        <header>
          <div className="sandbox-brand">
            <span className="sandbox-brand-mark">AI</span>
            <div>
              <b>AIOS PAYMENTS</b>
              <small>Provider contract laboratory</small>
            </div>
          </div>
          <span className="sandbox-mode">SANDBOX</span>
        </header>

        <section className="sandbox-hero" aria-labelledby="sandbox-title">
          <span>SIMULATION CHECKOUT</span>
          <h1 id="sandbox-title">Payment flow is wired—real money is not.</h1>
          <p>
            This isolated checkout proves the approved provider handoff contract.
            It cannot contact a bank, charge a card, or settle the CRM ledger.
          </p>
        </section>

        <section className="sandbox-amount" aria-label="Sandbox payment summary">
          <div>
            <span>AMOUNT UNDER TEST</span>
            <strong>
              {money(Number(checkout.requested_amount), checkout.currency)}
            </strong>
          </div>
          <dl>
            <div>
              <dt>Invoice</dt>
              <dd>{checkout.invoice_number}</dd>
            </div>
            <div>
              <dt>Provider reference</dt>
              <dd>{checkout.provider_reference}</dd>
            </div>
            <div>
              <dt>Link expires</dt>
              <dd>{new Date(checkout.checkout_expires_at).toLocaleString()}</dd>
            </div>
          </dl>
        </section>

        <section className="sandbox-card-shell" aria-label="Disabled test card">
          <span>TEST INSTRUMENT</span>
          <div className="sandbox-chip" />
          <strong>4242&nbsp; 4242&nbsp; 4242&nbsp; 4242</strong>
          <small>No card details are accepted or transmitted.</small>
        </section>

        <button type="button" disabled>
          Real payment disabled
        </button>
        <footer>
          <span>✓ Exact approval consumed</span>
          <span>✓ Idempotency bound</span>
          <span>✓ Zero provider calls</span>
        </footer>
      </article>
    </main>
  );
}
