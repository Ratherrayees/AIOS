import assert from "node:assert/strict";
import test from "node:test";

import { calculateQuotePricing } from "../lib/crm/quote-pricing";

test("structured quote pricing separates customer total, tax, cost, and margin", () => {
  const result = calculateQuotePricing([
    {
      category: "accommodation",
      description: "Two rooms",
      quantity: 2,
      unitPriceAmount: 200000,
      unitCostAmount: 150000,
      discountAmount: 20000,
      taxPercent: 5,
    },
    {
      category: "activity",
      description: "Private experiences",
      quantity: 1,
      unitPriceAmount: 100000,
      unitCostAmount: 70000,
      discountAmount: 0,
      taxPercent: 5,
    },
  ]);

  assert.deepEqual(
    {
      customerTotalAmount: result.customerTotalAmount,
      netSellAmount: result.netSellAmount,
      taxTotalAmount: result.taxTotalAmount,
      estimatedCostAmount: result.estimatedCostAmount,
      grossMarginAmount: result.grossMarginAmount,
      grossMarginPercent: result.grossMarginPercent,
    },
    {
      customerTotalAmount: 504000,
      netSellAmount: 480000,
      taxTotalAmount: 24000,
      estimatedCostAmount: 370000,
      grossMarginAmount: 110000,
      grossMarginPercent: 22.9167,
    },
  );
});

test("structured quote pricing rounds each commercial line to currency precision", () => {
  const result = calculateQuotePricing([
    {
      category: "service",
      description: "Fractional service",
      quantity: 1.25,
      unitPriceAmount: 99.99,
      unitCostAmount: 70.01,
      discountAmount: 4.5,
      taxPercent: 18,
    },
  ]);

  assert.equal(result.lines[0].baseAmount, 124.99);
  assert.equal(result.lines[0].netAmount, 120.49);
  assert.equal(result.lines[0].taxAmount, 21.69);
  assert.equal(result.customerTotalAmount, 142.18);
  assert.equal(result.estimatedCostAmount, 87.51);
});

test("pricing calculations advertise their zero-side-effect boundary", () => {
  const result = calculateQuotePricing([]);
  assert.deepEqual(result.boundaries, {
    externalSharePerformed: false,
    supplierBookingPerformed: false,
    paymentMovementPerformed: false,
  });
});
