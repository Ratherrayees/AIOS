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
  createInvoiceDocumentDownload,
  createPaymentObligation,
  createSupplierContact,
  createSupplierContract,
  createSupplierProfile,
  executeApprovedSandboxPaymentLink,
  issueApprovedInvoice,
  prepareAcceptedQuoteInvoiceDraft,
  preparePaymentLinkDraft,
  recordPaymentAllocation,
  refreshPaymentStatuses,
  requestInvoiceIssuanceApproval,
  requestPaymentLinkApproval,
  renderPrivateInvoiceDocument,
  updateInvoiceIssuerProfile,
  updateInvoiceNumberPolicy,
  voidPaymentObligation,
} from "../actions/crm";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import {
  accountingExportFilename,
  createAccountingExportCsv,
} from "../../lib/finance/accounting-export";
import { QuoteCatalogPanel } from "./quote-catalog-panel";
import "./finance.css";

type Supplier = {
  id: string;
  name: string;
  category: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  preferred_currency: string;
  payment_terms_days: number | null;
  cancellation_terms: string | null;
  quality_rating: number | null;
  status: string;
};

type SupplierContact = {
  id: string;
  supplier_id: string;
  name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
};

type SupplierContract = {
  id: string;
  supplier_id: string;
  title: string;
  contract_reference: string | null;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  currency: string;
  payment_terms_days: number | null;
};

type Payment = {
  id: string;
  deal_id: string | null;
  trip_id: string | null;
  supplier_id: string | null;
  direction: "receivable" | "payable";
  status:
    | "pending"
    | "partially_paid"
    | "paid"
    | "overdue"
    | "refunded"
    | "void";
  title: string;
  invoice_number: string | null;
  description: string | null;
  amount: number;
  paid_amount: number;
  currency: string;
  due_at: string | null;
  paid_at: string | null;
  status_note: string | null;
  created_at: string;
  quote_id: string | null;
  quote_version_id: string | null;
  quote_acceptance_id: string | null;
  quote_payment_schedule_id: string | null;
  quote_schedule_item_position: number | null;
  invoice_issuance_id: string | null;
};

type PaymentAllocation = {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  occurred_at: string;
  reference: string | null;
  note: string | null;
};

type InvoiceNumberPolicy = {
  number_prefix: string;
  next_number: number;
  number_padding: number;
  updated_at: string;
};

type InvoiceDraft = {
  id: string;
  quote_id: string;
  quote_acceptance_id: string;
  revision: number;
  status: "ready" | "superseded" | "issued";
  number_preview: string;
  number_policy_updated_at: string;
  bill_to_name: string;
  currency: string;
  net_amount: number;
  tax_amount: number;
  total_amount: number;
  line_count: number;
  payment_term_count: number;
  content_sha256: string;
  created_at: string;
};

type InvoiceIssuerProfile = {
  legal_name: string;
  registered_address: string;
  jurisdiction_country_code: string;
  tax_registration_id: string | null;
  updated_at: string;
};

type InvoiceIssuanceApproval = {
  id: string;
  entity_id: string | null;
  status: "pending" | "approved";
  expires_at: string | null;
  resolved_at: string | null;
};

type InvoiceIssuance = {
  id: string;
  invoice_draft_id: string;
  invoice_number: string;
  currency: string;
  total_amount: number;
  issued_at: string;
  issuance_sha256: string;
};

type InvoiceDocument = {
  id: string;
  invoice_issuance_id: string;
  renderer_version: string;
  compliance_status: "jurisdiction_review_required";
  file_name: string;
  byte_size: number;
  content_sha256: string;
  generated_at: string;
};

type PaymentLinkDraft = {
  id: string;
  payment_id: string;
  invoice_issuance_id: string;
  revision: number;
  status: "ready" | "superseded";
  currency: string;
  requested_amount: number;
  due_at: string | null;
  invoice_number: string;
  evidence_sha256: string;
  created_at: string;
};

type PaymentLinkApproval = {
  id: string;
  entity_id: string | null;
  status: "pending" | "approved";
  expires_at: string | null;
  resolved_at: string | null;
};

type PaymentLinkExecution = {
  id: string;
  payment_link_draft_id: string;
  approval_request_id: string;
  provider_key: string;
  provider_environment: "sandbox" | "production";
  adapter_version: string;
  status: "active" | "completed" | "expired" | "invalidated" | "failed";
  currency: string;
  requested_amount: number;
  provider_reference: string;
  checkout_target: string;
  checkout_expires_at: string;
  created_at: string;
};

type TripOption = {
  id: string;
  name: string;
  currency: string;
};

type DealOption = {
  id: string;
  title: string;
  currency: string;
};

type LedgerFilter = "open" | "receivable" | "payable" | "settled" | "all";

const supplierWriteRoles = new Set([
  "owner",
  "admin",
  "trip_designer",
  "operations",
  "finance",
]);
const financeWriteRoles = new Set(["owner", "admin", "finance"]);
const openStatuses = new Set(["pending", "partially_paid", "overdue"]);

function nullableText(formData: FormData, name: string) {
  const value = String(formData.get(name) || "").trim();
  return value || null;
}

