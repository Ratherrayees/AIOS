import type { QuoteLineCategory } from "./quote-pricing";

export type QuoteCatalogProduct = {
  id: string;
  supplier_id: string | null;
  category: QuoteLineCategory;
  name: string;
  description: string;
  unit_label: string;
  currency: string;
  status: "active" | "archived";
};

export type QuoteCatalogRate = {
  id: string;
  product_id: string;
  version: number;
  unit_sell_amount: number;
  unit_cost_amount: number;
  tax_percent: number;
  valid_from: string;
  valid_until: string | null;
};

export type EffectiveQuoteCatalogItem = QuoteCatalogProduct & {
  rateId: string;
  rateVersion: number;
  unitSellAmount: number;
  unitCostAmount: number;
  taxPercent: number;
  validFrom: string;
  validUntil: string | null;
};

export function buildEffectiveQuoteCatalog(
  products: QuoteCatalogProduct[],
  rates: QuoteCatalogRate[],
  options: { currency?: string; on?: string } = {},
) {
  const on = options.on ?? new Date().toISOString().slice(0, 10);
  const currency = options.currency?.trim().toUpperCase();
  const ratesByProduct = new Map<string, QuoteCatalogRate[]>();
  for (const rate of rates) {
    if (rate.valid_from > on || (rate.valid_until && rate.valid_until < on))
      continue;
    const current = ratesByProduct.get(rate.product_id) ?? [];
    current.push(rate);
    ratesByProduct.set(rate.product_id, current);
  }

  return products
    .filter(
      (product) =>
        product.status === "active" &&
        (!currency || product.currency === currency),
    )
    .flatMap((product) => {
      const rate = (ratesByProduct.get(product.id) ?? []).sort(
        (left, right) =>
          right.valid_from.localeCompare(left.valid_from) ||
          right.version - left.version,
      )[0];
      if (!rate) return [];
      return [
        {
          ...product,
          rateId: rate.id,
          rateVersion: rate.version,
          unitSellAmount: rate.unit_sell_amount,
          unitCostAmount: rate.unit_cost_amount,
          taxPercent: rate.tax_percent,
          validFrom: rate.valid_from,
          validUntil: rate.valid_until,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.name.localeCompare(right.name),
    );
}
