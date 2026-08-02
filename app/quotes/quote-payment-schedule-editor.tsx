"use client";

import { useState, useTransition } from "react";

import { saveQuotePaymentSchedule } from "../actions/crm";
import {
  MAX_QUOTE_PAYMENT_SCHEDULE_ITEMS,
  quotePaymentScheduleItemsSchema,
  type QuotePaymentScheduleItem,
} from "../../lib/crm/quote-payment-schedule";

type ScheduleEvidence = {
  id: string;
  quote_version_id: string;
  revision: number;
  total_amount: number;
  items: QuotePaymentScheduleItem[];
};

type Props = {
  organizationId: string;
  quoteId: string;
  quoteVersionId: string;
  quoteTotalAmount: number;
  currency: string;
  validUntil: string | null;
  schedule: ScheduleEvidence | null;
  onSaved: (schedule: {
    id: string;
    quote_id: string;
    quote_version_id: string;
    revision: number;
    status: string;
    currency: string;
    total_amount: number;
    items: unknown;
    item_count: number;
    content_sha256: string;
  }) => void;
  onNotice: (message: string) => void;
};

function currencyAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function defaultItems(total: number, validUntil: string | null) {
  const deposit = Math.round(total * 0.3 * 100) / 100;
  const today = todayDate();
  const balanceDate = validUntil && validUntil >= today ? validUntil : today;
  return [
    { kind: "deposit" as const, label: "Booking deposit", amount: deposit, dueDate: today },
    {
      kind: "balance" as const,
      label: "Final balance",
      amount: Math.round((total - deposit) * 100) / 100,
      dueDate: balanceDate,
    },
  ];
}

export function QuotePaymentScheduleEditor({
  organizationId,
  quoteId,
  quoteVersionId,
  quoteTotalAmount,
  currency,
  validUntil,
  schedule,
  onSaved,
  onNotice,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<QuotePaymentScheduleItem[]>(
    schedule?.items.length
      ? schedule.items
      : defaultItems(quoteTotalAmount, validUntil),
  );
  const scheduledTotal = Math.round(
    items.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100,
  ) / 100;
  const reconciled =
    quoteTotalAmount > 0 &&
    Math.round(scheduledTotal * 100) === Math.round(quoteTotalAmount * 100);
  const scheduleValidation = quotePaymentScheduleItemsSchema.safeParse(items);
  const scheduleReady = reconciled && scheduleValidation.success;
  const validationMessage = scheduleValidation.success
    ? null
    : scheduleValidation.error.issues[0]?.message;
  const boundToCurrentVersion =
    schedule?.quote_version_id === quoteVersionId;

  function updateItem(
    index: number,
    field: keyof QuotePaymentScheduleItem,
    value: string,
  ) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: field === "amount" ? Number(value) : value,
            }
          : item,
      ),
    );
  }

  function addItem() {
    if (items.length >= MAX_QUOTE_PAYMENT_SCHEDULE_ITEMS) return;
    const balanceIndex = items.findIndex((item) => item.kind === "balance");
    const next = {
      kind: "installment" as const,
      label: `Installment ${Math.max(1, items.length - 1)}`,
      amount: 0,
      dueDate: items[Math.max(0, items.length - 1)]?.dueDate || todayDate(),
    };
    setItems((current) => {
      const position = balanceIndex < 0 ? current.length : balanceIndex;
      return [...current.slice(0, position), next, ...current.slice(position)];
    });
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function saveSchedule() {
    if (!scheduleReady) return;
    startTransition(async () => {
      try {
        const saved = await saveQuotePaymentSchedule({
          organizationId,
          quoteId,
          items,
        });
        onSaved(saved);
        onNotice(
          `Payment schedule revision ${saved.revision} saved for the exact current quote.`,
        );
      } catch (error) {
        onNotice(
          error instanceof Error
            ? error.message
            : "The payment schedule could not be saved.",
        );
      }
    });
  }

  return (
    <details className="quote-payment-schedule" open={!boundToCurrentVersion}>
      <summary>
        <span>
          <b>Customer payment schedule</b>
          <small>
            {schedule
              ? `Revision ${schedule.revision} · ${schedule.items.length} milestone${schedule.items.length === 1 ? "" : "s"}`
              : "Not configured"}
          </small>
        </span>
        <em>{boundToCurrentVersion ? "Exact version" : "Needs reconciliation"}</em>
      </summary>
      <div className="quote-payment-boundary">
        Terms only · no invoice, receivable, payment collection, or customer
        message is created here.
      </div>
      <div className="quote-payment-items">
        {items.map((item, index) => (
          <fieldset key={`${index}-${item.kind}`}>
            <legend>Milestone {index + 1}</legend>
            <label>
              Type
              <select
                aria-label={`Payment type ${index + 1}`}
                value={item.kind}
                onChange={(event) => updateItem(index, "kind", event.target.value)}
              >
                <option value="deposit">Deposit</option>
                <option value="installment">Installment</option>
                <option value="balance">Balance</option>
              </select>
            </label>
            <label>
              Customer label
              <input
                aria-label={`Payment label ${index + 1}`}
                value={item.label}
                maxLength={120}
                onChange={(event) => updateItem(index, "label", event.target.value)}
              />
            </label>
            <label>
              Amount
              <input
                aria-label={`Payment amount ${index + 1}`}
                type="number"
                min="0.01"
                max="999999999999.99"
                step="0.01"
                value={item.amount}
                onChange={(event) => updateItem(index, "amount", event.target.value)}
              />
            </label>
            <label>
              Due date
              <input
                aria-label={`Payment due date ${index + 1}`}
                type="date"
                value={item.dueDate}
                onChange={(event) => updateItem(index, "dueDate", event.target.value)}
              />
            </label>
            {items.length > 1 && (
              <button type="button" onClick={() => removeItem(index)}>
                Remove milestone {index + 1}
              </button>
            )}
          </fieldset>
        ))}
      </div>
      <footer>
        <div className={scheduleReady ? "is-reconciled" : "is-unreconciled"}>
          <span>Scheduled</span>
          <b>{currencyAmount(scheduledTotal, currency)}</b>
          <small>
            Quote total {currencyAmount(quoteTotalAmount, currency)} ·{" "}
            {!reconciled
              ? "adjust milestones to match"
              : validationMessage || "reconciled"}
          </small>
        </div>
        <button
          type="button"
          onClick={addItem}
          disabled={pending || items.length >= MAX_QUOTE_PAYMENT_SCHEDULE_ITEMS}
        >
          Add installment
        </button>
        <button
          type="button"
          onClick={saveSchedule}
          disabled={pending || !scheduleReady || quoteTotalAmount <= 0}
        >
          {pending ? "Saving…" : "Save exact payment schedule"}
        </button>
      </footer>
    </details>
  );
}
