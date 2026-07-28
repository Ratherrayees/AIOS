"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  createQuoteDraft,
  requestQuoteShareApproval,
  reviseQuoteDraft,
} from "../actions/crm";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import "./quotes.css";

type Deal = { id: string; title: string; stage: string; currency: string };
type Quote = {
  id: string;
  deal_id: string;
  title: string;
  status:
    "draft" | "shared" | "accepted" | "rejected" | "expired" | "superseded";
  current_version: number;
  currency: string;
  valid_until: string | null;
  created_at: string;
};
type QuoteVersion = {
  id: string;
  quote_id: string;
  version: number;
  total_amount: number;
};
type QuoteCostEstimate = {
  quote_version_id: string;
  estimated_cost_amount: number;
};
type QuoteShareApproval = {
  entity_id: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  created_at: string;
};

const commercialRoles = new Set(["owner", "admin", "sales", "trip_designer"]);
const costRoles = new Set([
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "finance",
]);

function formatMoney(amount: number | undefined, currency: string) {
  if (amount === undefined) return "Pricing in progress";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatMargin(total: number | undefined, cost: number | undefined) {
  if (total === undefined || cost === undefined || total === 0) return null;
  return `${(((total - cost) / total) * 100).toFixed(1)}% gross margin`;
}

export default function QuotesPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [versions, setVersions] = useState<QuoteVersion[]>([]);
  const [costEstimates, setCostEstimates] = useState<QuoteCostEstimate[]>([]);
  const [shareApprovals, setShareApprovals] = useState<QuoteShareApproval[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setNotice("No active workspace is available for this account.");
        setLoading(false);
        return;
      }
      setOrganizationId(membership.organization_id);
      setRole(membership.role);
      const [
        { data: dealRows },
        { data: quoteRows },
        { data: versionRows },
        { data: costRows },
        { data: shareApprovalRows },
      ] = await Promise.all([
          supabase
            .from("deals")
            .select("id, title, stage, currency")
            .eq("organization_id", membership.organization_id)
            .order("updated_at", { ascending: false }),
          supabase
            .from("quotes")
            .select(
              "id, deal_id, title, status, current_version, currency, valid_until, created_at",
            )
            .eq("organization_id", membership.organization_id)
            .order("created_at", { ascending: false }),
          supabase
            .from("quote_versions")
            .select("id, quote_id, version, total_amount")
            .eq("organization_id", membership.organization_id)
            .order("version", { ascending: false }),
          supabase
            .from("quote_cost_estimates")
            .select("quote_version_id, estimated_cost_amount")
            .eq("organization_id", membership.organization_id),
          supabase
            .from("approval_requests")
            .select("entity_id, status, created_at")
            .eq("organization_id", membership.organization_id)
            .eq("action", "quote.share")
            .eq("entity_type", "quote")
            .order("created_at", { ascending: false }),
        ]);
      setDeals((dealRows || []) as Deal[]);
      setQuotes((quoteRows || []) as Quote[]);
      setVersions((versionRows || []) as QuoteVersion[]);
      setCostEstimates((costRows || []) as QuoteCostEstimate[]);
      setShareApprovals((shareApprovalRows || []) as QuoteShareApproval[]);
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load the quote workspace.");
      setLoading(false);
    });
  }, []);

  const liveDeals = useMemo(
    () => deals.filter((deal) => !["won", "lost"].includes(deal.stage)),
    [deals],
  );
  const totals = useMemo(
    () =>
      new Map(
        versions.map((version) => [version.quote_id, version.total_amount]),
      ),
    [versions],
  );
  const versionIds = useMemo(
    () => new Map(versions.map((version) => [`${version.quote_id}:${version.version}`, version.id])),
    [versions],
  );
  const costs = useMemo(
    () =>
      new Map(
        costEstimates.map((cost) => [
          cost.quote_version_id,
          cost.estimated_cost_amount,
        ]),
      ),
    [costEstimates],
  );
  const latestShareApproval = useMemo(() => {
    const approvals = new Map<string, QuoteShareApproval>();
    for (const approval of shareApprovals) {
      if (approval.entity_id && !approvals.has(approval.entity_id))
        approvals.set(approval.entity_id, approval);
    }
    return approvals;
  }, [shareApprovals]);
  const dealTitles = useMemo(
    () => new Map(deals.map((deal) => [deal.id, deal.title])),
    [deals],
  );
  const canCreate = role ? commercialRoles.has(role) : false;
  const canViewCosts = role ? costRoles.has(role) : false;

  function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const dealId = String(form.get("dealId") || "");
    const title = String(form.get("title") || "").trim();
    const totalAmount = Number(form.get("totalAmount") || 0);
    const currency = String(form.get("currency") || "INR");
    const validUntil = String(form.get("validUntil") || "") || null;
    if (!dealId || !title || !Number.isFinite(totalAmount)) return;
    startTransition(async () => {
      try {
        const quote = await createQuoteDraft({
          organizationId,
          dealId,
          title,
          currency,
          validUntil,
          totalAmount,
        });
        setQuotes((current) => [quote as Quote, ...current]);
        setVersions((current) => [
          {
            id: `new:${quote.id}:${quote.current_version}`,
            quote_id: quote.id,
            version: quote.current_version,
            total_amount: totalAmount,
          },
          ...current,
        ]);
        formElement.reset();
        setNotice(
          "Quote draft created. It remains internal until a human approves sharing.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create that quote draft.",
        );
      }
    });
  }

  function reviseDraft(quote: Quote, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = new FormData(event.currentTarget);
    const totalAmount = Number(form.get("totalAmount") || 0);
    const estimatedCostAmount = Number(form.get("estimatedCostAmount") || 0);
    if (!Number.isFinite(totalAmount) || !Number.isFinite(estimatedCostAmount))
      return;
    startTransition(async () => {
      try {
        const updated = await reviseQuoteDraft({
          organizationId,
          quoteId: quote.id,
          totalAmount,
          estimatedCostAmount,
        });
        setQuotes((current) =>
          current.map((item) =>
            item.id === quote.id ? (updated.quote as Quote) : item,
          ),
        );
        setVersions((current) => [
          {
            id: `new:${quote.id}:${updated.version}`,
            quote_id: quote.id,
            version: updated.version,
            total_amount: totalAmount,
          },
          ...current,
        ]);
        setCostEstimates((current) => [
          {
            quote_version_id: `new:${quote.id}:${updated.version}`,
            estimated_cost_amount: estimatedCostAmount,
          },
          ...current,
        ]);
        setNotice(
          `Created internal version ${updated.version}. The original draft remains preserved.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create that quote revision.",
        );
      }
    });
  }

  function requestSharingReview(quote: Quote) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const approval = await requestQuoteShareApproval({
          organizationId,
          quoteId: quote.id,
        });
        setShareApprovals((current) => [
          {
            entity_id: quote.id,
            status: "pending",
            created_at: new Date().toISOString(),
          },
          ...current.filter((item) => item.entity_id !== quote.id),
        ]);
        setNotice(
          approval.alreadyPending
            ? "A human sharing review is already pending. No quote was sent."
            : "Human sharing review requested. No quote was sent.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not request the human sharing review.",
        );
      }
    });
  }

  return (
    <main className="quotes-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/", label: "Command center" },
          { href: "/itineraries", label: "Itinerary Studio" },
          { href: "/aios", label: "AIOS Control" },
        ]}
      />
      <section className="quotes-hero">
        <div>
          <p>COMMERCIAL WORKSPACE</p>
          <h1>Shape a confident proposal before it ever leaves your team.</h1>
          <span>
            Every draft is versioned, tenant-scoped, and held internally. AIOS
            can assist with preparation later; sharing and price changes always
            require human authority.
          </span>
        </div>
        <aside>
          <b>{quotes.length}</b>
          <small>quote drafts</small>
          <b>{quotes.filter((quote) => quote.status === "draft").length}</b>
          <small>awaiting review</small>
        </aside>
      </section>
      {notice && (
        <p className="quotes-notice" role="status">
          {notice}
        </p>
      )}
      <section className="quote-safety">
        <span>LOCKED</span>
        <p>
          <b>External quote delivery is disabled.</b> This workspace creates
          internal drafts only. Quote sharing stays behind the AIOS approval
          catalog.
        </p>
      </section>
      {canCreate ? (
        <section className="quotes-create">
          <form onSubmit={createDraft}>
            <label>
              Opportunity
              <select name="dealId" required defaultValue="">
                <option value="" disabled>
                  Select an active opportunity
                </option>
                {liveDeals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quote title
              <input
                name="title"
                required
                maxLength={180}
                placeholder="Family discovery itinerary"
              />
            </label>
            <label>
              Currency
              <select name="currency" defaultValue="INR">
                <option>INR</option>
                <option>USD</option>
                <option>EUR</option>
                <option>AED</option>
              </select>
            </label>
            <label>
              Quoted total
              <input
                name="totalAmount"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
                required
              />
            </label>
            <label>
              Valid until
              <input name="validUntil" type="date" />
            </label>
            <button
              type="submit"
              disabled={pending || !organizationId || liveDeals.length === 0}
            >
              {pending ? "Creating…" : "Create internal draft"}
            </button>
          </form>
        </section>
      ) : role ? (
        <p className="quotes-permission">
          Your {role.replace("_", " ")} role can view quote drafts but cannot
          create or edit pricing.
        </p>
      ) : null}
      <section className="quotes-list" aria-label="Quote drafts">
        <header>
          <div>
            <p>VERSIONED PROPOSALS</p>
            <h2>Commercial drafts</h2>
          </div>
          <span>{quotes.length} total</span>
        </header>
        {loading ? (
          <div className="quotes-empty">
            <LoadingState label="Loading quote workspace" rows={3} />
          </div>
        ) : quotes.length === 0 ? (
          <div className="quotes-empty">
            <EmptyState
              title="No internal quotes yet"
              description="Start with a live opportunity and create a draft for review."
            />
          </div>
        ) : (
          quotes.map((quote) => (
            <article key={quote.id}>
              <div>
                <span className="quote-status">{quote.status}</span>
                {latestShareApproval.get(quote.id)?.status === "pending" && (
                  <span className="quote-review-state">Sharing review pending</span>
                )}
                {latestShareApproval.get(quote.id)?.status === "approved" && (
                  <span className="quote-review-state quote-review-approved">
                    Approved · delivery unavailable
                  </span>
                )}
                <h3>{quote.title}</h3>
                <p>
                  {dealTitles.get(quote.deal_id) || "Opportunity"} · Version{" "}
                  {quote.current_version}
                </p>
              </div>
              <div className="quote-amount">
                <b>{formatMoney(totals.get(quote.id), quote.currency)}</b>
                {canViewCosts && (
                  <small className="quote-profitability">
                    {(() => {
                      const total = totals.get(quote.id);
                      const cost = costs.get(
                        versionIds.get(`${quote.id}:${quote.current_version}`) || "",
                      );
                      if (cost === undefined) return "Internal cost not captured";
                      const margin = formatMargin(total, cost);
                      return margin
                        ? `${formatMoney(cost, quote.currency)} estimated cost · ${margin}`
                        : `${formatMoney(cost, quote.currency)} estimated cost`;
                    })()}
                  </small>
                )}
                <small>
                  {quote.valid_until
                    ? `Valid through ${new Date(`${quote.valid_until}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                    : "No expiry date"}
                </small>
                {canCreate && quote.status === "draft" && (
                  <form
                    className="quote-revise"
                    onSubmit={(event) => reviseDraft(quote, event)}
                  >
                    <label>
                      Revise total
                      <input
                        name="totalAmount"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={totals.get(quote.id) ?? 0}
                        required
                      />
                    </label>
                    <label>
                      Internal estimated cost
                      <input
                        name="estimatedCostAmount"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={
                          costs.get(
                            versionIds.get(`${quote.id}:${quote.current_version}`) || "",
                          ) ?? 0
                        }
                        required
                      />
                    </label>
                    <button type="submit" disabled={pending}>
                      {pending ? "Saving…" : "New version"}
                    </button>
                  </form>
                )}
                {role &&
                  quote.status === "draft" &&
                  !["pending", "approved"].includes(
                    latestShareApproval.get(quote.id)?.status || "",
                  ) && (
                  <button
                    type="button"
                    className="quote-share-review"
                    onClick={() => requestSharingReview(quote)}
                    disabled={pending}
                  >
                    {pending ? "Requesting…" : "Request human sharing review"}
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
