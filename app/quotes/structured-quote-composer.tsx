"use client";

import { useMemo, useState, useTransition } from "react";

import { reviseQuoteDraftWithLines } from "../actions/crm";
import {
  calculateQuotePricing,
  MAX_QUOTE_AMOUNT,
  QUOTE_LINE_CATEGORIES,
  type QuoteLineCategory,
} from "../../lib/crm/quote-pricing";

type DraftLine = {
  key: string;
  category: QuoteLineCategory;
  description: string;
  quantity: string;
  unitPriceAmount: string;
  unitCostAmount: string;
  discountAmount: string;
  taxPercent: string;
};

type StructuredResult = Awaited<ReturnType<typeof reviseQuoteDraftWithLines>>;

function newLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    category: "accommodation",
    description: "",
    quantity: "1",
    unitPriceAmount: "0",
    unitCostAmount: "0",
    discountAmount: "0",
    taxPercent: "0",
  };
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function StructuredQuoteComposer({
  organizationId,
  quoteId,
  currency,
  onSaved,
  onNotice,
}: {
  organizationId: string;
  quoteId: string;
  currency: string;
  onSaved: (result: StructuredResult) => void;
  onNotice: (message: string) => void;
}) {
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [pending, startTransition] = useTransition();
  const parsedLines = useMemo(
    () =>
      lines.map((line) => ({
        category: line.category,
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitPriceAmount: Number(line.unitPriceAmount),
        unitCostAmount: Number(line.unitCostAmount),
        discountAmount: Number(line.discountAmount),
        taxPercent: Number(line.taxPercent),
      })),
    [lines],
  );
  const preview = useMemo(
    () => calculateQuotePricing(parsedLines),
    [parsedLines],
  );
  const valid = parsedLines.every(
    (line) =>
      line.description.length > 0 &&
      Number.isFinite(line.quantity) &&
      line.quantity > 0 &&
      Number.isFinite(line.unitPriceAmount) &&
      line.unitPriceAmount >= 0 &&
      Number.isFinite(line.unitCostAmount) &&
      line.unitCostAmount >= 0 &&
      Number.isFinite(line.discountAmount) &&
      line.discountAmount >= 0 &&
      line.discountAmount <= line.quantity * line.unitPriceAmount &&
      line.quantity * line.unitPriceAmount <= MAX_QUOTE_AMOUNT &&
      line.quantity * line.unitCostAmount <= MAX_QUOTE_AMOUNT &&
      Number.isFinite(line.taxPercent) &&
      line.taxPercent >= 0 &&
      line.taxPercent <= 100,
  ) &&
    preview.customerTotalAmount <= MAX_QUOTE_AMOUNT &&
    preview.netSellAmount <= MAX_QUOTE_AMOUNT &&
    preview.estimatedCostAmount <= MAX_QUOTE_AMOUNT;

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function submit() {
    if (pending || !valid) return;
    startTransition(async () => {
      try {
        const result = await reviseQuoteDraftWithLines({
          organizationId,
          quoteId,
          items: parsedLines,
        });
        onSaved(result);
        onNotice(
          `Created structured internal version ${result.summary.quote_version}. Every sell, tax, and cost amount reconciles; nothing was shared.`,
        );
      } catch (error) {
        onNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save the structured quote version.",
        );
      }
    });
  }

  return (
    <details className="quote-composer">
      <summary>Build itemized pricing</summary>
      <p>
        Customer sell lines and taxes are versioned separately from protected
        internal unit costs. Saving creates a new immutable version.
      </p>
      <div className="quote-composer-lines">
        {lines.map((line, index) => (
          <fieldset key={line.key}>
            <legend>Line {index + 1}</legend>
            <label>
              Category
              <select
                aria-label={`Category ${index + 1}`}
                value={line.category}
                onChange={(event) =>
                  updateLine(line.key, {
                    category: event.target.value as QuoteLineCategory,
                  })
                }
              >
                {QUOTE_LINE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="quote-composer-description">
              Description
              <input
                aria-label={`Description ${index + 1}`}
                value={line.description}
                maxLength={180}
                onChange={(event) =>
                  updateLine(line.key, { description: event.target.value })
                }
                placeholder="Hotel rooms and breakfast"
              />
            </label>
            {[
              ["Quantity", "quantity", "0.01"],
              ["Unit sell", "unitPriceAmount", "0.01"],
              ["Unit cost · internal", "unitCostAmount", "0.01"],
              ["Line discount", "discountAmount", "0.01"],
              ["Tax %", "taxPercent", "0.01"],
            ].map(([label, field, step]) => (
              <label key={field}>
                {label}
                <input
                  aria-label={`${label} ${index + 1}`}
                  type="number"
                  min={field === "quantity" ? "0.01" : "0"}
                  max={field === "taxPercent" ? "100" : undefined}
                  step={step}
                  value={line[field as keyof DraftLine]}
                  onChange={(event) =>
                    updateLine(line.key, { [field]: event.target.value })
                  }
                />
              </label>
            ))}
            {lines.length > 1 && (
              <button
                type="button"
                className="quote-composer-remove"
                onClick={() =>
                  setLines((current) =>
                    current.filter((item) => item.key !== line.key),
                  )
                }
              >
                Remove line {index + 1}
              </button>
            )}
          </fieldset>
        ))}
      </div>
      <div className="quote-composer-actions">
        <button
          type="button"
          onClick={() => setLines((current) => [...current, newLine()])}
          disabled={pending || lines.length >= 50}
        >
          Add line item
        </button>
        <div aria-label="Structured quote preview" className="quote-composer-preview">
          <span>Net sell {money(preview.netSellAmount, currency)}</span>
          <span>Tax {money(preview.taxTotalAmount, currency)}</span>
          <b>Customer total {money(preview.customerTotalAmount, currency)}</b>
          <span>Internal cost {money(preview.estimatedCostAmount, currency)}</span>
          <strong>
            Margin {money(preview.grossMarginAmount, currency)} ·{" "}
            {preview.grossMarginPercent?.toFixed(1) ?? "—"}%
          </strong>
        </div>
        <button type="button" onClick={submit} disabled={pending || !valid}>
          {pending ? "Reconciling…" : "Save structured version"}
        </button>
      </div>
    </details>
  );
}
