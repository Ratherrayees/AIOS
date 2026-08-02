"use client";

import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  createQuoteDraft,
  publishQuoteShare,
  requestQuoteShareApproval,
  revokeQuoteShare,
  reviseQuoteDraft,
  updateQuoteApprovalPolicy,
} from "../actions/crm";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import { StructuredQuoteComposer } from "./structured-quote-composer";
import { QuoteProposalEditor } from "./quote-proposal-editor";
import { QuotePaymentScheduleEditor } from "./quote-payment-schedule-editor";
import {
  buildEffectiveQuoteCatalog,
  type QuoteCatalogProduct,
  type QuoteCatalogRate,
} from "../../lib/crm/quote-catalog";
import {
  assessQuoteGuardrails,
  DEFAULT_QUOTE_APPROVAL_POLICY,
  type QuoteApprovalPolicy,
} from "../../lib/crm/quote-guardrails";
import {
  isQuoteProposalContentReady,
  parseQuoteProposalContent,
  splitQuoteProposalLines,
} from "../../lib/crm/quote-proposal";
import {
  assessQuoteInvoiceReadiness,
  parseQuotePaymentScheduleItems,
} from "../../lib/crm/quote-payment-schedule";
import "./quotes.css";
import "./quote-policy.css";
import "./quote-payment-schedule.css";

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
  net_amount: number;
  tax_amount: number;
  margin_amount: number | null;
  margin_percent: number | null;
  terms_snapshot: unknown;
};
type QuoteLineItem = {
  id: string;
  quote_version_id: string;
  position: number;
  category: string;
  description: string;
  quantity: number;
  unit_price_amount: number;
  discount_amount: number;
  tax_percent: number;
  net_amount: number;
  tax_amount: number;
  total_amount: number;
  catalog_product_id: string | null;
  catalog_rate_id: string | null;
  supplier_id: string | null;
};
type QuoteCostEstimate = {
  quote_version_id: string;
  estimated_cost_amount: number;
};
type QuoteShareApproval = {
  id: string;
  entity_id: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  created_at: string;
  payload: { quote_version?: number } | null;
};
type QuoteShareLink = {
  id: string;
  quote_id: string;
  quote_version_id: string;
  approval_request_id: string;
  status: "active" | "revoked" | "expired";
  effective_status: "active" | "revoked" | "expired";
  published_at: string;
  expires_at: string;
  revoked_at: string | null;
};
type QuoteApprovalPolicyRow = {
  minimum_margin_percent: number;
  require_cost_estimate: boolean;
  require_valid_until: boolean;
  maximum_validity_days: number;
  maximum_discount_percent: number;
  enforce_standard_terms: boolean;
  standard_terms: unknown;
};
type QuotePaymentScheduleRow = {
  id: string;
  quote_id: string;
  quote_version_id: string;
  revision: number;
  status: "active" | "superseded";
  currency: string;
  total_amount: number;
  items: unknown;
  item_count: number;
  content_sha256: string;
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

function formatMargin(
  version: QuoteVersion | undefined,
  cost: number | undefined,
) {
  if (!version || cost === undefined) return null;
  if (version.margin_percent !== null) {
    return `${version.margin_percent.toFixed(1)}% gross margin`;
  }
  const net = version.net_amount ?? version.total_amount;
  if (!net) return null;
  return `${(((net - cost) / net) * 100).toFixed(1)}% gross margin`;
}

export default function QuotesPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [versions, setVersions] = useState<QuoteVersion[]>([]);
  const [costEstimates, setCostEstimates] = useState<QuoteCostEstimate[]>([]);
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<QuoteCatalogProduct[]>([]);
  const [catalogRates, setCatalogRates] = useState<QuoteCatalogRate[]>([]);
  const [shareApprovals, setShareApprovals] = useState<QuoteShareApproval[]>([]);
  const [shareLinks, setShareLinks] = useState<QuoteShareLink[]>([]);
  const [paymentSchedules, setPaymentSchedules] = useState<
    QuotePaymentScheduleRow[]
  >([]);
  const [publishedPaths, setPublishedPaths] = useState<Record<string, string>>({});
  const [approvalPolicy, setApprovalPolicy] = useState<QuoteApprovalPolicy>(
    DEFAULT_QUOTE_APPROVAL_POLICY,
  );
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
        { data: shareLinkRows },
        { data: approvalPolicyRow },
        { data: lineItemRows },
        { data: catalogProductRows },
        { data: catalogRateRows },
        { data: paymentScheduleRows },
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
            .select(
              "id, quote_id, version, total_amount, net_amount, tax_amount, margin_amount, margin_percent, terms_snapshot",
            )
            .eq("organization_id", membership.organization_id)
            .order("version", { ascending: false }),
          supabase
            .from("quote_cost_estimates")
            .select("quote_version_id, estimated_cost_amount")
            .eq("organization_id", membership.organization_id),
          supabase
            .from("approval_requests")
            .select("id, entity_id, status, created_at, payload")
            .eq("organization_id", membership.organization_id)
            .eq("action", "quote.share")
            .eq("entity_type", "quote")
            .order("created_at", { ascending: false }),
          supabase.rpc("list_quote_share_links", {
            target_organization_id: membership.organization_id,
          }),
          supabase
            .from("quote_approval_policies")
            .select(
              "minimum_margin_percent, require_cost_estimate, require_valid_until, maximum_validity_days, maximum_discount_percent, enforce_standard_terms, standard_terms",
            )
            .eq("organization_id", membership.organization_id)
            .maybeSingle(),
          supabase
            .from("quote_line_items")
            .select(
              "id, quote_version_id, position, category, description, quantity, unit_price_amount, discount_amount, tax_percent, net_amount, tax_amount, total_amount, catalog_product_id, catalog_rate_id, supplier_id",
            )
            .eq("organization_id", membership.organization_id)
            .order("position"),
          supabase
            .from("quote_catalog_products")
            .select(
              "id, supplier_id, category, name, description, unit_label, currency, status",
            )
            .eq("organization_id", membership.organization_id),
          supabase
            .from("quote_catalog_rates")
            .select(
              "id, product_id, version, unit_sell_amount, unit_cost_amount, tax_percent, valid_from, valid_until",
            )
            .eq("organization_id", membership.organization_id),
          supabase
            .from("quote_payment_schedules")
            .select(
              "id, quote_id, quote_version_id, revision, status, currency, total_amount, items, item_count, content_sha256",
            )
            .eq("organization_id", membership.organization_id)
            .order("revision", { ascending: false }),
        ]);
      setDeals((dealRows || []) as Deal[]);
      setQuotes((quoteRows || []) as Quote[]);
      setVersions((versionRows || []) as QuoteVersion[]);
      setCostEstimates((costRows || []) as QuoteCostEstimate[]);
      setShareApprovals(
        (shareApprovalRows || []) as unknown as QuoteShareApproval[],
      );
      setShareLinks((shareLinkRows || []) as QuoteShareLink[]);
      setLineItems((lineItemRows || []) as QuoteLineItem[]);
      setCatalogProducts(
        (catalogProductRows || []) as QuoteCatalogProduct[],
      );
      setCatalogRates((catalogRateRows || []) as QuoteCatalogRate[]);
      setPaymentSchedules(
        (paymentScheduleRows || []) as QuotePaymentScheduleRow[],
      );
      if (approvalPolicyRow) {
        const row = approvalPolicyRow as QuoteApprovalPolicyRow;
        setApprovalPolicy({
          minimumMarginPercent: Number(row.minimum_margin_percent),
          requireCostEstimate: row.require_cost_estimate,
          requireValidUntil: row.require_valid_until,
          maximumValidityDays: row.maximum_validity_days,
          maximumDiscountPercent: Number(row.maximum_discount_percent),
          enforceStandardTerms: row.enforce_standard_terms,
          standardTerms: Array.isArray(row.standard_terms)
            ? row.standard_terms.filter(
                (term): term is string => typeof term === "string",
              )
            : [],
        });
      }
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
  const versionAmounts = useMemo(
    () =>
      new Map(
        versions.map((version) => [
          `${version.quote_id}:${version.version}`,
          version.total_amount,
        ]),
      ),
    [versions],
  );
  const versionIds = useMemo(
    () => new Map(versions.map((version) => [`${version.quote_id}:${version.version}`, version.id])),
    [versions],
  );
  const versionsByKey = useMemo(
    () =>
      new Map(
        versions.map((version) => [
          `${version.quote_id}:${version.version}`,
          version,
        ]),
      ),
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
  const linesByVersion = useMemo(() => {
    const grouped = new Map<string, QuoteLineItem[]>();
    for (const line of lineItems) {
      const current = grouped.get(line.quote_version_id) ?? [];
      current.push(line);
      grouped.set(line.quote_version_id, current);
    }
    return grouped;
  }, [lineItems]);
  const effectiveCatalog = useMemo(
    () => buildEffectiveQuoteCatalog(catalogProducts, catalogRates),
    [catalogProducts, catalogRates],
  );
  const latestShareApproval = useMemo(() => {
    const approvals = new Map<string, QuoteShareApproval>();
    const currentVersions = new Map(
      quotes.map((quote) => [quote.id, quote.current_version]),
    );
    for (const approval of shareApprovals) {
      if (
        approval.entity_id &&
        approval.payload?.quote_version ===
          currentVersions.get(approval.entity_id) &&
        !approvals.has(approval.entity_id)
      )
        approvals.set(approval.entity_id, approval);
    }
    return approvals;
  }, [quotes, shareApprovals]);
  const latestShareLink = useMemo(() => {
    const links = new Map<string, QuoteShareLink>();
    for (const link of shareLinks) {
      if (!links.has(link.quote_id)) links.set(link.quote_id, link);
    }
    return links;
  }, [shareLinks]);
  const activePaymentSchedules = useMemo(() => {
    const schedules = new Map<string, QuotePaymentScheduleRow>();
    for (const schedule of paymentSchedules) {
      if (schedule.status === "active" && !schedules.has(schedule.quote_id))
        schedules.set(schedule.quote_id, schedule);
    }
    return schedules;
  }, [paymentSchedules]);
  const consumedShareApprovals = useMemo(
    () => new Set(shareLinks.map((link) => link.approval_request_id)),
    [shareLinks],
  );
  const dealTitles = useMemo(
    () => new Map(deals.map((deal) => [deal.id, deal.title])),
    [deals],
  );
  const canCreate = role ? commercialRoles.has(role) : false;
  const canViewCosts = role ? costRoles.has(role) : false;
  const canManagePolicy = role === "owner" || role === "admin";
  const guardrailsByQuote = useMemo(() => {
    if (!canViewCosts) return new Map();
    return new Map<string, ReturnType<typeof assessQuoteGuardrails>>(
      quotes.map((quote) => {
        const key = `${quote.id}:${quote.current_version}`;
        const currentVersion = versionsByKey.get(key);
        const versionId = currentVersion?.id;
        const currentLines = versionId
          ? (linesByVersion.get(versionId) ?? [])
          : [];
        const proposalContent = parseQuoteProposalContent(
          currentVersion?.terms_snapshot,
        );
        return [
          quote.id,
          assessQuoteGuardrails(
            {
              status: quote.status,
              totalAmount: currentVersion?.total_amount ?? null,
              netAmount: currentVersion?.net_amount ?? null,
              estimatedCostAmount: versionId
                ? (costs.get(versionId) ?? null)
                : null,
              validUntil: quote.valid_until,
              proposalContentReady: isQuoteProposalContentReady(
                currentVersion?.terms_snapshot,
              ),
              listAmount: currentLines.reduce(
                (sum, line) =>
                  sum + Number(line.quantity) * Number(line.unit_price_amount),
                0,
              ),
              discountAmount: currentLines.reduce(
                (sum, line) => sum + Number(line.discount_amount),
                0,
              ),
              proposalTerms: proposalContent.terms,
            },
            approvalPolicy,
          ),
        ] as const;
      }),
    );
  }, [
    approvalPolicy,
    canViewCosts,
    costs,
    linesByVersion,
    quotes,
    versionsByKey,
  ]);

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
        const created = await createQuoteDraft({
          organizationId,
          dealId,
          title,
          currency,
          validUntil,
          totalAmount,
        });
        const quote = created.quote as Quote;
        setQuotes((current) => [quote, ...current]);
        setVersions((current) => [
          {
            id: created.versionId,
            quote_id: quote.id,
            version: quote.current_version,
            total_amount: totalAmount,
            net_amount: totalAmount,
            tax_amount: 0,
            margin_amount: null,
            margin_percent: null,
            terms_snapshot: {},
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
            id: updated.versionId,
            quote_id: quote.id,
            version: updated.version,
            total_amount: totalAmount,
            net_amount: totalAmount,
            tax_amount: 0,
            margin_amount: totalAmount - estimatedCostAmount,
            margin_percent:
              totalAmount > 0
                ? ((totalAmount - estimatedCostAmount) / totalAmount) * 100
                : null,
            terms_snapshot:
              versionsByKey.get(`${quote.id}:${quote.current_version}`)
                ?.terms_snapshot ?? {},
          },
          ...current,
        ]);
        setCostEstimates((current) => [
          {
            quote_version_id: updated.versionId,
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
            id: approval.approvalId,
            entity_id: quote.id,
            status: "pending",
            created_at: new Date().toISOString(),
            payload: { quote_version: quote.current_version },
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

  function publishApprovedShare(
    quote: Quote,
    approvalId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = new FormData(event.currentTarget);
    const durationDays = Number(form.get("durationDays") || 7);
    startTransition(async () => {
      try {
        const published = await publishQuoteShare({
          organizationId,
          quoteId: quote.id,
          approvalId,
          durationDays,
        });
        const versionId = versionIds.get(
          `${quote.id}:${published.quoteVersion}`,
        );
        if (!versionId)
          throw new Error("The published quote version is not loaded.");
        setQuotes((current) =>
          current.map((item) =>
            item.id === quote.id ? { ...item, status: "shared" } : item,
          ),
        );
        setShareLinks((current) => [
          {
            id: published.id,
            quote_id: quote.id,
            quote_version_id: versionId,
            approval_request_id: approvalId,
            status: "active",
            effective_status: "active",
            published_at: published.publishedAt,
            expires_at: published.expiresAt,
            revoked_at: null,
          },
          ...current,
        ]);
        setPublishedPaths((current) => ({
          ...current,
          [published.id]: published.path,
        }));
        setNotice(
          "Approved proposal published. Copy the private link now; the raw credential is not stored and nothing was emailed.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not publish the approved proposal.",
        );
      }
    });
  }

  function revokePublishedShare(
    quote: Quote,
    shareLinkId: string,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const note = String(form.get("note") || "").trim();
    startTransition(async () => {
      try {
        const revoked = await revokeQuoteShare({
          organizationId,
          shareLinkId,
          note,
        });
        setQuotes((current) =>
          current.map((item) =>
            item.id === quote.id ? { ...item, status: "draft" } : item,
          ),
        );
        setShareLinks((current) =>
          current.map((link) =>
            link.id === shareLinkId
              ? {
                  ...link,
                  status: "revoked",
                  effective_status: "revoked",
                  revoked_at: revoked.revokedAt,
                }
              : link,
          ),
        );
        setPublishedPaths((current) => {
          const next = { ...current };
          delete next[shareLinkId];
          return next;
        });
        formElement.reset();
        setNotice(
          "Public proposal revoked immediately. The quote is back in Draft and needs a fresh human review before republishing.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not revoke the public proposal.",
        );
      }
    });
  }

  function applyStructuredRevision(
    result: Awaited<ReturnType<typeof import("../actions/crm").reviseQuoteDraftWithLines>>,
  ) {
    const summary = result.summary;
    const previousQuote = quotes.find((quote) => quote.id === result.quote.id);
    const previousContent = previousQuote
      ? versionsByKey.get(
          `${previousQuote.id}:${previousQuote.current_version}`,
        )?.terms_snapshot
      : {};
    setQuotes((current) =>
      current.map((quote) =>
        quote.id === result.quote.id ? (result.quote as Quote) : quote,
      ),
    );
    setVersions((current) => [
      {
        id: summary.quote_version_id,
        quote_id: result.quote.id,
        version: summary.quote_version,
        total_amount: summary.customer_total_amount,
        net_amount: summary.net_sell_amount,
        tax_amount: summary.tax_total_amount,
        margin_amount: summary.gross_margin_amount,
        margin_percent: summary.gross_margin_percent,
        terms_snapshot: previousContent ?? {},
      },
      ...current,
    ]);
    setCostEstimates((current) => [
      {
        quote_version_id: summary.quote_version_id,
        estimated_cost_amount: summary.estimated_cost_amount,
      },
      ...current,
    ]);
    setLineItems((current) => [
      ...(result.lines as QuoteLineItem[]),
      ...current,
    ]);
  }

  function applyProposalRevision(
    result: Awaited<
      ReturnType<typeof import("../actions/crm").reviseQuoteProposalContent>
    >,
  ) {
    setQuotes((current) =>
      current.map((quote) =>
        quote.id === result.quote.id ? (result.quote as Quote) : quote,
      ),
    );
    setVersions((current) => [result.version as QuoteVersion, ...current]);
    if (result.cost) {
      setCostEstimates((current) => [
        result.cost as QuoteCostEstimate,
        ...current,
      ]);
    }
    setLineItems((current) => [
      ...(result.lines as QuoteLineItem[]),
      ...current,
    ]);
  }

  function applyPaymentSchedule(saved: QuotePaymentScheduleRow) {
    setPaymentSchedules((current) => [
      saved,
      ...current.map((schedule) =>
        schedule.quote_id === saved.quote_id && schedule.status === "active"
          ? { ...schedule, status: "superseded" as const }
          : schedule,
      ),
    ]);
    setShareApprovals((current) =>
      current.map((approval) =>
        approval.entity_id === saved.quote_id && approval.status === "pending"
          ? { ...approval, status: "cancelled" }
          : approval,
      ),
    );
  }

  function saveApprovalPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending || !canManagePolicy) return;
    const form = new FormData(event.currentTarget);
    const minimumMarginPercent = Number(form.get("minimumMarginPercent"));
    const maximumValidityDays = Number(form.get("maximumValidityDays"));
    const maximumDiscountPercent = Number(
      form.get("maximumDiscountPercent"),
    );
    const standardTerms = splitQuoteProposalLines(
      String(form.get("standardTerms") || ""),
    );
    startTransition(async () => {
      try {
        const policy = await updateQuoteApprovalPolicy({
          organizationId,
          minimumMarginPercent,
          maximumValidityDays,
          requireCostEstimate: form.get("requireCostEstimate") === "on",
          requireValidUntil: form.get("requireValidUntil") === "on",
          maximumDiscountPercent,
          enforceStandardTerms: form.get("enforceStandardTerms") === "on",
          standardTerms,
        });
        setApprovalPolicy({
          minimumMarginPercent: Number(policy.minimum_margin_percent),
          requireCostEstimate: policy.require_cost_estimate,
          requireValidUntil: policy.require_valid_until,
          maximumValidityDays: policy.maximum_validity_days,
          maximumDiscountPercent: Number(policy.maximum_discount_percent),
          enforceStandardTerms: policy.enforce_standard_terms,
          standardTerms: Array.isArray(policy.standard_terms)
            ? policy.standard_terms.filter(
                (term): term is string => typeof term === "string",
              )
            : [],
        });
        setShareApprovals((current) =>
          current.map((approval) =>
            approval.status === "pending"
              ? { ...approval, status: "cancelled" }
              : approval,
          ),
        );
        setNotice(
          "Quote guardrails updated. Existing drafts were re-evaluated and stale pending reviews were cancelled; nothing was shared.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update quote guardrails.",
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
          { href: "/trips", label: "Trip Operations" },
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
        <span>GOVERNED</span>
        <p>
          <b>Public proposals require an exact-version human approval.</b> AIOS
          can prepare the draft, but only an authorized person can publish its
          expiring private link. No email or message is sent automatically.
        </p>
      </section>
      <section className="quote-policy" aria-labelledby="quote-policy-title">
        <div>
          <p>REVIEW POLICY</p>
          <h2 id="quote-policy-title">Commercial guardrails</h2>
          <span>
            AIOS checks the exact current version before it can enter human
            sharing review. Exceptions remain visible to the approver; blockers
            must be completed first.
          </span>
        </div>
        {canManagePolicy ? (
          <form
            key={JSON.stringify(approvalPolicy)}
            onSubmit={saveApprovalPolicy}
          >
            <label>
              Minimum gross margin %
              <input
                name="minimumMarginPercent"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={approvalPolicy.minimumMarginPercent}
                required
              />
            </label>
            <label>
              Maximum validity days
              <input
                name="maximumValidityDays"
                type="number"
                min="1"
                max="365"
                step="1"
                defaultValue={approvalPolicy.maximumValidityDays}
                required
              />
            </label>
            <label>
              Maximum discount %
              <input
                name="maximumDiscountPercent"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={approvalPolicy.maximumDiscountPercent}
                required
              />
            </label>
            <label className="quote-policy-check">
              <input
                name="requireCostEstimate"
                type="checkbox"
                defaultChecked={approvalPolicy.requireCostEstimate}
              />
              Require current cost estimate
            </label>
            <label className="quote-policy-check">
              <input
                name="requireValidUntil"
                type="checkbox"
                defaultChecked={approvalPolicy.requireValidUntil}
              />
              Require validity date
            </label>
            <label className="quote-policy-check">
              <input
                name="enforceStandardTerms"
                type="checkbox"
                defaultChecked={approvalPolicy.enforceStandardTerms}
              />
              Flag terms outside the standard set
            </label>
            <label className="quote-policy-terms">
              Standard customer terms · one per line
              <textarea
                name="standardTerms"
                rows={3}
                maxLength={9029}
                defaultValue={approvalPolicy.standardTerms.join("\n")}
                placeholder="Subject to availability"
              />
            </label>
            <button type="submit" disabled={pending || !organizationId}>
              {pending ? "Saving…" : "Save quote guardrails"}
            </button>
          </form>
        ) : (
          <p className="quote-policy-summary">
            {approvalPolicy.minimumMarginPercent}% margin floor · up to{" "}
            {approvalPolicy.maximumDiscountPercent}% discount · up to{" "}
            {approvalPolicy.maximumValidityDays} validity days
            {approvalPolicy.enforceStandardTerms
              ? " · standard terms enforced"
              : ""}{" "}
            · owners and admins configure
          </p>
        )}
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
          quotes.map((quote) => {
            const quoteKey = `${quote.id}:${quote.current_version}`;
            const guardrails = guardrailsByQuote.get(quote.id);
            const currentVersion = versionsByKey.get(quoteKey);
            const proposalContent = parseQuoteProposalContent(
              currentVersion?.terms_snapshot,
            );
            const currentVersionId = versionIds.get(quoteKey);
            const currentLines = currentVersionId
              ? (linesByVersion.get(currentVersionId) ?? [])
              : [];
            const shareApproval = latestShareApproval.get(quote.id);
            const shareLink = latestShareLink.get(quote.id);
            const paymentSchedule = activePaymentSchedules.get(quote.id) ?? null;
            const paymentScheduleItems = parseQuotePaymentScheduleItems(
              paymentSchedule?.items,
            );
            const invoiceReadiness = currentVersion
              ? assessQuoteInvoiceReadiness({
                  quoteStatus: quote.status,
                  quoteVersionId: currentVersion.id,
                  quoteTotalAmount: Number(currentVersion.total_amount),
                  schedule: paymentSchedule
                    ? {
                        quoteVersionId: paymentSchedule.quote_version_id,
                        totalAmount: Number(paymentSchedule.total_amount),
                        items: paymentScheduleItems,
                      }
                    : null,
                })
              : null;
            const approvalConsumed = shareApproval
              ? consumedShareApprovals.has(shareApproval.id)
              : false;
            const hasStoredOpenLink = shareLink?.status === "active";
            const canPublishApproved =
              quote.status === "draft" &&
              shareApproval?.status === "approved" &&
              !approvalConsumed &&
              !hasStoredOpenLink;
            const canRequestFreshReview =
              quote.status === "draft" &&
              !hasStoredOpenLink &&
              (!shareApproval ||
                ["rejected", "cancelled", "expired"].includes(
                  shareApproval.status,
                ) ||
                (shareApproval.status === "approved" && approvalConsumed));
            return (
              <article key={quote.id}>
              <div>
                <span className="quote-status">{quote.status}</span>
                {shareApproval?.status === "pending" && (
                  <span className="quote-review-state">Sharing review pending</span>
                )}
                {shareApproval?.status === "approved" && !approvalConsumed && (
                  <span className="quote-review-state quote-review-approved">
                    Approved · ready to publish
                  </span>
                )}
                {shareLink?.effective_status === "active" && (
                  <span className="quote-review-state quote-review-live">
                    Public link active
                  </span>
                )}
                {shareLink?.effective_status === "expired" &&
                  shareLink.status === "active" && (
                    <span className="quote-review-state quote-review-expired">
                      Public link expired · close to edit
                    </span>
                  )}
                <h3>{quote.title}</h3>
                <p>
                  {dealTitles.get(quote.deal_id) || "Opportunity"} · Version{" "}
                  {quote.current_version}
                </p>
              </div>
              <div className="quote-amount">
                <b>{formatMoney(versionAmounts.get(quoteKey), quote.currency)}</b>
                {canViewCosts && (
                  <small className="quote-profitability">
                    {(() => {
                      const version = versionsByKey.get(quoteKey);
                      const cost = costs.get(
                        versionIds.get(`${quote.id}:${quote.current_version}`) || "",
                      );
                      if (cost === undefined) return "Internal cost not captured";
                      const margin = formatMargin(version, cost);
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
                {currentLines.length > 0 && (
                  <details className="quote-breakdown">
                    <summary>{currentLines.length} customer line items</summary>
                    <ul>
                      {currentLines.map((line) => (
                        <li key={line.id}>
                          <span>
                            {line.description} · {line.quantity} ×{" "}
                            {line.category}
                          </span>
                          <b>{formatMoney(line.total_amount, quote.currency)}</b>
                          <small>
                            Net {formatMoney(line.net_amount, quote.currency)} ·
                            tax {line.tax_percent}%
                            {line.discount_amount > 0
                              ? ` · discount ${formatMoney(line.discount_amount, quote.currency)}`
                              : ""}
                            {line.catalog_rate_id ? " · catalog snapshot" : ""}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {isQuoteProposalContentReady(
                  currentVersion?.terms_snapshot,
                ) && (
                  <details className="quote-proposal-preview">
                    <summary>Customer proposal content</summary>
                    {[
                      ["Included", proposalContent.inclusions],
                      ["Not included", proposalContent.exclusions],
                      ["Terms", proposalContent.terms],
                    ].map(([label, items]) => (
                      <section key={label as string}>
                        <h4>{label}</h4>
                        {(items as string[]).length > 0 ? (
                          <ul>
                            {(items as string[]).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>None recorded.</p>
                        )}
                      </section>
                    ))}
                  </details>
                )}
                {invoiceReadiness && (
                  <section
                    className={`quote-invoice-readiness quote-invoice-${invoiceReadiness.code}`}
                    aria-label={`Invoice readiness: ${invoiceReadiness.label}`}
                  >
                    <div>
                      <small>PAYMENT TERMS</small>
                      <strong>{invoiceReadiness.label}</strong>
                      <span>
                        {paymentSchedule
                          ? `Schedule revision ${paymentSchedule.revision} · ${paymentScheduleItems.length} milestone${paymentScheduleItems.length === 1 ? "" : "s"}`
                          : "Add exact customer payment milestones before invoicing."}
                      </span>
                    </div>
                    {paymentSchedule?.quote_version_id === currentVersion?.id && (
                      <ol>
                        {paymentScheduleItems.map((item) => (
                          <li key={`${item.kind}-${item.label}`}>
                            <span>
                              {item.label} · {item.dueDate}
                            </span>
                            <b>{formatMoney(item.amount, quote.currency)}</b>
                          </li>
                        ))}
                      </ol>
                    )}
                    <small>
                      This is readiness evidence only. AIOS has not issued an
                      invoice or created a receivable.
                    </small>
                  </section>
                )}
                <Link
                  className="quote-customer-preview-link"
                  href={`/quotes/${quote.id}/preview?organization=${organizationId}`}
                >
                  Preview customer version
                </Link>
                {guardrails ? (
                  <section
                    className={`quote-guardrails quote-guardrails-${guardrails.status.tone}`}
                    aria-label={`Commercial readiness: ${guardrails.status.label}`}
                  >
                    <strong>{guardrails.status.label}</strong>
                    {guardrails.marginPercent !== null && (
                      <span>{guardrails.marginPercent.toFixed(1)}% evidenced margin</span>
                    )}
                    {currentLines.length > 0 && (
                      <span>
                        {guardrails.discountPercent.toFixed(1)}% itemized discount
                      </span>
                    )}
                    {[...guardrails.blockers, ...guardrails.exceptions].map(
                      (signal) => (
                        <span key={signal.code} title={signal.detail}>
                          {signal.label}
                        </span>
                      ),
                    )}
                    {guardrails.riskCodes.length === 0 && (
                      <span>Current version is inside configured policy</span>
                    )}
                  </section>
                ) : (
                  <small className="quote-guardrails-restricted">
                    Commercial readiness evidence is restricted to authorized
                    roles.
                  </small>
                )}
                {canCreate && quote.status === "draft" && (
                  <QuotePaymentScheduleEditor
                    key={`payment:${quote.id}:${quote.current_version}:${paymentSchedule?.id ?? "none"}`}
                    organizationId={organizationId!}
                    quoteId={quote.id}
                    quoteVersionId={currentVersion?.id ?? ""}
                    quoteTotalAmount={Number(currentVersion?.total_amount ?? 0)}
                    currency={quote.currency}
                    validUntil={quote.valid_until}
                    schedule={
                      paymentSchedule
                        ? {
                            id: paymentSchedule.id,
                            quote_version_id: paymentSchedule.quote_version_id,
                            revision: paymentSchedule.revision,
                            total_amount: Number(paymentSchedule.total_amount),
                            items: paymentScheduleItems,
                          }
                        : null
                    }
                    onSaved={(saved) =>
                      applyPaymentSchedule(saved as QuotePaymentScheduleRow)
                    }
                    onNotice={setNotice}
                  />
                )}
                {canCreate && quote.status === "draft" && (
                  <QuoteProposalEditor
                    key={`proposal:${quote.id}:${quote.current_version}`}
                    organizationId={organizationId!}
                    quoteId={quote.id}
                    currentContent={proposalContent}
                    onSaved={applyProposalRevision}
                    onNotice={setNotice}
                  />
                )}
                {canCreate && quote.status === "draft" && (
                  <StructuredQuoteComposer
                    organizationId={organizationId!}
                    quoteId={quote.id}
                    currency={quote.currency}
                    catalogItems={effectiveCatalog.filter(
                      (item) => item.currency === quote.currency,
                    )}
                    onSaved={applyStructuredRevision}
                    onNotice={setNotice}
                  />
                )}
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
                        defaultValue={versionAmounts.get(quoteKey) ?? 0}
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
                {canCreate && canPublishApproved && shareApproval && (
                  <form
                    className="quote-share-publish"
                    onSubmit={(event) =>
                      publishApprovedShare(quote, shareApproval.id, event)
                    }
                  >
                    <div>
                      <b>Human approval verified</b>
                      <span>
                        Publish an expiring snapshot of exact version {quote.current_version}.
                        This creates a link but sends nothing.
                      </span>
                    </div>
                    <label>
                      Link lifetime
                      <select name="durationDays" defaultValue="7">
                        <option value="1">1 day</option>
                        <option value="7">7 days</option>
                        <option value="14">14 days</option>
                        <option value="30">30 days</option>
                      </select>
                    </label>
                    <button type="submit" disabled={pending}>
                      {pending ? "Publishing…" : "Publish approved proposal"}
                    </button>
                  </form>
                )}
                {canCreate && hasStoredOpenLink && shareLink && (
                  <section className="quote-share-live" aria-label="Public proposal link">
                    <header>
                      <div>
                        <b>
                          {shareLink.effective_status === "active"
                            ? "Private proposal is live"
                            : "Private proposal has expired"}
                        </b>
                        <span>
                          {shareLink.effective_status === "active"
                            ? "Access closes"
                            : "Access closed"}{" "}
                          {new Date(shareLink.expires_at).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                      {publishedPaths[shareLink.id] ? (
                        <div className="quote-share-link-actions">
                          <Link
                            href={publishedPaths[shareLink.id]}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open public proposal
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(
                                  new URL(
                                    publishedPaths[shareLink.id],
                                    window.location.origin,
                                  ).toString(),
                                )
                                .then(() => setNotice("Private proposal link copied."))
                                .catch(() =>
                                  setNotice("The browser could not copy the link."),
                                );
                            }}
                          >
                            Copy private link
                          </button>
                        </div>
                      ) : (
                        <small>
                          The raw link is intentionally not stored. Revoke it if the
                          original copy was lost.
                        </small>
                      )}
                    </header>
                    <form
                      onSubmit={(event) =>
                        revokePublishedShare(quote, shareLink.id, event)
                      }
                    >
                      <label>
                        Revocation reason
                        <input
                          name="note"
                          minLength={10}
                          maxLength={500}
                          placeholder="Customer requested a revised proposal"
                          required
                        />
                      </label>
                      <button type="submit" disabled={pending}>
                        {pending ? "Closing…" : "Revoke public proposal"}
                      </button>
                    </form>
                  </section>
                )}
                {canCreate &&
                  canRequestFreshReview && (
                  <button
                    type="button"
                    className="quote-share-review"
                    onClick={() => requestSharingReview(quote)}
                    disabled={pending || !guardrails?.canRequestReview}
                    title={
                      guardrails?.canRequestReview
                        ? "Open the required human review; no quote is sent"
                        : "Complete the listed commercial guardrails first"
                    }
                  >
                    {pending
                      ? "Requesting…"
                      : approvalConsumed
                        ? "Request new human sharing review"
                        : "Request human sharing review"}
                  </button>
                )}
              </div>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
