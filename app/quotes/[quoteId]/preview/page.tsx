import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  isQuoteProposalContentReady,
  parseQuoteProposalContent,
} from "../../../../lib/crm/quote-proposal";
import { parseQuotePaymentScheduleItems } from "../../../../lib/crm/quote-payment-schedule";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { PrintQuoteButton } from "./print-quote-button";
import "./preview.css";
import "./payment-schedule.css";

export const metadata: Metadata = {
  title: "Internal customer quote preview | AIOS Travel CRM",
  robots: { index: false, follow: false },
};

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default async function QuoteCustomerPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<{ organization?: string }>;
}) {
  const [{ quoteId }, query] = await Promise.all([params, searchParams]);
  const organizationId = query.organization;
  if (!organizationId) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    const nextPath = `/quotes/${encodeURIComponent(quoteId)}/preview?organization=${encodeURIComponent(organizationId)}`;
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, organization_id, deal_id, title, status, current_version, currency, valid_until",
    )
    .eq("organization_id", organizationId)
    .eq("id", quoteId)
    .maybeSingle();
  if (quoteError || !quote) notFound();

  const [organizationResult, versionResult, dealResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("quote_versions")
      .select("id, version, total_amount, terms_snapshot, created_at")
      .eq("organization_id", organizationId)
      .eq("quote_id", quote.id)
      .eq("version", quote.current_version)
      .maybeSingle(),
    supabase
      .from("deals")
      .select("title, contact_id, destination")
      .eq("organization_id", organizationId)
      .eq("id", quote.deal_id)
      .maybeSingle(),
  ]);
  if (organizationResult.error) throw organizationResult.error;
  if (versionResult.error || !versionResult.data) notFound();
  if (dealResult.error) throw dealResult.error;
  const version = versionResult.data;

  const [lineResult, contactResult, scheduleResult] = await Promise.all([
    supabase
      .from("quote_line_items")
      .select(
        "id, position, category, description, quantity, discount_amount, tax_percent, tax_amount, total_amount",
      )
      .eq("organization_id", organizationId)
      .eq("quote_version_id", version.id)
      .order("position"),
    dealResult.data?.contact_id
      ? supabase
          .from("contacts")
          .select("first_name, last_name")
          .eq("organization_id", organizationId)
          .eq("id", dealResult.data.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("quote_payment_schedules")
      .select("items")
      .eq("organization_id", organizationId)
      .eq("quote_id", quote.id)
      .eq("quote_version_id", version.id)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (lineResult.error) throw lineResult.error;
  if (contactResult.error) throw contactResult.error;
  if (scheduleResult.error) throw scheduleResult.error;

  const content = parseQuoteProposalContent(version.terms_snapshot);
  const contentReady = isQuoteProposalContentReady(version.terms_snapshot);
  const paymentSchedule = parseQuotePaymentScheduleItems(
    scheduleResult.data?.items,
  );
  const travelerName = contactResult.data
    ? [contactResult.data.first_name, contactResult.data.last_name]
        .filter(Boolean)
        .join(" ")
    : "Traveler";
  const organizationName =
    organizationResult.data?.name || "Your travel planning team";

  return (
    <main className="customer-quote-preview" id="main-content" tabIndex={-1}>
      <header className="customer-quote-toolbar">
        <div>
          <strong>INTERNAL CUSTOMER PREVIEW</strong>
          <span>
            Exact version {version.version} · not published or delivered
          </span>
        </div>
        <nav aria-label="Preview controls">
          <Link href="/quotes">Back to quotes</Link>
          <PrintQuoteButton />
        </nav>
      </header>

      <article className="customer-quote-sheet">
        <header className="customer-quote-heading">
          <div>
            <span>TRAVEL PROPOSAL</span>
            <h1>{quote.title}</h1>
            <p>
              Prepared for {travelerName}
              {dealResult.data?.destination
                ? ` · ${dealResult.data.destination}`
                : ""}
            </p>
          </div>
          <aside>
            <b>{organizationName}</b>
            <span>Proposal {quote.id.slice(0, 8).toUpperCase()}</span>
            <span>Version {version.version}</span>
          </aside>
        </header>

        <section className="customer-quote-summary" aria-label="Quote summary">
          <div>
            <span>Investment</span>
            <strong>{money(Number(version.total_amount), quote.currency)}</strong>
          </div>
          <div>
            <span>Currency</span>
            <strong>{quote.currency}</strong>
          </div>
          <div>
            <span>Valid until</span>
            <strong>
              {quote.valid_until
                ? new Date(`${quote.valid_until}T00:00:00`).toLocaleDateString(
                    "en-IN",
                    { day: "numeric", month: "long", year: "numeric" },
                  )
                : "To be confirmed"}
            </strong>
          </div>
        </section>

        {(lineResult.data ?? []).length > 0 ? (
          <section className="customer-quote-lines" aria-labelledby="quote-lines-title">
            <div className="customer-quote-section-title">
              <span>01</span>
              <h2 id="quote-lines-title">Your journey investment</h2>
            </div>
            <div className="customer-quote-table" role="table" aria-label="Customer quote line items">
              <div role="row" className="customer-quote-table-head">
                <span role="columnheader">Experience</span>
                <span role="columnheader">Qty</span>
                <span role="columnheader">Amount</span>
              </div>
              {(lineResult.data ?? []).map((line) => (
                <div role="row" key={line.id}>
                  <span role="cell">
                    <b>{line.description}</b>
                    <small>{line.category.replace("_", " ")}</small>
                  </span>
                  <span role="cell">{Number(line.quantity)}</span>
                  <span role="cell">
                    <b>{money(Number(line.total_amount), quote.currency)}</b>
                    {Number(line.discount_amount) > 0 && (
                      <small>
                        Includes {money(Number(line.discount_amount), quote.currency)} discount
                      </small>
                    )}
                    {Number(line.tax_amount) > 0 && (
                      <small>{Number(line.tax_percent)}% tax included</small>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <footer>
              <span>Total including applicable tax</span>
              <strong>{money(Number(version.total_amount), quote.currency)}</strong>
            </footer>
          </section>
        ) : (
          <section className="customer-quote-total-only">
            <span>Proposal investment</span>
            <strong>{money(Number(version.total_amount), quote.currency)}</strong>
          </section>
        )}

        {paymentSchedule.length > 0 && (
          <section
            className="customer-quote-payments"
            aria-labelledby="quote-payments-title"
          >
            <div className="customer-quote-section-title">
              <span>02</span>
              <div>
                <h2 id="quote-payments-title">Payment schedule</h2>
                <p>
                  Commercial milestones only. This preview does not create an
                  invoice, receivable, payment request, or customer message.
                </p>
              </div>
            </div>
            <ol>
              {paymentSchedule.map((item) => (
                <li key={`${item.kind}-${item.label}-${item.dueDate}`}>
                  <span aria-hidden="true" />
                  <div>
                    <b>{item.label}</b>
                    <small>{item.kind}</small>
                  </div>
                  <time dateTime={item.dueDate}>
                    {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString(
                      "en-IN",
                      { day: "numeric", month: "long", year: "numeric" },
                    )}
                  </time>
                  <strong>{money(item.amount, quote.currency)}</strong>
                </li>
              ))}
            </ol>
          </section>
        )}

        {contentReady ? (
          <section className="customer-quote-content" aria-label="Proposal scope and terms">
            {[
              [
                paymentSchedule.length ? "03" : "02",
                "What is included",
                content.inclusions,
              ],
              [
                paymentSchedule.length ? "04" : "03",
                "What is not included",
                content.exclusions,
              ],
              [
                paymentSchedule.length ? "05" : "04",
                "Terms",
                content.terms,
              ],
            ].map(([number, title, items]) => (
              <section key={title as string}>
                <div className="customer-quote-section-title">
                  <span>{number}</span>
                  <h2>{title}</h2>
                </div>
                {(items as string[]).length ? (
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
        ) : (
          <section className="customer-quote-incomplete" role="status">
            This internal revision still needs customer-facing inclusions and
            terms before it can enter sharing review.
          </section>
        )}

        <footer className="customer-quote-footer">
          <div>
            <span>Prepared by</span>
            <strong>{organizationName}</strong>
          </div>
          <p>
            Internal preview only. This page is authenticated and has not been
            shared with the traveler.
          </p>
        </footer>
      </article>
    </main>
  );
}
