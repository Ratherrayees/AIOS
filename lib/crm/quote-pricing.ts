export const QUOTE_LINE_CATEGORIES = [
  "accommodation",
  "transport",
  "activity",
  "service",
  "fee",
  "other",
] as const;

export type QuoteLineCategory = (typeof QUOTE_LINE_CATEGORIES)[number];
export const MAX_QUOTE_AMOUNT = 999_999_999_999.99;

export type QuotePricingLineInput = {
  category: QuoteLineCategory;
  description: string;
  quantity: number;
  unitPriceAmount: number;
  unitCostAmount: number;
  discountAmount: number;
  taxPercent: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateQuotePricing(lines: QuotePricingLineInput[]) {
  const pricedLines = lines.map((line, position) => {
    const baseAmount = roundMoney(line.quantity * line.unitPriceAmount);
    const netAmount = roundMoney(baseAmount - line.discountAmount);
    const taxAmount = roundMoney((netAmount * line.taxPercent) / 100);
    const totalAmount = roundMoney(netAmount + taxAmount);
    const costAmount = roundMoney(line.quantity * line.unitCostAmount);
    return {
      ...line,
      position,
      baseAmount,
      netAmount,
      taxAmount,
      totalAmount,
      costAmount,
    };
  });
  const netSellAmount = roundMoney(
    pricedLines.reduce((sum, line) => sum + line.netAmount, 0),
  );
  const taxTotalAmount = roundMoney(
    pricedLines.reduce((sum, line) => sum + line.taxAmount, 0),
  );
  const customerTotalAmount = roundMoney(netSellAmount + taxTotalAmount);
  const estimatedCostAmount = roundMoney(
    pricedLines.reduce((sum, line) => sum + line.costAmount, 0),
  );
  const grossMarginAmount = roundMoney(
    netSellAmount - estimatedCostAmount,
  );
  const grossMarginPercent = netSellAmount
    ? Math.round((grossMarginAmount / netSellAmount) * 1_000_000) / 10_000
    : null;

  return {
    lines: pricedLines,
    customerTotalAmount,
    netSellAmount,
    taxTotalAmount,
    estimatedCostAmount,
    grossMarginAmount,
    grossMarginPercent,
    boundaries: {
      externalSharePerformed: false,
      supplierBookingPerformed: false,
      paymentMovementPerformed: false,
    },
  };
}
