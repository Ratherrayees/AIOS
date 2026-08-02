import { z } from "zod";

export const QUOTE_PAYMENT_SCHEDULE_KINDS = [
  "deposit",
  "installment",
  "balance",
] as const;

export const MAX_QUOTE_PAYMENT_SCHEDULE_ITEMS = 12;
export const MAX_QUOTE_PAYMENT_LABEL_LENGTH = 120;

export const quotePaymentScheduleItemSchema = z.object({
  kind: z.enum(QUOTE_PAYMENT_SCHEDULE_KINDS),
  label: z.string().trim().min(1).max(MAX_QUOTE_PAYMENT_LABEL_LENGTH),
  amount: z.number().finite().positive().max(999_999_999_999.99),
  dueDate: z.iso.date(),
});

export const quotePaymentScheduleStoredItemSchema = z.object({
  kind: z.enum(QUOTE_PAYMENT_SCHEDULE_KINDS),
  label: z.string().trim().min(1).max(MAX_QUOTE_PAYMENT_LABEL_LENGTH),
  amount: z.number().finite().positive().max(999_999_999_999.99),
  due_date: z.iso.date(),
});

export function parseQuotePaymentScheduleItems(value: unknown) {
  const parsed = z
    .array(quotePaymentScheduleStoredItemSchema)
    .max(MAX_QUOTE_PAYMENT_SCHEDULE_ITEMS)
    .safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.map((item) => ({
    kind: item.kind,
    label: item.label,
    amount: item.amount,
    dueDate: item.due_date,
  }));
}

export const quotePaymentScheduleItemsSchema = z
  .array(quotePaymentScheduleItemSchema)
  .min(1)
  .max(MAX_QUOTE_PAYMENT_SCHEDULE_ITEMS)
  .superRefine((items, context) => {
    const labels = new Set<string>();
    let previousDueDate = "";
    let depositCount = 0;
    let balanceCount = 0;

    items.forEach((item, index) => {
      const identity = item.label.toLocaleLowerCase("en");
      if (labels.has(identity))
        context.addIssue({
          code: "custom",
          path: [index, "label"],
          message: "Payment milestone labels must be unique.",
        });
      labels.add(identity);

      if (previousDueDate && item.dueDate < previousDueDate)
        context.addIssue({
          code: "custom",
          path: [index, "dueDate"],
          message: "Payment due dates cannot move backwards.",
        });
      previousDueDate = item.dueDate;

      if (item.kind === "deposit") {
        depositCount += 1;
        if (index !== 0)
          context.addIssue({
            code: "custom",
            path: [index, "kind"],
            message: "A deposit must be the first milestone.",
          });
      }
      if (item.kind === "balance") {
        balanceCount += 1;
        if (index !== items.length - 1)
          context.addIssue({
            code: "custom",
            path: [index, "kind"],
            message: "The balance must be the final milestone.",
          });
      }
    });

    if (depositCount > 1)
      context.addIssue({
        code: "custom",
        message: "A payment schedule can have only one deposit.",
      });
    if (balanceCount !== 1)
      context.addIssue({
        code: "custom",
        message: "A payment schedule needs exactly one final balance.",
      });
  });

export type QuotePaymentScheduleItem = z.infer<
  typeof quotePaymentScheduleItemSchema
>;

export type QuotePaymentScheduleEvidence = {
  quoteStatus: "draft" | "shared" | "accepted" | "rejected" | "expired" | "superseded";
  quoteVersionId: string;
  quoteTotalAmount: number;
  schedule:
    | {
        quoteVersionId: string;
        totalAmount: number;
        items: QuotePaymentScheduleItem[];
      }
    | null;
};

export function assessQuoteInvoiceReadiness(
  evidence: QuotePaymentScheduleEvidence,
) {
  if (!evidence.schedule)
    return {
      code: "schedule_missing" as const,
      label: "Payment schedule needed",
      ready: false,
    };
  if (evidence.schedule.quoteVersionId !== evidence.quoteVersionId)
    return {
      code: "schedule_stale" as const,
      label: "Reconcile schedule with this version",
      ready: false,
    };

  const scheduledAmount = Math.round(
    evidence.schedule.items.reduce((sum, item) => sum + item.amount, 0) * 100,
  ) / 100;
  if (
    Math.round(evidence.schedule.totalAmount * 100) !==
      Math.round(evidence.quoteTotalAmount * 100) ||
    Math.round(scheduledAmount * 100) !==
      Math.round(evidence.quoteTotalAmount * 100)
  )
    return {
      code: "schedule_unreconciled" as const,
      label: "Schedule does not match the quote total",
      ready: false,
    };

  if (evidence.quoteStatus !== "accepted")
    return {
      code: "ready_after_acceptance" as const,
      label: "Schedule ready · invoice after acceptance",
      ready: false,
    };

  return {
    code: "invoice_ready" as const,
    label: "Accepted schedule is invoice-ready",
    ready: true,
  };
}
