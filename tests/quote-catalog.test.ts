import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEffectiveQuoteCatalog,
  type QuoteCatalogProduct,
  type QuoteCatalogRate,
} from "../lib/crm/quote-catalog";

const product: QuoteCatalogProduct = {
  id: "product-1",
  supplier_id: "supplier-1",
  category: "accommodation",
  name: "Heritage room",
  description: "Room with breakfast",
  unit_label: "room night",
  currency: "INR",
  status: "active",
};

const rates: QuoteCatalogRate[] = [
  {
    id: "rate-1",
    product_id: product.id,
    version: 1,
    unit_sell_amount: 20_000,
    unit_cost_amount: 15_000,
    tax_percent: 5,
    valid_from: "2026-01-01",
    valid_until: null,
  },
  {
    id: "rate-2",
    product_id: product.id,
    version: 2,
    unit_sell_amount: 22_000,
    unit_cost_amount: 16_000,
    tax_percent: 5,
    valid_from: "2026-09-01",
    valid_until: null,
  },
];

test("quote catalog selects the latest rate effective on the quote date", () => {
  const before = buildEffectiveQuoteCatalog([product], rates, {
    on: "2026-08-01",
    currency: "INR",
  });
  const after = buildEffectiveQuoteCatalog([product], rates, {
    on: "2026-09-01",
    currency: "INR",
  });

  assert.equal(before[0]?.rateId, "rate-1");
  assert.equal(after[0]?.rateId, "rate-2");
});

test("quote catalog excludes archived, expired, future, and wrong-currency choices", () => {
  assert.deepEqual(
    buildEffectiveQuoteCatalog(
      [product],
      [{ ...rates[0], valid_until: "2026-07-31" }],
      { on: "2026-08-01", currency: "INR" },
    ),
    [],
  );
  assert.deepEqual(
    buildEffectiveQuoteCatalog([{ ...product, status: "archived" }], rates, {
      on: "2026-08-01",
      currency: "INR",
    }),
    [],
  );
  assert.deepEqual(
    buildEffectiveQuoteCatalog([product], rates, {
      on: "2026-08-01",
      currency: "USD",
    }),
    [],
  );
});

test("effective catalog results retain supplier and immutable rate provenance", () => {
  const [result] = buildEffectiveQuoteCatalog([product], rates, {
    on: "2026-08-01",
  });

  assert.equal(result.supplier_id, "supplier-1");
  assert.equal(result.rateVersion, 1);
  assert.equal(result.unitCostAmount, 15_000);
});