function nullableNumber(formData: FormData, name: string) {
  const value = nullableText(formData, name);
  return value === null ? null : Number(value);
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function shortDate(value: string | null) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function FinancePage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Travel workspace");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierContacts, setSupplierContacts] = useState<SupplierContact[]>(
    [],
  );
  const [supplierContracts, setSupplierContracts] = useState<
    SupplierContract[]
  >([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [invoicePolicy, setInvoicePolicy] =
    useState<InvoiceNumberPolicy | null>(null);
  const [invoiceDrafts, setInvoiceDrafts] = useState<InvoiceDraft[]>([]);
  const [invoiceIssuerProfile, setInvoiceIssuerProfile] =
    useState<InvoiceIssuerProfile | null>(null);
  const [invoiceApprovals, setInvoiceApprovals] = useState<
    InvoiceIssuanceApproval[]
  >([]);
  const [invoiceIssuances, setInvoiceIssuances] = useState<InvoiceIssuance[]>(
    [],
  );
  const [invoiceDocuments, setInvoiceDocuments] = useState<InvoiceDocument[]>(
    [],
  );
  const [paymentLinkDrafts, setPaymentLinkDrafts] = useState<
    PaymentLinkDraft[]
  >([]);
  const [paymentLinkApprovals, setPaymentLinkApprovals] = useState<
    PaymentLinkApproval[]
  >([]);
  const [paymentLinkExecutions, setPaymentLinkExecutions] = useState<
    PaymentLinkExecution[]
  >([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [filter, setFilter] = useState<LedgerFilter>("open");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [financeLoadedAt, setFinanceLoadedAt] = useState(0);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const canManageSuppliers = role ? supplierWriteRoles.has(role) : false;
  const canManageFinance = role ? financeWriteRoles.has(role) : false;

  async function loadFinance(targetOrganizationId: string) {
    const supabase = createSupabaseBrowserClient();
    const [
      supplierResult,
      contactResult,
      contractResult,
      paymentResult,
      allocationResult,
      tripResult,
      dealResult,
      invoicePolicyResult,
      invoiceDraftResult,
      invoiceIssuerResult,
      invoiceApprovalResult,
      invoiceIssuanceResult,
      invoiceDocumentResult,
      paymentLinkDraftResult,
      paymentLinkApprovalResult,
      paymentLinkExecutionResult,
    ] = await Promise.all([
      supabase
        .from("suppliers")
        .select(
          "id, name, category, contact_name, email, phone, website, preferred_currency, payment_terms_days, cancellation_terms, quality_rating, status",
        )
        .eq("organization_id", targetOrganizationId)
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("supplier_contacts")
        .select("id, supplier_id, name, role_title, email, phone, is_primary")
        .eq("organization_id", targetOrganizationId)
        .order("is_primary", { ascending: false })
        .order("name"),
      supabase
        .from("supplier_contracts")
        .select(
          "id, supplier_id, title, contract_reference, status, starts_on, ends_on, currency, payment_terms_days",
        )
        .eq("organization_id", targetOrganizationId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("payments")
        .select(
          "id, deal_id, trip_id, supplier_id, direction, status, title, invoice_number, description, amount, paid_amount, currency, due_at, paid_at, status_note, created_at, quote_id, quote_version_id, quote_acceptance_id, quote_payment_schedule_id, quote_schedule_item_position, invoice_issuance_id",
        )
        .eq("organization_id", targetOrganizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_allocations")
        .select(
          "id, payment_id, amount, currency, occurred_at, reference, note",
        )
        .eq("organization_id", targetOrganizationId)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("trips")
        .select("id, name, currency")
        .eq("organization_id", targetOrganizationId)
        .not("status", "in", '("completed","cancelled")')
        .order("updated_at", { ascending: false }),
      supabase
        .from("deals")
        .select("id, title, currency")
        .eq("organization_id", targetOrganizationId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false }),
      supabase
        .from("invoice_number_policies")
        .select("number_prefix, next_number, number_padding, updated_at")
        .eq("organization_id", targetOrganizationId)
        .maybeSingle(),
      supabase
        .from("invoice_drafts")
        .select(
          "id, quote_id, quote_acceptance_id, revision, status, number_preview, number_policy_updated_at, bill_to_name, currency, net_amount, tax_amount, total_amount, line_count, payment_term_count, content_sha256, created_at",
        )
        .eq("organization_id", targetOrganizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("invoice_issuer_profiles")
        .select(
          "legal_name, registered_address, jurisdiction_country_code, tax_registration_id, updated_at",
        )
        .eq("organization_id", targetOrganizationId)
        .maybeSingle(),
      supabase
        .from("approval_requests")
        .select("id, entity_id, status, expires_at, resolved_at")
        .eq("organization_id", targetOrganizationId)
        .eq("action", "invoice.issue")
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false }),
      supabase
        .from("invoice_issuances")
        .select(
          "id, invoice_draft_id, invoice_number, currency, total_amount, issued_at, issuance_sha256",
        )
        .eq("organization_id", targetOrganizationId)
        .order("issued_at", { ascending: false }),
      supabase
        .from("invoice_documents")
        .select(
          "id, invoice_issuance_id, renderer_version, compliance_status, file_name, byte_size, content_sha256, generated_at",
        )
        .eq("organization_id", targetOrganizationId)
        .order("generated_at", { ascending: false }),
      supabase
        .from("payment_link_drafts")
        .select(
          "id, payment_id, invoice_issuance_id, revision, status, currency, requested_amount, due_at, invoice_number, evidence_sha256, created_at",
        )
        .eq("organization_id", targetOrganizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("approval_requests")
        .select("id, entity_id, status, expires_at, resolved_at")
        .eq("organization_id", targetOrganizationId)
        .eq("action", "payment.link.create")
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_link_executions")
        .select(
          "id, payment_link_draft_id, approval_request_id, provider_key, provider_environment, adapter_version, status, currency, requested_amount, provider_reference, checkout_target, checkout_expires_at, created_at",
        )
        .eq("organization_id", targetOrganizationId)
        .order("created_at", { ascending: false }),
    ]);

    const error =
      supplierResult.error ??
      contactResult.error ??
      contractResult.error ??
      paymentResult.error ??
      allocationResult.error ??
      tripResult.error ??
      dealResult.error ??
      invoicePolicyResult.error ??
      invoiceDraftResult.error ??
      invoiceIssuerResult.error ??
      invoiceApprovalResult.error ??
      invoiceIssuanceResult.error ??
      invoiceDocumentResult.error ??
      paymentLinkDraftResult.error ??
      paymentLinkApprovalResult.error ??
      paymentLinkExecutionResult.error;
    if (error) throw error;

    const nextSuppliers = (supplierResult.data ?? []) as Supplier[];
    setSuppliers(nextSuppliers);
    setSupplierContacts((contactResult.data ?? []) as SupplierContact[]);
    setSupplierContracts((contractResult.data ?? []) as SupplierContract[]);
    setPayments((paymentResult.data ?? []) as Payment[]);
    setAllocations((allocationResult.data ?? []) as PaymentAllocation[]);
    setTrips((tripResult.data ?? []) as TripOption[]);
    setDeals((dealResult.data ?? []) as DealOption[]);
    setInvoicePolicy(
      (invoicePolicyResult.data as InvoiceNumberPolicy | null) ?? null,
    );
    setInvoiceDrafts((invoiceDraftResult.data ?? []) as InvoiceDraft[]);
    setInvoiceIssuerProfile(
      (invoiceIssuerResult.data as InvoiceIssuerProfile | null) ?? null,
    );
    setInvoiceApprovals(
      (invoiceApprovalResult.data ?? []) as InvoiceIssuanceApproval[],
    );
    setInvoiceIssuances(
      (invoiceIssuanceResult.data ?? []) as InvoiceIssuance[],
    );
    setInvoiceDocuments(
      (invoiceDocumentResult.data ?? []) as InvoiceDocument[],
    );
    setPaymentLinkDrafts(
      (paymentLinkDraftResult.data ?? []) as PaymentLinkDraft[],
    );
    setPaymentLinkApprovals(
      (paymentLinkApprovalResult.data ?? []) as PaymentLinkApproval[],
    );
    setPaymentLinkExecutions(
      (paymentLinkExecutionResult.data ?? []) as PaymentLinkExecution[],
    );
    setFinanceLoadedAt(Date.now());
    setSelectedSupplierId((current) =>
      nextSuppliers.some((supplier) => supplier.id === current)
        ? current
        : (nextSuppliers[0]?.id ?? ""),
    );
  }

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active } = await loadWorkspaceContext(supabase);
      if (!active) {
        setNotice("No active workspace is available for this account.");
        setLoading(false);
        return;
      }
      setOrganizationId(active.organization_id);
      setRole(active.role);
      setWorkspaceName(active.name);
      let refreshWarning = "";
      if (financeWriteRoles.has(active.role)) {
        try {
          await refreshPaymentStatuses({
            organizationId: active.organization_id,
          });
        } catch {
          refreshWarning =
            "Finance data loaded, but due-date states could not refresh.";
        }
      }
      await loadFinance(active.organization_id);
      if (refreshWarning) setNotice(refreshWarning);
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load supplier and finance operations.");
      setLoading(false);
    });
  }, []);

  const selectedSupplier =
    suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null;
  const selectedContacts = supplierContacts.filter(
    (contact) => contact.supplier_id === selectedSupplierId,
  );
  const selectedContracts = supplierContracts.filter(
    (contract) => contract.supplier_id === selectedSupplierId,
  );

  const filteredPayments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return payments.filter((payment) => {
      if (filter === "open" && !openStatuses.has(payment.status)) return false;
      if (filter === "receivable" && payment.direction !== "receivable")
        return false;
      if (filter === "payable" && payment.direction !== "payable") return false;
      if (
        filter === "settled" &&
        !["paid", "refunded", "void"].includes(payment.status)
      )
        return false;
      if (!normalizedQuery) return true;
      const supplierName =
        suppliers.find((supplier) => supplier.id === payment.supplier_id)
          ?.name ?? "";
      return [
        payment.title,
        payment.invoice_number,
        payment.description,
        supplierName,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, payments, query, suppliers]);

  const currencySummaries = useMemo(() => {
    const totals = new Map<
      string,
      { receivable: number; payable: number; overdue: number }
    >();
    for (const payment of payments) {
      if (!openStatuses.has(payment.status)) continue;
      const current = totals.get(payment.currency) ?? {
        receivable: 0,
        payable: 0,
        overdue: 0,
      };
      const outstanding = payment.amount - payment.paid_amount;
      current[payment.direction] += outstanding;
      if (payment.status === "overdue") current.overdue += outstanding;
      totals.set(payment.currency, current);
    }
    return [...totals.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [payments]);

  const acceptedQuoteReceivableGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        quoteId: string;
        acceptanceId: string;
        currency: string;
        total: number;
        count: number;
      }
    >();
    for (const payment of payments) {
      if (!payment.quote_id || !payment.quote_acceptance_id) continue;
      const current = groups.get(payment.quote_id) ?? {
        quoteId: payment.quote_id,
        acceptanceId: payment.quote_acceptance_id,
        currency: payment.currency,
        total: 0,
        count: 0,
      };
      current.total += payment.amount;
      current.count += 1;
      groups.set(payment.quote_id, current);
    }
    return [...groups.values()];
  }, [payments]);

  function submitInvoicePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formData = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        await updateInvoiceNumberPolicy({
          organizationId,
          numberPrefix: String(formData.get("numberPrefix") || ""),
          nextNumber: Number(formData.get("nextNumber")),
          numberPadding: Number(formData.get("numberPadding")),
        });
        await loadFinance(organizationId);
        setNotice(
          "Invoice preview policy saved. No legal number was allocated.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The invoice preview policy could not be saved.",
        );
      }
    });
  }

  function downloadAccountingLedger() {
    if (!canManageFinance) {
      setNotice("Only an owner, admin, or finance member can export the ledger.");
      return;
    }
    if (loading) {
      setNotice("Finance evidence is still loading.");
      return;
    }

    try {
      const generatedAt = new Date();
      const csv = createAccountingExportCsv({
        generatedAt,
        workspaceName,
        payments: payments.map((payment) => ({
          id: payment.id,
          dealId: payment.deal_id,
          tripId: payment.trip_id,
          supplierId: payment.supplier_id,
          direction: payment.direction,
          status: payment.status,
          title: payment.title,
          description: payment.description,
          amount: payment.amount,
          paidAmount: payment.paid_amount,
          currency: payment.currency,
          dueAt: payment.due_at,
          paidAt: payment.paid_at,
          createdAt: payment.created_at,
          invoiceNumber: payment.invoice_number,
          invoiceIssuanceId: payment.invoice_issuance_id,
          quoteId: payment.quote_id,
          quoteVersionId: payment.quote_version_id,
          quoteAcceptanceId: payment.quote_acceptance_id,
        })),
        allocations: allocations.map((allocation) => ({
          id: allocation.id,
          paymentId: allocation.payment_id,
          amount: allocation.amount,
          currency: allocation.currency,
          occurredAt: allocation.occurred_at,
          reference: allocation.reference,
          note: allocation.note,
        })),
        issuances: invoiceIssuances.map((issuance) => ({
          id: issuance.id,
          invoiceNumber: issuance.invoice_number,
          issuanceSha256: issuance.issuance_sha256,
        })),
        suppliers: suppliers.map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
        })),
        deals: deals.map((deal) => ({ id: deal.id, title: deal.title })),
        trips: trips.map((trip) => ({ id: trip.id, name: trip.name })),
      });
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = accountingExportFilename(generatedAt);
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(
        "Accounting ledger downloaded locally. No upload, payment, message, or provider action occurred.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The accounting ledger could not be exported safely.",
      );
    }
  }

  function prepareInvoiceDraft(quoteId: string) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const result = await prepareAcceptedQuoteInvoiceDraft({
          organizationId,
          quoteId,
        });
        await loadFinance(organizationId);
        setNotice(
          result.already_prepared
            ? "The exact invoice draft was already prepared. Nothing was issued."
            : `Invoice draft revision ${result.revision} prepared. No number was allocated or delivered.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The invoice draft could not be prepared.",
        );
      }
    });
  }

  function submitInvoiceIssuer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formData = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        await updateInvoiceIssuerProfile({
          organizationId,
          legalName: String(formData.get("issuerLegalName") || ""),
          registeredAddress: String(
            formData.get("issuerRegisteredAddress") || "",
          ),
          jurisdictionCountryCode: String(
            formData.get("issuerCountryCode") || "",
          ),
          taxRegistrationId: nullableText(formData, "issuerTaxId"),
        });
        await loadFinance(organizationId);
        setNotice(
          "Invoice issuer identity saved. Any older pending issuance review is now expired.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The invoice issuer identity could not be saved.",
        );
      }
    });
  }

  function submitInvoiceApproval(
    event: FormEvent<HTMLFormElement>,
    invoiceDraftId: string,
  ) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formData = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        const result = await requestInvoiceIssuanceApproval({
          organizationId,
          invoiceDraftId,
          rationale: String(formData.get("issuanceRationale") || ""),
        });
        await loadFinance(organizationId);
        setNotice(
          result.already_requested
            ? "This exact invoice draft is already waiting for a human decision."
            : "Exact invoice issuance review requested. No number was allocated.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The invoice issuance review could not be requested.",
        );
      }
    });
  }

  function issueInvoice(invoiceDraftId: string, approvalRequestId: string) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const result = await issueApprovedInvoice({
          organizationId,
          invoiceDraftId,
          approvalRequestId,
        });
        await loadFinance(organizationId);
        setNotice(
          result.already_issued
            ? `Invoice ${result.invoice_number} was already issued; no second number was consumed.`
            : `Invoice ${result.invoice_number} issued atomically. Rendering and delivery have not occurred.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The approved invoice could not be issued.",
        );
      }
    });
  }

  function renderInvoiceDocument(invoiceIssuanceId: string) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const result = await renderPrivateInvoiceDocument({
          organizationId,
          invoiceIssuanceId,
        });
        await loadFinance(organizationId);
        setNotice(
          result.already_rendered
            ? `Private invoice ${result.file_name} was already rendered from this exact issuance.`
            : `Private invoice ${result.file_name} rendered with immutable checksum evidence. Nothing was delivered.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The private invoice document could not be rendered.",
        );
      }
    });
  }

  function downloadInvoiceDocument(invoiceDocument: InvoiceDocument) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const result = await createInvoiceDocumentDownload({
          organizationId,
          invoiceDocumentId: invoiceDocument.id,
        });
        const anchor = window.document.createElement("a");
        anchor.href = result.url;
        anchor.download = result.fileName;
        anchor.hidden = true;
        window.document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setNotice(
          "Secure invoice download issued for 60 seconds. No customer delivery occurred.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The private invoice document could not be downloaded.",
        );
      }
    });
  }

  function prepareCollectionRequest(paymentId: string) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const result = await preparePaymentLinkDraft({
          organizationId,
          paymentId,
        });
        await loadFinance(organizationId);
        setNotice(
          result.already_prepared
            ? "This exact receivable balance is already prepared. No provider link exists."
            : `Payment-request revision ${result.revision} prepared for ${money(result.requested_amount, result.currency)}. Nothing was sent or collected.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The exact payment request could not be prepared.",
        );
      }
    });
  }

  function submitPaymentLinkApproval(
    event: FormEvent<HTMLFormElement>,
    paymentLinkDraftId: string,
  ) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formData = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        const result = await requestPaymentLinkApproval({
          organizationId,
          paymentLinkDraftId,
          rationale: String(formData.get("paymentLinkRationale") || ""),
        });
        await loadFinance(organizationId);
        setNotice(
          result.already_requested
            ? "This exact payment request is already waiting for a human decision."
            : "Payment-link review requested. No provider link, message, charge, or settlement was created.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The payment-link review could not be requested.",
        );
      }
    });
  }

  function createSandboxPaymentLink(
    paymentLinkDraftId: string,
    approvalRequestId: string,
  ) {
    if (!organizationId || pending) return;
    setNotice("");
    startTransition(async () => {
      try {
        const result = await executeApprovedSandboxPaymentLink({
          organizationId,
          paymentLinkDraftId,
          approvalRequestId,
        });
        await loadFinance(organizationId);
        setNotice(
          result.already_executed
            ? "The same sandbox checkout already exists; no duplicate provider execution was created."
            : "Sandbox checkout created from the exact approval. It cannot charge, message, or settle anything.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The approved sandbox checkout could not be created.",
        );
      }
    });
  }

  function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        const supplier = await createSupplierProfile({
          organizationId,
          name: String(formData.get("name") || ""),
          category: nullableText(formData, "category"),
          contactName: nullableText(formData, "contactName"),
          email: nullableText(formData, "email"),
          phone: nullableText(formData, "phone"),
          website: nullableText(formData, "website"),
          preferredCurrency: String(
            formData.get("preferredCurrency") || "INR",
          ).toUpperCase(),
          paymentTermsDays: nullableNumber(formData, "paymentTermsDays"),
          cancellationTerms: nullableText(formData, "cancellationTerms"),
          internalNotes: nullableText(formData, "internalNotes"),
          qualityRating: nullableNumber(formData, "qualityRating"),
        });
        await loadFinance(organizationId);
        setSelectedSupplierId(supplier.id);
        form.reset();
        setNotice("Supplier profile created. No supplier was contacted.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The supplier profile could not be created.",
        );
      }
    });
  }

  function submitSupplierContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        await createSupplierContact({
          organizationId,
          supplierId: String(formData.get("supplierId") || ""),
          name: String(formData.get("name") || ""),
          roleTitle: nullableText(formData, "roleTitle"),
          email: nullableText(formData, "email"),
          phone: nullableText(formData, "phone"),
          isPrimary: formData.get("isPrimary") === "on",
          notes: nullableText(formData, "notes"),
        });
        await loadFinance(organizationId);
        form.reset();
        setNotice("Supplier contact added as an internal record.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The supplier contact could not be added.",
        );
      }
    });
  }

  function submitSupplierContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        await createSupplierContract({
          organizationId,
          supplierId: String(formData.get("supplierId") || ""),
          title: String(formData.get("title") || ""),
          contractReference: nullableText(formData, "contractReference"),
          status:
            formData.get("status") === "active" ? "active" : "draft",
          startsOn: nullableText(formData, "startsOn"),
          endsOn: nullableText(formData, "endsOn"),
          currency: String(formData.get("currency") || "INR").toUpperCase(),
          paymentTermsDays: nullableNumber(formData, "paymentTermsDays"),
          cancellationTerms: nullableText(formData, "cancellationTerms"),
          internalNotes: nullableText(formData, "internalNotes"),
        });
        await loadFinance(organizationId);
        form.reset();
        setNotice(
          "Supplier terms recorded internally. No contract was signed or accepted.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The supplier contract could not be recorded.",
        );
      }
    });
  }

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        await createPaymentObligation({
          organizationId,
          direction:
            formData.get("direction") === "payable"
              ? "payable"
              : "receivable",
          title: String(formData.get("title") || ""),
          amount: Number(formData.get("amount")),
          currency: String(formData.get("currency") || "INR").toUpperCase(),
          dueAt: nullableText(formData, "dueAt"),
          dealId: nullableText(formData, "dealId"),
          tripId: nullableText(formData, "tripId"),
          supplierId: nullableText(formData, "supplierId"),
          invoiceNumber: nullableText(formData, "invoiceNumber"),
          description: nullableText(formData, "description"),
        });
        await loadFinance(organizationId);
        form.reset();
        setNotice(
          "Payment obligation created internally. No charge, payout, or invoice was sent.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The payment obligation could not be created.",
        );
      }
    });
  }

  function submitAllocation(
    event: FormEvent<HTMLFormElement>,
    payment: Payment,
  ) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        await recordPaymentAllocation({
          organizationId,
          paymentId: payment.id,
          amount: Number(formData.get("amount")),
          occurredAt: new Date().toISOString(),
          reference: nullableText(formData, "reference"),
          note: nullableText(formData, "note"),
        });
        await loadFinance(organizationId);
        form.reset();
        setNotice(
          "Settlement evidence recorded. AIOS did not initiate any money movement.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The settlement could not be recorded.",
        );
      }
    });
  }

  function submitVoid(
    event: FormEvent<HTMLFormElement>,
    payment: Payment,
  ) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        await voidPaymentObligation({
          organizationId,
          paymentId: payment.id,
          reason: String(formData.get("reason") || ""),
        });
        await loadFinance(organizationId);
        form.reset();
        setNotice("Unsettled obligation voided with human evidence.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The obligation could not be voided.",
        );
      }
    });
  }

  return (
    <main className="finance-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/trips", label: "Trip Operations" },
          { href: "/quotes", label: "Quotes" },
          { href: "/aios", label: "AIOS Control" },
          { href: "/", label: "Command center" },
        ]}
        ariaLabel="Finance workspace navigation"
      />

      <section className="finance-hero">
        <div>
          <p>FINANCE / CONTROLLED LEDGER</p>
          <h1>Know what is owed, what was settled, and why.</h1>
          <span>
            {workspaceName} can track customer receivables, supplier payables,
            contracts, contacts, and immutable settlement evidence without
            treating a spreadsheet as the source of truth.
          </span>
        </div>
        <aside>
          <i aria-hidden="true" />
          <b>₹</b>
          <span>record, reconcile, prove</span>
        </aside>
      </section>

      <section className="finance-boundary" aria-label="Finance authority boundary">
        <b>Internal ledger only</b>
        <span>
          AIOS may detect due dates. It cannot charge a traveller, pay a
          supplier, issue a refund, send an invoice, or accept contract terms.
        </span>
        <Link href="/aios">Review authority policy →</Link>
      </section>

      {notice ? (
        <p className="finance-notice" role="status">
          {notice}
        </p>
      ) : null}

      <section className="finance-pulse" aria-label="Open finance summary">
        <article>
          <span>SUPPLIERS</span>
          <b>{suppliers.length}</b>
          <small>active internal profiles</small>
        </article>
        <article>
          <span>OPEN ITEMS</span>
          <b>
            {
              payments.filter((payment) => openStatuses.has(payment.status))
                .length
            }
          </b>
          <small>receivables and payables</small>
        </article>
        <article>
          <span>OVERDUE</span>
          <b>
            {payments.filter((payment) => payment.status === "overdue").length}
          </b>
          <small>visible to Operations Radar</small>
        </article>
        <article>
          <span>EVIDENCE</span>
          <b>{allocations.length}</b>
          <small>immutable settlement records</small>
        </article>
      </section>

      <section className="currency-strip" aria-label="Outstanding by currency">
        <header>
          <div>
            <p>NO FALSE FX TOTALS</p>
            <h2>Outstanding balances stay currency-safe</h2>
          </div>
        </header>
        {currencySummaries.length === 0 ? (
          <span className="currency-empty">No open balances yet.</span>
        ) : (
          <div>
            {currencySummaries.map(([currency, summary]) => (
              <article key={currency}>
                <b>{currency}</b>
                <span>
                  In {money(summary.receivable, currency)}
                </span>
                <span>
                  Out {money(summary.payable, currency)}
                </span>
                <small>
                  {summary.overdue > 0
                    ? `${money(summary.overdue, currency)} overdue`
                    : "Nothing overdue"}
                </small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="finance-layout">
        <div className="supplier-workbench">
          <div className="finance-section-heading">
            <div>
              <p>SUPPLIER MEMORY</p>
              <h2>Profiles, people, and terms</h2>
            </div>
            <span>{suppliers.length} suppliers</span>
          </div>

          {loading ? (
            <LoadingState label="Loading suppliers" rows={3} />
          ) : suppliers.length === 0 ? (
            <EmptyState
              title="No supplier profiles yet"
              description="Create the first internal supplier record to connect services, contacts, terms, and payables."
            />
          ) : (
            <div className="supplier-browser">
              <div className="supplier-tabs" role="list">
                {suppliers.map((supplier) => (
                  <button
                    type="button"
                    role="listitem"
                    className={
                      selectedSupplierId === supplier.id ? "selected" : ""
                    }
                    key={supplier.id}
                    onClick={() => setSelectedSupplierId(supplier.id)}
                  >
                    <span>{supplier.category || "Supplier"}</span>
                    <b>{supplier.name}</b>
                    <small>
                      {supplier.payment_terms_days === null
                        ? "Terms not recorded"
                        : `${supplier.payment_terms_days}-day terms`}
                    </small>
                  </button>
                ))}
              </div>

              {selectedSupplier ? (
                <article className="supplier-profile">
                  <header>
                    <div>
                      <p>{selectedSupplier.category || "TRAVEL SUPPLIER"}</p>
                      <h3>{selectedSupplier.name}</h3>
                    </div>
                    <span>{selectedSupplier.status.replace("_", " ")}</span>
                  </header>
                  <div className="supplier-facts">
                    <span>
                      <small>PRIMARY CONTACT</small>
                      <b>
                        {selectedSupplier.contact_name ||
                          selectedContacts.find((contact) => contact.is_primary)
                            ?.name ||
                          "Not recorded"}
                      </b>
                    </span>
                    <span>
                      <small>CURRENCY</small>
                      <b>{selectedSupplier.preferred_currency}</b>
                    </span>
                    <span>
                      <small>QUALITY</small>
                      <b>
                        {selectedSupplier.quality_rating
                          ? `${selectedSupplier.quality_rating}/5`
                          : "Not rated"}
                      </b>
                    </span>
                  </div>
                  <div className="supplier-contact-list">
                    <h4>Contacts</h4>
                    {selectedContacts.length === 0 ? (
                      <p>No named contacts recorded.</p>
                    ) : (
                      selectedContacts.map((contact) => (
                        <div key={contact.id}>
                          <span>
                            <b>{contact.name}</b>
                            <small>
                              {contact.role_title || "Supplier contact"}
                              {contact.is_primary ? " · Primary" : ""}
                            </small>
                          </span>
                          <span>
                            {contact.email || contact.phone || "No contact method"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="supplier-contract-list">
                    <h4>Contracts</h4>
                    {selectedContracts.length === 0 ? (
                      <p>No contract terms recorded.</p>
                    ) : (
                      selectedContracts.map((contract) => (
                        <div key={contract.id}>
                          <span>
                            <b>{contract.title}</b>
                            <small>
                              {contract.contract_reference || "No reference"}
                            </small>
                          </span>
                          <span className={`contract-status ${contract.status}`}>
                            {contract.status}
                          </span>
                          <small>
                            {contract.ends_on
                              ? `Ends ${shortDate(contract.ends_on)}`
                              : "Open ended"}
                          </small>
                        </div>
                      ))
                    )}
                  </div>
                </article>
              ) : null}
            </div>
          )}

          {canManageSuppliers && !loading ? (
            <div className="supplier-forms">
              <details>
                <summary>Create supplier profile</summary>
                <form onSubmit={submitSupplier}>
                  <label>
                    Supplier name
                    <input name="name" minLength={2} maxLength={180} required />
                  </label>
                  <label>
                    Supplier category
                    <input
                      name="category"
                      maxLength={120}
                      placeholder="Hotel, DMC, transfer..."
                    />
                  </label>
                  <label>
                    Main contact name
                    <input name="contactName" maxLength={180} />
                  </label>
                  <label>
                    Supplier email
                    <input name="email" type="email" maxLength={320} />
                  </label>
                  <label>
                    Supplier phone
                    <input name="phone" maxLength={40} />
                  </label>
                  <label>
                    Website
                    <input
                      name="website"
                      type="url"
                      maxLength={500}
                      placeholder="https://"
                    />
                  </label>
                  <label>
                    Preferred currency
                    <input
                      name="preferredCurrency"
                      defaultValue="INR"
                      pattern="[A-Z]{3}"
                      maxLength={3}
                      required
                    />
                  </label>
                  <label>
                    Payment terms (days)
                    <input
                      name="paymentTermsDays"
                      type="number"
                      min={0}
                      max={365}
                    />
                  </label>
                  <label>
                    Quality rating
                    <input
                      name="qualityRating"
                      type="number"
                      min={1}
                      max={5}
                      step={0.1}
                    />
                  </label>
                  <label className="wide">
                    Cancellation terms
                    <textarea name="cancellationTerms" maxLength={5000} />
                  </label>
                  <label className="wide">
                    Internal supplier notes
                    <textarea name="internalNotes" maxLength={5000} />
                  </label>
                  <button type="submit" disabled={pending}>
                    {pending ? "Saving..." : "Create supplier"}
                  </button>
                </form>
              </details>

              {suppliers.length > 0 ? (
                <>
                  <details>
                    <summary>Add supplier contact</summary>
                    <form onSubmit={submitSupplierContact}>
                      <label>
                        Contact supplier
                        <select
                          name="supplierId"
                          defaultValue={selectedSupplierId}
                          required
                        >
                          {suppliers.map((supplier) => (
                            <option value={supplier.id} key={supplier.id}>
                              {supplier.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Contact name
                        <input name="name" maxLength={180} required />
                      </label>
                      <label>
                        Role or team
                        <input name="roleTitle" maxLength={180} />
                      </label>
                      <label>
                        Contact email
                        <input name="email" type="email" maxLength={320} />
                      </label>
                      <label>
                        Contact phone
                        <input name="phone" maxLength={40} />
                      </label>
                      <label className="check">
                        <input name="isPrimary" type="checkbox" />
                        Primary contact
                      </label>
                      <label className="wide">
                        Contact notes
                        <textarea name="notes" maxLength={2000} />
                      </label>
                      <button type="submit" disabled={pending}>
                        {pending ? "Saving..." : "Add contact"}
                      </button>
                    </form>
                  </details>

                  <details>
                    <summary>Record supplier contract</summary>
                    <form onSubmit={submitSupplierContract}>
                      <label>
                        Contract supplier
                        <select
                          name="supplierId"
                          defaultValue={selectedSupplierId}
                          required
                        >
                          {suppliers.map((supplier) => (
                            <option value={supplier.id} key={supplier.id}>
                              {supplier.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Contract title
                        <input name="title" maxLength={180} required />
                      </label>
                      <label>
                        Contract reference
                        <input name="contractReference" maxLength={180} />
                      </label>
                      <label>
                        Internal status
                        <select name="status" defaultValue="draft">
                          <option value="draft">Draft record</option>
                          <option value="active">Active record</option>
                        </select>
                      </label>
                      <label>
                        Starts on
                        <input name="startsOn" type="date" />
                      </label>
                      <label>
                        Ends on
                        <input name="endsOn" type="date" />
                      </label>
                      <label>
                        Contract currency
                        <input
                          name="currency"
                          defaultValue="INR"
                          pattern="[A-Z]{3}"
                          maxLength={3}
                          required
                        />
                      </label>
                      <label>
                        Contract payment terms (days)
                        <input
                          name="paymentTermsDays"
                          type="number"
                          min={0}
                          max={365}
                        />
                      </label>
                      <label className="wide">
                        Contract cancellation terms
                        <textarea name="cancellationTerms" maxLength={5000} />
                      </label>
                      <label className="wide">
                        Internal contract notes
                        <textarea name="internalNotes" maxLength={5000} />
                      </label>
                      <button type="submit" disabled={pending}>
                        {pending ? "Saving..." : "Record contract"}
                      </button>
                    </form>
                  </details>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="ledger-create">
          <div>
            <p>CONTROLLED ENTRY</p>
            <h2>New obligation</h2>
            <span>
              Record what is due. Creating this item does not send an invoice or
              move money.
            </span>
          </div>
          {canManageFinance ? (
            <form onSubmit={submitPayment}>
              <label>
                Payment direction
                <select name="direction" defaultValue="receivable">
                  <option value="receivable">Customer receivable</option>
                  <option value="payable">Supplier payable</option>
                </select>
              </label>
              <label>
                Obligation title
                <input name="title" maxLength={180} required />
              </label>
              <div>
                <label>
                  Amount
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  Currency
                  <input
                    name="currency"
                    defaultValue="INR"
                    pattern="[A-Z]{3}"
                    maxLength={3}
                    required
                  />
                </label>
              </div>
              <label>
                Due date
                <input name="dueAt" type="date" />
              </label>
              <label>
                Related trip
                <select name="tripId" defaultValue="">
                  <option value="">No trip</option>
                  {trips.map((trip) => (
                    <option value={trip.id} key={trip.id}>
                      {trip.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Related opportunity
                <select name="dealId" defaultValue="">
                  <option value="">No opportunity</option>
                  {deals.map((deal) => (
                    <option value={deal.id} key={deal.id}>
                      {deal.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Supplier
                <select name="supplierId" defaultValue="">
                  <option value="">No supplier</option>
                  {suppliers.map((supplier) => (
                    <option value={supplier.id} key={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Invoice number
                <input name="invoiceNumber" maxLength={180} />
              </label>
              <label>
                Internal description
                <textarea name="description" maxLength={4000} />
              </label>
              <button type="submit" disabled={pending}>
                {pending ? "Recording..." : "Create obligation"}
              </button>
            </form>
          ) : (
            <p className="finance-readonly">
              Your role can inspect finance records. An owner, admin, or finance
              teammate records financial changes.
            </p>
          )}
        </aside>
      </section>

      {canManageFinance ? (
        <section
          className="invoice-readiness-workspace"
          aria-labelledby="invoice-readiness-title"
        >
          <header className="finance-section-heading">
            <div>
              <p>PRE-ISSUANCE CONTROL</p>
              <h2 id="invoice-readiness-title">Invoice draft readiness</h2>
              <span>
                Freeze customer-safe line and payment evidence before a legal
                number, issue date, or delivery channel is approved.
              </span>
            </div>
            <span>{invoiceDrafts.filter((draft) => draft.status === "ready").length} ready</span>
          </header>

          <div className="invoice-readiness-grid">
            <div className="invoice-control-stack">
              <form className="invoice-policy-form" onSubmit={submitInvoicePolicy}>
              <div>
                <small>NUMBER PREVIEW POLICY</small>
                <strong>
                  Next preview: {invoicePolicy
                    ? `${invoicePolicy.number_prefix}${String(invoicePolicy.next_number).padStart(invoicePolicy.number_padding, "0")}`
                    : "Unavailable"}
                </strong>
              </div>
              <label>
                Invoice number prefix
                <input
                  name="numberPrefix"
                  defaultValue={invoicePolicy?.number_prefix ?? "INV-"}
                  pattern={String.raw`[A-Z0-9][A-Z0-9\/\-]{0,23}`}
                  maxLength={24}
                  required
                />
              </label>
              <div>
                <label>
                  Next preview number
                  <input
                    name="nextNumber"
                    type="number"
                    min={1}
                    max={999999999}
                    defaultValue={invoicePolicy?.next_number ?? 1}
                    required
                  />
                </label>
                <label>
                  Number padding
                  <input
                    name="numberPadding"
                    type="number"
                    min={3}
                    max={10}
                    defaultValue={invoicePolicy?.number_padding ?? 4}
                    required
                  />
                </label>
              </div>
              <button type="submit" disabled={pending}>
                {pending ? "Saving..." : "Save preview policy"}
              </button>
              <small>
                Saving this policy does not reserve or allocate an invoice
                number. Issuance will require a separate exact-draft approval.
              </small>
              </form>

              <form className="invoice-policy-form" onSubmit={submitInvoiceIssuer}>
                <div>
                  <small>LEGAL ISSUER IDENTITY</small>
                  <strong>
                    {invoiceIssuerProfile?.legal_name ?? "Not configured"}
                  </strong>
                </div>
                <label>
                  Legal business name
                  <input
                    name="issuerLegalName"
                    defaultValue={invoiceIssuerProfile?.legal_name ?? ""}
                    minLength={2}
                    maxLength={180}
                    required
                  />
                </label>
                <label>
                  Registered address
                  <textarea
                    name="issuerRegisteredAddress"
                    defaultValue={
                      invoiceIssuerProfile?.registered_address ?? ""
                    }
                    minLength={10}
                    maxLength={500}
                    required
                  />
                </label>
                <div>
                  <label>
                    Country code
                    <input
                      name="issuerCountryCode"
                      defaultValue={
                        invoiceIssuerProfile?.jurisdiction_country_code ?? "IN"
                      }
                      pattern="[A-Za-z]{2}"
                      maxLength={2}
                      required
                    />
                  </label>
                  <label>
                    Tax registration ID
                    <input
                      name="issuerTaxId"
                      defaultValue={
                        invoiceIssuerProfile?.tax_registration_id ?? ""
                      }
                      maxLength={80}
                    />
                  </label>
                </div>
                <button type="submit" disabled={pending}>
                  {pending ? "Saving..." : "Save issuer identity"}
                </button>
                <small>
                  Taxed invoices require a tax-registration ID. Identity
                  changes expire older pending issuance reviews.
                </small>
              </form>
            </div>

            <div className="invoice-draft-list">
              {acceptedQuoteReceivableGroups.length === 0 ? (
                <EmptyState
                  title="No accepted quote is invoice-ready"
                  description="Create the accepted quote's exact receivables first. Structured lines and a reconciled payment schedule are also required."
                />
              ) : (
                acceptedQuoteReceivableGroups.map((group) => {
                  const draft = invoiceDrafts.find(
                    (candidate) =>
                      candidate.quote_id === group.quoteId &&
                      candidate.status !== "superseded",
                  );
                  const issuance = draft
                    ? invoiceIssuances.find(
                        (candidate) =>
                          candidate.invoice_draft_id === draft.id,
                      )
                    : null;
                  const invoiceDocument = issuance
                    ? invoiceDocuments.find(
                        (candidate) =>
                          candidate.invoice_issuance_id === issuance.id,
                      )
                    : null;
                  const approval = draft
                    ? invoiceApprovals.find(
                        (candidate) => candidate.entity_id === draft.id,
                      )
                    : null;
                  const policyCurrent =
                    draft?.status === "ready" && invoicePolicy
                      ? draft.number_policy_updated_at === invoicePolicy.updated_at
                      : false;
                  return (
                    <article className="invoice-draft-card" key={group.quoteId}>
                      <header>
                        <div>
                          <small>ACCEPTED QUOTE · {group.count} MILESTONES</small>
                          <strong>{money(group.total, group.currency)}</strong>
                        </div>
                        <Link href="/quotes">Source quote</Link>
                      </header>
                      {draft ? (
                        <>
                          <div className="invoice-draft-facts">
                            <span>
                              <small>
                                {issuance ? "ISSUED NUMBER" : "NUMBER PREVIEW"}
                              </small>
                              <b>
                                {issuance?.invoice_number ?? draft.number_preview}
                              </b>
                            </span>
                            <span>
                              <small>BILL TO</small>
                              <b>{draft.bill_to_name}</b>
                            </span>
                            <span>
                              <small>NET + TAX</small>
                              <b>
                                {money(draft.net_amount, draft.currency)} +{" "}
                                {money(draft.tax_amount, draft.currency)}
                              </b>
                            </span>
                            <span>
                              <small>EVIDENCE</small>
                              <b>
                                {draft.line_count} lines · {draft.payment_term_count}{" "}
                                terms
                              </b>
                            </span>
                          </div>
                          <p
                            className={
                              issuance || policyCurrent
                                ? "draft-current"
                                : "draft-stale"
                            }
                          >
                            Revision {draft.revision} · {issuance
                              ? "permanent issuance evidence recorded"
                              : policyCurrent
                                ? "current preview policy"
                                : "preview policy changed; prepare a new revision"}
                          </p>
                          {issuance ? (
                            <div className="invoice-issued-evidence">
                              <strong>
                                Issued {new Date(issuance.issued_at).toLocaleString()}
                              </strong>
                              <span>
                                {money(issuance.total_amount, issuance.currency)} ·
                                evidence {issuance.issuance_sha256.slice(0, 12)}…
                              </span>
                              <small>
                                Permanent number allocated. Customer delivery,
                                messaging, payment links and collection remain
                                separate controlled workflows.
                              </small>
                              {invoiceDocument ? (
                                <div className="invoice-document-evidence">
                                  <div>
                                    <span>PRIVATE PDF READY</span>
                                    <strong>{invoiceDocument.file_name}</strong>
                                    <small>
                                      {invoiceDocument.renderer_version} ·{" "}
                                      {Math.ceil(invoiceDocument.byte_size / 1024)} KB ·
                                      checksum {invoiceDocument.content_sha256.slice(0, 12)}…
                                    </small>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      downloadInvoiceDocument(invoiceDocument)
                                    }
                                    disabled={pending}
                                  >
                                    Secure PDF download
                                  </button>
                                  <p>
                                    Jurisdiction review required before external
                                    delivery.
                                  </p>
                                </div>
                              ) : (
                                <div className="invoice-document-readiness">
                                  <div>
                                    <span>DOCUMENT NOT RENDERED</span>
                                    <strong>
                                      Create a private operational invoice record
                                    </strong>
                                    <small>
                                      The PDF will be checksum-bound to this exact
                                      issuance and stored privately.
                                    </small>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      renderInvoiceDocument(issuance.id)
                                    }
                                    disabled={pending}
                                  >
                                    Render private invoice PDF
                                  </button>
                                  <p>
                                    Internal artifact only · jurisdiction review
                                    required · no customer delivery.
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : !policyCurrent ? (
                            <button
                              type="button"
                              onClick={() => prepareInvoiceDraft(group.quoteId)}
                              disabled={pending}
                            >
                              Prepare revised draft
                            </button>
                          ) : approval?.status === "approved" ? (
                            <div className="invoice-approval-state approved">
                              <span>Human approval recorded for this exact hash.</span>
                              <button
                                type="button"
                                onClick={() => issueInvoice(draft.id, approval.id)}
                                disabled={pending}
                              >
                                Allocate number and issue record
                              </button>
                              <small>
                                This irreversible step consumes {draft.number_preview}
                                atomically; it still performs no delivery or charge.
                              </small>
                            </div>
                          ) : approval?.status === "pending" ? (
                            <div className="invoice-approval-state pending">
                              <span>Waiting for a human issuance decision.</span>
                              <Link href="/aios#approval-queue">
                                Open AIOS approval queue
                              </Link>
                              <small>
                                Expires {approval.expires_at
                                  ? new Date(approval.expires_at).toLocaleString()
                                  : "after review"}
                              </small>
                            </div>
                          ) : invoiceIssuerProfile ? (
                            <form
                              className="invoice-approval-form"
                              onSubmit={(event) =>
                                submitInvoiceApproval(event, draft.id)
                              }
                            >
                              <label>
                                Issuance review rationale
                                <textarea
                                  name="issuanceRationale"
                                  defaultValue="Finance verified the accepted quote, customer totals, payment milestones, bill-to identity, and issuer identity."
                                  minLength={12}
                                  maxLength={1000}
                                  required
                                />
                              </label>
                              <button type="submit" disabled={pending}>
                                Request human issuance approval
                              </button>
                            </form>
                          ) : (
                            <p className="draft-stale">
                              Save the legal issuer identity before requesting
                              issuance approval.
                            </p>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => prepareInvoiceDraft(group.quoteId)}
                          disabled={pending}
                        >
                          Prepare exact invoice draft
                        </button>
                      )}
                      <small className="invoice-zero-effect">
                        {invoiceDocument
                          ? "Private rendering only · no delivery, customer message, payment link, charge, or settlement."
                          : issuance
                          ? "Issuance evidence only · no rendered document, delivery, message, payment link, charge, or settlement."
                          : "Internal evidence only · no legal number, document, delivery, message, charge, or settlement."}
                      </small>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>
      ) : null}

      <QuoteCatalogPanel
        organizationId={organizationId}
        canManage={canManageSuppliers}
        suppliers={suppliers.map(({ id, name }) => ({ id, name }))}
      />

      {canManageFinance ? (
        <section
          className="accounting-export"
          aria-labelledby="accounting-export-title"
        >
          <div>
            <p>ACCOUNTING HANDOFF</p>
            <h2 id="accounting-export-title">Export facts, not a second ledger.</h2>
            <span>
              Download every visible obligation and immutable settlement as
              separate formula-safe CSV rows. Currencies are never combined, and
              exact quote and issuance references stay attached.
            </span>
          </div>
          <dl>
            <div>
              <dt>Obligations</dt>
              <dd>{payments.length}</dd>
            </div>
            <div>
              <dt>Settlements</dt>
              <dd>{allocations.length}</dd>
            </div>
            <div>
              <dt>Currencies</dt>
              <dd>{new Set(payments.map((payment) => payment.currency)).size}</dd>
            </div>
          </dl>
          <button type="button" onClick={downloadAccountingLedger} disabled={loading}>
            Download accounting CSV
          </button>
          <small>
            Finance role only · includes internal identifiers and free-text ledger
            details · filters do not narrow the export · no accounting upload or
            external effect
          </small>
        </section>
      ) : null}

      <section className="payment-ledger" aria-labelledby="payment-ledger-title">
        <div className="finance-section-heading ledger-heading">
          <div>
            <p>RECONCILIATION QUEUE</p>
            <h2 id="payment-ledger-title">Receivables and payables</h2>
          </div>
          <span>{filteredPayments.length} shown</span>
        </div>
        <div className="ledger-controls">
          <div role="group" aria-label="Payment ledger filter">
            {(
              [
                ["open", "Open"],
                ["receivable", "Receivables"],
                ["payable", "Payables"],
                ["settled", "Settled"],
                ["all", "All"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                aria-pressed={filter === value}
                className={filter === value ? "selected" : ""}
                onClick={() => setFilter(value)}
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            <span>Search ledger</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, invoice, supplier..."
            />
          </label>
        </div>

        {loading ? (
          <LoadingState label="Loading payment ledger" rows={4} />
        ) : filteredPayments.length === 0 ? (
          <EmptyState
            title="No ledger items match"
            description="Create an internal obligation or choose a different ledger filter."
          />
        ) : (
          <div className="payment-list">
            {filteredPayments.map((payment) => {
              const outstanding = payment.amount - payment.paid_amount;
              const paymentAllocations = allocations.filter(
                (allocation) => allocation.payment_id === payment.id,
              );
              const supplier = suppliers.find(
                (candidate) => candidate.id === payment.supplier_id,
              );
              const trip = trips.find(
                (candidate) => candidate.id === payment.trip_id,
              );
              const paymentLinkDraft = paymentLinkDrafts.find(
                (candidate) =>
                  candidate.payment_id === payment.id &&
                  candidate.status === "ready",
              );
              const paymentLinkApproval = paymentLinkDraft
                ? paymentLinkApprovals.find(
                    (candidate) => candidate.entity_id === paymentLinkDraft.id,
                  )
                : null;
              const paymentLinkExecution = paymentLinkApproval
                ? paymentLinkExecutions.find(
                    (candidate) =>
                      candidate.approval_request_id === paymentLinkApproval.id,
                  )
                : null;
              const paymentLinkApprovalIsCurrent = Boolean(
                paymentLinkApproval &&
                  (!paymentLinkApproval.expires_at ||
                    new Date(paymentLinkApproval.expires_at).getTime() >
                      financeLoadedAt),
              );
              const paymentLinkExecutionIsCurrent = Boolean(
                paymentLinkExecution?.status === "active" &&
                  new Date(paymentLinkExecution.checkout_expires_at).getTime() >
                    financeLoadedAt,
              );
              const canPrepareCollection =
                canManageFinance &&
                payment.direction === "receivable" &&
                openStatuses.has(payment.status) &&
                Boolean(payment.invoice_issuance_id) &&
                outstanding > 0;
              return (
                <article
                  key={payment.id}
                  className={`payment-card ${payment.status}`}
                >
                  <header>
                    <div>
                      <span>
                        {payment.direction === "receivable"
                          ? "RECEIVABLE"
                          : "PAYABLE"}
                      </span>
                      <h3>{payment.title}</h3>
                      <p>
                        {supplier?.name || trip?.name || "Standalone obligation"}
                        {payment.invoice_number
                          ? ` · ${payment.invoice_number}`
                          : ""}
                      </p>
                    </div>
                    <span className={`payment-status ${payment.status}`}>
                      {payment.status.replace("_", " ")}
                    </span>
                  </header>
                  <div className="payment-balance">
                    <span>
                      <small>TOTAL</small>
                      <b>{money(payment.amount, payment.currency)}</b>
                    </span>
                    <span>
                      <small>RECORDED</small>
                      <b>{money(payment.paid_amount, payment.currency)}</b>
                    </span>
                    <span>
                      <small>OUTSTANDING</small>
                      <b>{money(outstanding, payment.currency)}</b>
                    </span>
                    <span>
                      <small>DUE</small>
                      <b>{shortDate(payment.due_at)}</b>
                    </span>
                  </div>
                  {payment.description ? (
                    <p className="payment-description">
                      {payment.description}
                    </p>
                  ) : null}
                  {payment.quote_acceptance_id ? (
                    <div className="quote-receivable-provenance">
                      <span>
                        ACCEPTED QUOTE · MILESTONE{" "}
                        {(payment.quote_schedule_item_position ?? 0) + 1}
                      </span>
                      <Link href="/quotes">Review quote evidence</Link>
                      <small>
                        Internal ledger record only · no invoice document was
                        issued or delivered.
                      </small>
                    </div>
                  ) : null}
                  {canPrepareCollection ? (
                    <section
                      className="payment-link-readiness"
                      aria-label={`Payment-link readiness for ${payment.title}`}
                    >
                      <div className="payment-link-heading">
                        <span>COLLECTION CONTROL</span>
                        <strong>
                          {paymentLinkDraft
                            ? `Exact balance ${money(paymentLinkDraft.requested_amount, paymentLinkDraft.currency)}`
                            : "Prepare an exact payment request"}
                        </strong>
                      </div>
                      {!paymentLinkDraft ? (
                        <>
                          <p>
                            Freeze this issued receivable&apos;s current full
                            outstanding balance before asking a human to approve
                            provider handoff.
                          </p>
                          <button
                            type="button"
                            onClick={() => prepareCollectionRequest(payment.id)}
                            disabled={pending}
                          >
                            Prepare exact payment request
                          </button>
                        </>
                      ) : paymentLinkExecution &&
                        paymentLinkExecutionIsCurrent ? (
                        <div className="payment-link-sandbox-active">
                          <span>SANDBOX LINK ACTIVE</span>
                          <strong>
                            Provider contract executed with zero real-money
                            authority.
                          </strong>
                          <Link
                            href={paymentLinkExecution.checkout_target}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open sandbox checkout
                          </Link>
                          <small>
                            {paymentLinkExecution.adapter_version} · reference{" "}
                            {paymentLinkExecution.provider_reference} · expires{" "}
                            {new Date(
                              paymentLinkExecution.checkout_expires_at,
                            ).toLocaleString()}
                          </small>
                        </div>
                      ) : paymentLinkApproval?.status === "approved" &&
                        paymentLinkApprovalIsCurrent ? (
                        <div className="payment-link-approved">
                          <span>Human approval recorded for this exact hash.</span>
                          <strong>Sandbox provider handoff ready</strong>
                          <p>
                            Execute the local adapter to test idempotency and the
                            checkout contract. It cannot contact a payment
                            provider or collect money.
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              createSandboxPaymentLink(
                                paymentLinkDraft.id,
                                paymentLinkApproval.id,
                              )
                            }
                            disabled={pending}
                          >
                            Create sandbox payment link
                          </button>
                        </div>
                      ) : paymentLinkExecution ? (
                        <div className="payment-link-expired">
                          <span>SANDBOX LINK NO LONGER ACTIVE</span>
                          <strong>A new human review is required.</strong>
                          <p>
                            The previous simulation expired or its receivable
                            evidence changed. Re-route the current exact draft.
                          </p>
                          <form
                            className="payment-link-approval-form"
                            onSubmit={(event) =>
                              submitPaymentLinkApproval(
                                event,
                                paymentLinkDraft.id,
                              )
                            }
                          >
                            <label>
                              Replacement review rationale
                              <textarea
                                name="paymentLinkRationale"
                                defaultValue="Finance re-verified the issued invoice, currency, due date, and exact current outstanding balance for a replacement sandbox link."
                                minLength={12}
                                maxLength={1000}
                                required
                              />
                            </label>
                            <button type="submit" disabled={pending}>
                              Request replacement approval
                            </button>
                          </form>
                        </div>
                      ) : paymentLinkApproval?.status === "pending" &&
                        paymentLinkApprovalIsCurrent ? (
                        <div className="payment-link-pending">
                          <span>Waiting for a finance human decision.</span>
                          <Link href="/aios#approval-queue">
                            Open AIOS approval queue
                          </Link>
                          <small>
                            Expires {paymentLinkApproval.expires_at
                              ? new Date(
                                  paymentLinkApproval.expires_at,
                                ).toLocaleString()
                              : "after review"}
                          </small>
                        </div>
                      ) : (
                        <form
                          className="payment-link-approval-form"
                          onSubmit={(event) =>
                            submitPaymentLinkApproval(
                              event,
                              paymentLinkDraft.id,
                            )
                          }
                        >
                          <label>
                            Collection review rationale
                            <textarea
                              name="paymentLinkRationale"
                              defaultValue="Finance verified the issued invoice, currency, due date, and exact current outstanding balance."
                              minLength={12}
                              maxLength={1000}
                              required
                            />
                          </label>
                          <button type="submit" disabled={pending}>
                            Request human payment-link approval
                          </button>
                        </form>
                      )}
                      {paymentLinkDraft ? (
                        <small className="payment-link-evidence">
                          Revision {paymentLinkDraft.revision} · invoice{" "}
                          {paymentLinkDraft.invoice_number} · evidence{" "}
                          {paymentLinkDraft.evidence_sha256.slice(0, 12)}…
                        </small>
                      ) : null}
                      <small className="payment-link-zero-effect">
                        {paymentLinkExecutionIsCurrent
                          ? "Sandbox URL only · zero provider network calls · no customer message · no real charge · no settlement"
                          : "No provider link · no customer message · no charge · no settlement"}
                      </small>
                    </section>
                  ) : null}
                  {paymentAllocations.length > 0 ? (
                    <div className="allocation-history">
                      <h4>Settlement evidence</h4>
                      {paymentAllocations.map((allocation) => (
                        <div key={allocation.id}>
                          <b>{money(allocation.amount, allocation.currency)}</b>
                          <span>
                            {allocation.reference ||
                              allocation.note ||
                              "Recorded evidence"}
                          </span>
                          <small>
                            {new Intl.DateTimeFormat("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            }).format(new Date(allocation.occurred_at))}
                          </small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {canManageFinance && openStatuses.has(payment.status) ? (
                    <div className="payment-actions">
                      <details>
                        <summary>Record settlement</summary>
                        <form
                          onSubmit={(event) =>
                            submitAllocation(event, payment)
                          }
                        >
                          <label>
                            Settlement amount for {payment.title}
                            <input
                              name="amount"
                              type="number"
                              min="0.01"
                              max={outstanding}
                              step="0.01"
                              required
                            />
                          </label>
                          <label>
                            Settlement reference for {payment.title}
                            <input name="reference" maxLength={180} />
                          </label>
                          <label>
                            Settlement note for {payment.title}
                            <input name="note" maxLength={500} />
                          </label>
                          <button type="submit" disabled={pending}>
                            {pending ? "Recording..." : "Record evidence"}
                          </button>
                        </form>
                      </details>
                      {payment.paid_amount === 0 ? (
                        <details>
                          <summary>Void obligation</summary>
                          <form
                            onSubmit={(event) => submitVoid(event, payment)}
                          >
                            <label>
                              Void reason for {payment.title}
                              <input name="reason" maxLength={500} required />
                            </label>
                            <button type="submit" disabled={pending}>
                              {pending ? "Voiding..." : "Void with evidence"}
                            </button>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                  {payment.status_note ? (
                    <p className="payment-note">{payment.status_note}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
