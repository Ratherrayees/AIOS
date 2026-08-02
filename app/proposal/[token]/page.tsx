import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  quoteShareSnapshotSchema,
  quoteShareTokenSchema,
} from "../../../lib/crm/quote-share";
import { quoteShareTokenHash } from "../../../lib/crm/quote-share-token";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { PrintProposalButton } from "./print-proposal-button";
import { QuoteAcceptanceForm } from "./quote-acceptance-form";
import "./proposal.css";
import "./payment-schedule.css";
import "./acceptance.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your travel proposal",
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

function readableDate(value: string, includeTime = false) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "long",
    timeStyle: includeTime ? "short" : undefined,
  }).format(new Date(value));
}

export default async function PublicQuoteProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!quoteShareTokenSchema.safeParse(token).success) notFound();

  const snapshot = await (async () => {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc("get_quote_share_snapshot", {
        target_token_hash: quoteShareTokenHash(token),
      });
      if (error || !data) return null;
      const parsed = quoteShareSnapshotSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  })();
  if (!snapshot) notFound();

  const proposal = snapshot.quote;
  return (
    <main className="public-proposal-page" id="main-content" tabIndex={-1}>
      <nav className="public-proposal-nav" aria-label="Proposal controls">
        <span>
          <b>AIOS</b> TRAVEL
        </span>
        <small>Private, expiring proposal</small>
        <PrintProposalButton />
      </nav>

      <article className="public-proposal-sheet">
        <header className="public-proposal-heading">
          <div>
            <span>CURATED TRAVEL PROPOSAL</span>
            <h1>{proposal.title}</h1>
            <p>
              Prepared for {snapshot.customer.name}
              {snapshot.customer.destination
                ? ` · ${snapshot.customer.destination}`
                : ""}
            </p>
          </div>
          <aside>
            <b>{snapshot.organization.name}</b>
            <span>Proposal version {proposal.version}</span>
          </aside>
        </header>

        <section className="public-proposal-summary" aria-label="Proposal summary">
          <div>
            <span>Journey investment</span>
            <strong>{money(proposal.total_amount, proposal.currency)}</strong>
          </div>
          <div>
            <span>Currency</span>
            <strong>{proposal.currency}</strong>
          </div>
          <div>
            <span>Valid until</span>
            <strong>
              {proposal.valid_until
                ? readableDate(`${proposal.valid_until}T00:00:00.000Z`)
                : "To be confirmed"}
            </strong>
          </div>
        </section>

        {proposal.line_items.length > 0 ? (
          <section className="public-proposal-lines" aria-labelledby="proposal-lines-title">
            <header>
              <span>01</span>
              <h2 id="proposal-lines-title">Your journey investment</h2>
            </header>
            <div className="public-proposal-table" role="table" aria-label="Proposal line items">
              <div className="public-proposal-table-head" role="row">
                <span role="columnheader">Experience</span>
                <span role="columnheader">Qty</span>
                <span role="columnheader">Amount</span>
              </div>
              {proposal.line_items.map((line) => (
                <div role="row" key={`${line.position}-${line.description}`}>
                  <span role="cell">
                    <b>{line.description}</b>
                    <small>{line.category.replace("_", " ")}</small>
                  </span>
                  <span role="cell">{line.quantity}</span>
                  <span role="cell">
                    <b>{money(line.total_amount, proposal.currency)}</b>
                    {line.discount_amount > 0 && (
                      <small>
                        Includes {money(line.discount_amount, proposal.currency)} discount
                      </small>
                    )}
                    {line.tax_amount > 0 && (
                      <small>{line.tax_percent}% tax included</small>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <footer>
              <span>Total including applicable tax</span>
              <strong>{money(proposal.total_amount, proposal.currency)}</strong>
            </footer>
          </section>
        ) : (
          <section className="public-proposal-total-only">
            <span>Proposal investment</span>
            <strong>{money(proposal.total_amount, proposal.currency)}</strong>
          </section>
        )}

        {proposal.payment_schedule.length > 0 && (
          <section
            className="public-proposal-payments"
            aria-labelledby="proposal-payments-title"
          >
            <header>
              <span>02</span>
              <div>
                <h2 id="proposal-payments-title">Payment schedule</h2>
                <p>
                  Milestones for this proposal version. Your advisor will
                  confirm invoice and payment instructions separately.
                </p>
              </div>
            </header>
            <ol>
              {proposal.payment_schedule.map((item) => (
                <li key={`${item.kind}-${item.label}-${item.due_date}`}>
                  <span aria-hidden="true" />
                  <div>
                    <b>{item.label}</b>
                    <small>{item.kind}</small>
                  </div>
                  <time dateTime={item.due_date}>
                    {readableDate(`${item.due_date}T00:00:00.000Z`)}
                  </time>
                  <strong>{money(item.amount, proposal.currency)}</strong>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="public-proposal-content" aria-label="Proposal scope and terms">
          {[
            [
              proposal.payment_schedule.length ? "03" : "02",
              "What is included",
              proposal.content.inclusions,
            ],
            [
              proposal.payment_schedule.length ? "04" : "03",
              "What is not included",
              proposal.content.exclusions,
            ],
            [
              proposal.payment_schedule.length ? "05" : "04",
              "Terms",
              proposal.content.terms,
            ],
          ].map(([number, title, items]) => (
            <section key={title as string}>
              <header>
                <span>{number}</span>
                <h2>{title}</h2>
              </header>
              {(items as string[]).length > 0 ? (
                <ul>
                  {(items as string[]).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>Nothing has been listed in this section.</p>
              )}
            </section>
          ))}
        </section>

        <section className="proposal-acceptance" aria-label="Proposal acceptance">
          {snapshot.acceptance.status === "accepted" ? (
            <div className="proposal-acceptance-confirmed" role="status">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>Proposal accepted</strong>
                <p>
                  Acceptance of exact proposal version {proposal.version} was
                  recorded {readableDate(snapshot.acceptance.accepted_at, true)}.
                  Your travel advisor can now prepare the next steps.
                </p>
              </div>
            </div>
          ) : (
            <QuoteAcceptanceForm
              token={token}
              organizationName={snapshot.organization.name}
              proposalVersion={proposal.version}
            />
          )}
        </section>

        <footer className="public-proposal-footer">
          <div>
            <span>PREPARED BY</span>
            <strong>{snapshot.organization.name}</strong>
          </div>
          <p>
            This private snapshot was published {readableDate(snapshot.published_at, true)}.
            Access automatically closes {readableDate(snapshot.expires_at, true)}.
            Contact your travel advisor before relying on availability or booking status.
          </p>
        </footer>
      </article>
    </main>
  );
}
