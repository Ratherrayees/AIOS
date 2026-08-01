"use client";

import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import {
  createQuoteCatalogProduct,
  publishQuoteCatalogRate,
  setQuoteCatalogProductStatus,
} from "../actions/crm";
import {
  buildEffectiveQuoteCatalog,
  type QuoteCatalogProduct,
  type QuoteCatalogRate,
} from "../../lib/crm/quote-catalog";
import { QUOTE_LINE_CATEGORIES } from "../../lib/crm/quote-pricing";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

type SupplierOption = { id: string; name: string };

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function text(form: FormData, name: string) {
  return String(form.get(name) || "").trim();
}

async function fetchCatalog(organizationId: string) {
  const supabase = createSupabaseBrowserClient();
  const [productResult, rateResult] = await Promise.all([
    supabase
      .from("quote_catalog_products")
      .select(
        "id, supplier_id, category, name, description, unit_label, currency, status",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("quote_catalog_rates")
      .select(
        "id, product_id, version, unit_sell_amount, unit_cost_amount, tax_percent, valid_from, valid_until",
      )
      .eq("organization_id", organizationId)
      .order("version", { ascending: false }),
  ]);
  if (productResult.error) throw productResult.error;
  if (rateResult.error) throw rateResult.error;
  return {
    products: (productResult.data ?? []) as QuoteCatalogProduct[],
    rates: (rateResult.data ?? []) as QuoteCatalogRate[],
  };
}

export function QuoteCatalogPanel({
  organizationId,
  canManage,
  suppliers,
}: {
  organizationId: string | null;
  canManage: boolean;
  suppliers: SupplierOption[];
}) {
  const [products, setProducts] = useState<QuoteCatalogProduct[]>([]);
  const [rates, setRates] = useState<QuoteCatalogRate[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  async function reload() {
    if (!organizationId) return;
    const catalog = await fetchCatalog(organizationId);
    setProducts(catalog.products);
    setRates(catalog.rates);
  }

  useEffect(() => {
    if (!organizationId) return;
    const load = async () => {
      const catalog = await fetchCatalog(organizationId);
      setProducts(catalog.products);
      setRates(catalog.rates);
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("The quote catalog could not be loaded.");
      setLoading(false);
    });
  }, [organizationId]);

  const effective = useMemo(
    () => buildEffectiveQuoteCatalog(products, rates),
    [products, rates],
  );
  const effectiveByProduct = useMemo(
    () => new Map(effective.map((item) => [item.id, item])),
    [effective],
  );
  const supplierNames = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  );

  function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      try {
        await createQuoteCatalogProduct({
          organizationId,
          supplierId: text(form, "supplierId") || null,
          category: text(form, "category") as (typeof QUOTE_LINE_CATEGORIES)[number],
          name: text(form, "name"),
          description: text(form, "description"),
          unitLabel: text(form, "unitLabel"),
          currency: text(form, "currency"),
          unitSellAmount: Number(form.get("unitSellAmount")),
          unitCostAmount: Number(form.get("unitCostAmount")),
          taxPercent: Number(form.get("taxPercent")),
          validFrom: text(form, "validFrom"),
          validUntil: text(form, "validUntil") || null,
        });
        await reload();
        formElement.reset();
        setNotice(
          "Reusable product and rate published internally. No supplier was contacted and no quote changed.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The reusable quote product could not be created.",
        );
      }
    });
  }

  function publishRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      try {
        const result = await publishQuoteCatalogRate({
          organizationId,
          productId: text(form, "productId"),
          unitSellAmount: Number(form.get("unitSellAmount")),
          unitCostAmount: Number(form.get("unitCostAmount")),
          taxPercent: Number(form.get("taxPercent")),
          validFrom: text(form, "validFrom"),
          validUntil: text(form, "validUntil") || null,
        });
        await reload();
        formElement.reset();
        setNotice(
          `Published immutable rate version ${result.rate_version}. Existing quote snapshots remain unchanged.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The new catalog rate could not be published.",
        );
      }
    });
  }

  function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      try {
        const product = await setQuoteCatalogProductStatus({
          organizationId,
          productId: text(form, "productId"),
          status: text(form, "status") as "active" | "archived",
          reason: text(form, "reason"),
        });
        await reload();
        formElement.reset();
        setNotice(
          `${product.name} is now ${product.status}. Historical quote snapshots and rate versions remain intact.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The catalog lifecycle could not be updated.",
        );
      }
    });
  }

  return (
    <section className="quote-catalog" aria-labelledby="quote-catalog-title">
      <header className="finance-section-heading">
        <div>
          <p>REUSABLE COMMERCIAL MEMORY</p>
          <h2 id="quote-catalog-title">Products and effective rates</h2>
        </div>
        <span>{products.filter((product) => product.status === "active").length} active</span>
      </header>
      <p className="quote-catalog-boundary">
        Rates are internal, immutable, and effective-dated. Adding one to a quote
        copies a versioned snapshot; later catalog changes never rewrite a quote.
      </p>
      {notice && (
        <p className="finance-notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p className="quote-catalog-empty">Loading reusable pricing…</p>
      ) : products.length === 0 ? (
        <p className="quote-catalog-empty">
          No reusable products yet. Start with a human-reviewed sell and cost rate.
        </p>
      ) : (
        <div className="quote-catalog-grid">
          {products.map((product) => {
            const current = effectiveByProduct.get(product.id);
            return (
              <article key={product.id} className={product.status}>
                <span>{product.category} · {product.currency}</span>
                <h3>{product.name}</h3>
                <p>{product.description}</p>
                <small>
                  {product.supplier_id
                    ? supplierNames.get(product.supplier_id) || "Linked supplier"
                    : "No supplier linked"}
                  {` · per ${product.unit_label}`}
                </small>
                {current ? (
                  <dl>
                    <div><dt>Sell</dt><dd>{money(current.unitSellAmount, product.currency)}</dd></div>
                    <div><dt>Cost</dt><dd>{money(current.unitCostAmount, product.currency)}</dd></div>
                    <div><dt>Tax</dt><dd>{current.taxPercent}%</dd></div>
                    <div><dt>Rate</dt><dd>v{current.rateVersion}</dd></div>
                  </dl>
                ) : (
                  <b>No rate effective today</b>
                )}
                <em>{product.status}</em>
              </article>
            );
          })}
        </div>
      )}
      {canManage && organizationId ? (
        <div className="quote-catalog-forms">
          <details>
            <summary>Create product and first rate</summary>
            <form onSubmit={createProduct}>
              <label>Product name<input name="name" maxLength={120} required /></label>
              <label>Category<select name="category" defaultValue="accommodation">{QUOTE_LINE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label className="wide">Quote description<input name="description" maxLength={180} required /></label>
              <label>Unit label<input name="unitLabel" defaultValue="unit" maxLength={40} required /></label>
              <label>Supplier<select name="supplierId" defaultValue=""><option value="">No supplier</option>{suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Currency<input name="currency" defaultValue="INR" pattern="[A-Z]{3}" maxLength={3} required /></label>
              <label>Unit sell<input name="unitSellAmount" type="number" min="0" step="0.01" required /></label>
              <label>Unit cost · protected<input name="unitCostAmount" type="number" min="0" step="0.01" required /></label>
              <label>Tax %<input name="taxPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></label>
              <label>Effective from<input name="validFrom" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
              <label>Effective until<input name="validUntil" type="date" /></label>
              <button type="submit" disabled={pending}>{pending ? "Publishing…" : "Create reusable product"}</button>
            </form>
          </details>
          {products.length > 0 && (
            <>
              <details>
                <summary>Publish a new immutable rate</summary>
                <form onSubmit={publishRate}>
                  <label className="wide">Product<select name="productId" required defaultValue=""><option value="" disabled>Select active product</option>{products.filter((product) => product.status === "active").map((product) => <option value={product.id} key={product.id}>{product.name} · {product.currency}</option>)}</select></label>
                  <label>Unit sell<input name="unitSellAmount" type="number" min="0" step="0.01" required /></label>
                  <label>Unit cost · protected<input name="unitCostAmount" type="number" min="0" step="0.01" required /></label>
                  <label>Tax %<input name="taxPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></label>
                  <label>Effective from<input name="validFrom" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
                  <label>Effective until<input name="validUntil" type="date" /></label>
                  <button type="submit" disabled={pending}>{pending ? "Publishing…" : "Publish rate version"}</button>
                </form>
              </details>
              <details>
                <summary>Archive or restore a product</summary>
                <form onSubmit={changeStatus}>
                  <label>Product<select name="productId" required>{products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>
                  <label>Status<select name="status"><option value="archived">Archived</option><option value="active">Active</option></select></label>
                  <label className="wide">Accountable reason<input name="reason" minLength={10} maxLength={500} required /></label>
                  <button type="submit" disabled={pending}>{pending ? "Saving…" : "Update lifecycle"}</button>
                </form>
              </details>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
