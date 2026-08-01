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
  createPaymentObligation,
  createSupplierContact,
  createSupplierContract,
  createSupplierProfile,
  recordPaymentAllocation,
  refreshPaymentStatuses,
  voidPaymentObligation,
} from "../actions/crm";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
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
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [filter, setFilter] = useState<LedgerFilter>("open");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
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
          "id, deal_id, trip_id, supplier_id, direction, status, title, invoice_number, description, amount, paid_amount, currency, due_at, paid_at, status_note, created_at",
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
    ]);

    const error =
      supplierResult.error ??
      contactResult.error ??
      contractResult.error ??
      paymentResult.error ??
      allocationResult.error ??
      tripResult.error ??
      dealResult.error;
    if (error) throw error;

    const nextSuppliers = (supplierResult.data ?? []) as Supplier[];
    setSuppliers(nextSuppliers);
    setSupplierContacts((contactResult.data ?? []) as SupplierContact[]);
    setSupplierContracts((contractResult.data ?? []) as SupplierContract[]);
    setPayments((paymentResult.data ?? []) as Payment[]);
    setAllocations((allocationResult.data ?? []) as PaymentAllocation[]);
    setTrips((tripResult.data ?? []) as TripOption[]);
    setDeals((dealResult.data ?? []) as DealOption[]);
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

          {canManageSuppliers ? (
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

      <QuoteCatalogPanel
        organizationId={organizationId}
        canManage={canManageSuppliers}
        suppliers={suppliers.map(({ id, name }) => ({ id, name }))}
      />

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
