import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  travelerPortalSnapshotSchema,
  travelerPortalTokenSchema,
  type TravelerPortalSnapshot,
} from "../../../lib/crm/traveler-portal";
import { travelerPortalTokenHash } from "../../../lib/crm/traveler-portal-token";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import "./traveler-portal.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your journey",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function readableDate(value: string | null, includeTime = false) {
  if (!value) return "To be confirmed";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: includeTime ? "short" : undefined,
  }).format(new Date(value));
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function paymentTotals(snapshot: TravelerPortalSnapshot) {
  const totals = new Map<
    string,
    { total: number; paid: number; outstanding: number }
  >();
  for (const payment of snapshot.receivables) {
    const current = totals.get(payment.currency) ?? {
      total: 0,
      paid: 0,
      outstanding: 0,
    };
    current.total += payment.amount;
    current.paid += payment.paid_amount;
    current.outstanding += payment.outstanding_amount;
    totals.set(payment.currency, current);
  }
  return [...totals.entries()];
}

export default async function TravelerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!travelerPortalTokenSchema.safeParse(token).success) notFound();

  const snapshot = await (async () => {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc(
        "get_traveler_portal_snapshot",
        {
          target_token_hash: travelerPortalTokenHash(token),
        },
      );
      if (error || !data) return null;
      const parsed = travelerPortalSnapshotSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  })();
  if (!snapshot) notFound();

  const itineraryDays = new Map<
    number,
    TravelerPortalSnapshot["itinerary"]
  >();
  for (const item of snapshot.itinerary) {
    const items = itineraryDays.get(item.day_number) ?? [];
    items.push(item);
    itineraryDays.set(item.day_number, items);
  }
  const totals = paymentTotals(snapshot);

  return (
    <main className="traveler-portal-page">
      <nav className="traveler-portal-nav" aria-label="Traveler portal">
        <a href="#journey">
          <span>AIOS</span>
          <b>TRAVEL</b>
        </a>
        <div>
          <a href="#itinerary">Itinerary</a>
          <a href="#services">Services</a>
          <a href="#payments">Payments</a>
          <a href="#documents">Documents</a>
        </div>
        <small>Private traveler view</small>
      </nav>

      <section className="traveler-portal-hero" id="journey">
        <div>
          <p>YOUR JOURNEY / {snapshot.trip.status.replace("_", " ")}</p>
          <h1>{snapshot.trip.name}</h1>
          <span>
            {snapshot.trip.destination || "Destination being finalized"}
          </span>
        </div>
        <aside>
          <div>
            <small>DEPARTURE</small>
            <b>{readableDate(snapshot.trip.start_date)}</b>
          </div>
          <i />
          <div>
            <small>RETURN</small>
            <b>{readableDate(snapshot.trip.end_date)}</b>
          </div>
        </aside>
      </section>

      <section className="traveler-portal-trust">
        <div>
          <span>TRAVEL PARTY</span>
          <b>{snapshot.travelers.length}</b>
        </div>
        <div>
          <span>CONFIRMED SERVICES</span>
          <b>{snapshot.confirmed_services.length}</b>
        </div>
        <div>
          <span>TRAVEL FILES</span>
          <b>{snapshot.documents.length}</b>
        </div>
        <p>
          Secure snapshot prepared {readableDate(snapshot.generated_at, true)}.
          Access expires {readableDate(snapshot.portal_expires_at, true)}.
        </p>
      </section>

      <section className="traveler-portal-party">
        <header>
          <p>TRAVEL PARTY</p>
          <h2>The people on this journey</h2>
        </header>
        <div>
          {snapshot.travelers.map((traveler, index) => (
            <article key={`${traveler.first_name}-${traveler.last_name}-${index}`}>
              <span>
                {traveler.first_name.slice(0, 1)}
                {traveler.last_name?.slice(0, 1) || ""}
              </span>
              <div>
                <b>
                  {traveler.first_name} {traveler.last_name || ""}
                </b>
                <small>{traveler.role.replace("_", " ")}</small>
              </div>
            </article>
          ))}
          {snapshot.travelers.length === 0 && (
            <p className="traveler-portal-empty">
              The traveler roster is being finalized.
            </p>
          )}
        </div>
      </section>

      <section className="traveler-portal-itinerary" id="itinerary">
        <header>
          <p>JOURNEY OUTLINE</p>
          <h2>Your days at a glance</h2>
          <span>
            This view contains the approved outline only. Your travel team will
            confirm any later changes directly.
          </span>
        </header>
        <div className="traveler-day-list">
          {[...itineraryDays.entries()].map(([day, items]) => (
            <article key={day}>
              <div className="traveler-day-number">
                <small>DAY</small>
                <b>{String(day).padStart(2, "0")}</b>
              </div>
              <div>
                {items.map((item) => (
                  <section key={`${item.day_number}-${item.position}`}>
                    <span>{item.item_type.replace("_", " ")}</span>
                    <h3>{item.title}</h3>
                    <small>
                      {item.starts_at
                        ? readableDate(item.starts_at, true)
                        : "Timing to be confirmed"}
                    </small>
                  </section>
                ))}
              </div>
            </article>
          ))}
          {itineraryDays.size === 0 && (
            <p className="traveler-portal-empty">
              The detailed itinerary is still being prepared.
            </p>
          )}
        </div>
      </section>

      <section className="traveler-portal-services" id="services">
        <header>
          <p>CONFIRMED SERVICES</p>
          <h2>Ready for the journey</h2>
        </header>
        <div>
          {snapshot.confirmed_services.map((service, index) => (
            <article key={`${service.title}-${index}`}>
              <span>{service.booking_type}</span>
              <h3>{service.title}</h3>
              <p>
                {service.service_start_at
                  ? readableDate(service.service_start_at, true)
                  : "Timing to be confirmed"}
              </p>
              <small>
                Confirmation{" "}
                <b>{service.confirmation_reference || "being finalized"}</b>
              </small>
            </article>
          ))}
          {snapshot.confirmed_services.length === 0 && (
            <p className="traveler-portal-empty">
              Confirmed service details will appear in the next approved
              snapshot.
            </p>
          )}
        </div>
      </section>

      <section className="traveler-portal-payments" id="payments">
        <header>
          <p>PAYMENT STATUS</p>
          <h2>A clear view of your balance</h2>
        </header>
        {!snapshot.payment_status_included ? (
          <p className="traveler-portal-empty">
            Payment status was not included in this approved snapshot.
          </p>
        ) : totals.length === 0 ? (
          <p className="traveler-portal-empty">
            No customer payment obligations are recorded in this snapshot.
          </p>
        ) : (
          <>
            <div className="traveler-payment-totals">
              {totals.map(([currency, total]) => (
                <article key={currency}>
                  <span>{currency}</span>
                  <div>
                    <small>TOTAL</small>
                    <b>{money(total.total, currency)}</b>
                  </div>
                  <div>
                    <small>RECORDED PAID</small>
                    <b>{money(total.paid, currency)}</b>
                  </div>
                  <div>
                    <small>OUTSTANDING</small>
                    <b>{money(total.outstanding, currency)}</b>
                  </div>
                </article>
              ))}
            </div>
            <div className="traveler-payment-list">
              {snapshot.receivables.map((payment, index) => (
                <article key={`${payment.title}-${index}`}>
                  <div>
                    <b>{payment.title}</b>
                    <small>
                      {payment.due_at
                        ? `Due ${readableDate(payment.due_at)}`
                        : "No due date recorded"}
                    </small>
                  </div>
                  <span data-status={payment.status}>
                    {payment.status.replace("_", " ")}
                  </span>
                  <b>{money(payment.outstanding_amount, payment.currency)}</b>
                </article>
              ))}
            </div>
          </>
        )}
        <small className="traveler-payment-boundary">
          This page records status only. It cannot charge a card, accept a
          payment or issue a refund.
        </small>
      </section>

      <section className="traveler-portal-documents" id="documents">
        <header>
          <p>APPROVED TRAVEL FILES</p>
          <h2>Everything important, close at hand</h2>
        </header>
        <div>
          {snapshot.documents.map((document) => (
            <article key={document.id}>
              <span>{document.document_kind}</span>
              <div>
                <b>{document.file_name}</b>
                <small>
                  {document.expires_at
                    ? `File expires ${readableDate(document.expires_at)}`
                    : "No file expiry recorded"}
                </small>
              </div>
              <a
                href={`/api/portal/${token}/documents/${document.id}`}
                download
              >
                Secure download
              </a>
            </article>
          ))}
          {snapshot.documents.length === 0 && (
            <p className="traveler-portal-empty">
              No files were selected for this approved snapshot.
            </p>
          )}
        </div>
      </section>

      <footer className="traveler-portal-footer">
        <div>
          <span>AIOS TRAVEL</span>
          <b>Human care. Agentic precision.</b>
        </div>
        <p>
          This expiring view contains only the snapshot your travel team
          approved. Contact them directly if something looks out of date.
        </p>
      </footer>
    </main>
  );
}
