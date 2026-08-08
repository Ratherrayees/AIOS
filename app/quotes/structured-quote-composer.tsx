"use client";

import { useMemo, useState, useTransition } from "react";

import { reviseQuoteDraftWithLines } from "../actions/crm";
import {
  calculateQuotePricing,
  MAX_QUOTE_AMOUNT,
  QUOTE_LINE_CATEGORIES,
  type QuoteLineCategory,
} from "../../lib/crm/quote-pricing";
import type { EffectiveQuoteCatalogItem } from "../../lib/crm/quote-catalog";
import type { QuoteApprovalPolicy } from "../../lib/crm/quote-guardrails";

type DraftLine = {
  key: string;
  category: QuoteLineCategory;
  description: string;
  quantity: string;
  unitPriceAmount: string;
  unitCostAmount: string;
  discountAmount: string;
  taxPercent: string;
  catalogRateId: string | null;
  catalogName: string | null;
  catalogVersion: number | null;
  catalogUnitLabel: string | null;
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
    catalogRateId: null,
    catalogName: null,
    catalogVersion: null,
    catalogUnitLabel: null,
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
  catalogItems,
  commercialPolicy,
  onSaved,
  onNotice,
}: {
  organizationId: string;
  quoteId: string;
  currency: string;
  catalogItems: EffectiveQuoteCatalogItem[];
  commercialPolicy: QuoteApprovalPolicy;
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
        catalogRateId: line.catalogRateId,
      })),
    [lines],
  );
  const preview = useMemo(
    () => calculateQuotePricing(parsedLines),
    [parsedLines],
  );
  const commercialPreview = useMemo(() => {
    const markupAmount = preview.netSellAmount - preview.estimatedCostAmount;
    const markupPercent =
      preview.estimatedCostAmount > 0
        ? (markupAmount / preview.estimatedCostAmount) * 100
        : null;
    const commissionBase =
      commercialPolicy.commissionBasis === "net_sell"
        ? preview.netSellAmount
        : Math.max(markupAmount, 0);
    const commissionAmount =
      Math.round(
        ((commissionBase * commercialPolicy.commissionPercent) / 100) * 100,
      ) / 100;
    const postCommissionMarginAmount = markupAmount - commissionAmount;
    const postCommissionMarginPercent =
      preview.netSellAmount > 0
        ? (postCommissionMarginAmount / preview.netSellAmount) * 100
        : null;
    return {
      markupAmount,
      markupPercent,
      commissionAmount,
      postCommissionMarginAmount,
      postCommissionMarginPercent,
    };
  }, [commercialPolicy, preview]);
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

  function addCatalogLine(rateId: string) {
    const item = catalogItems.find((candidate) => candidate.rateId === rateId);
    if (!item) return;
    const catalogLine: DraftLine = {
      key: crypto.randomUUID(),
      category: item.category,
      description: item.description,
      quantity: "1",
      unitPriceAmount: String(item.unitSellAmount),
      unitCostAmount: String(item.unitCostAmount),
      discountAmount: "0",
      taxPercent: String(item.taxPercent),
      catalogRateId: item.rateId,
      catalogName: item.name,
      catalogVersion: item.rateVersion,
      catalogUnitLabel: item.unit_label,
    };
    setLines((current) => {
      const only = current[0];
      const replaceBlank =
        current.length === 1 &&
        only.description === "" &&
        only.unitPriceAmount === "0" &&
        only.unitCostAmount === "0";
      return replaceBlank ? [catalogLine] : [...current, catalogLine];
    });
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
      {catalogItems.length > 0 && (
        <label className="quote-composer-catalog">
          Add from current rate catalog
          <select
            aria-label="Add from current rate catalog"
            defaultValue=""
            onChange={(event) => {
              addCatalogLine(event.target.value);
              event.target.value = "";
            }}
          >
            <option value="" disabled>
              Select a reusable product
            </option>
            {catalogItems.map((item) => (
              <option value={item.rateId} key={item.rateId}>
                {item.name} · {money(item.unitSellAmount, currency)} / {item.unit_label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="quote-composer-lines">
        {lines.map((line, index) => (
          <fieldset key={line.key}>
            <legend>Line {index + 1}</legend>
            {line.catalogRateId && (
              <span className="quote-composer-source">
                Catalog snapshot · {line.catalogName} · rate v{line.catalogVersion}
              </span>
            )}
            <label>
              Category
              <select
                aria-label={`Category ${index + 1}`}
                value={line.category}
                disabled={Boolean(line.catalogRateId)}
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
                  value={String(
                    line[
                      field as
                        | "quantity"
                        | "unitPriceAmount"
                        | "unitCostAmount"
                        | "discountAmount"
                        | "taxPercent"
                    ],
                  )}
                  readOnly={
                    Boolean(line.catalogRateId) &&
                    ["unitPriceAmount", "unitCostAmount", "taxPercent"].includes(
                      field,
                    )
                  }
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
          <span>
            Markup {money(commercialPreview.markupAmount, currency)} ·{" "}
            {commercialPreview.markupPercent?.toFixed(1) ?? "N/A"}% on cost
          </span>
          <span>
            Commission estimate {money(commercialPreview.commissionAmount, currency)}
          </span>
          <strong>
            After commission{" "}
            {money(commercialPreview.postCommissionMarginAmount, currency)} ·{" "}
            {commercialPreview.postCommissionMarginPercent?.toFixed(1) ?? "N/A"}%
          </strong>
        </div>
        <button type="button" onClick={submit} disabled={pending || !valid}>
          {pending ? "Reconciling…" : "Save structured version"}
        </button>
      </div>
    </details>
  );
}
