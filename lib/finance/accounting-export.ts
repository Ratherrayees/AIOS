export type AccountingExportPayment = {
  id: string;
  dealId: string | null;
  tripId: string | null;
  supplierId: string | null;
  direction: "receivable" | "payable";
  status: string;
  title: string;
  description: string | null;
  amount: number;
  paidAmount: number;
  currency: string;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  invoiceNumber: string | null;
  invoiceIssuanceId: string | null;
  quoteId: string | null;
  quoteVersionId: string | null;
  quoteAcceptanceId: string | null;
};

export type AccountingExportAllocation = {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  occurredAt: string;
  reference: string | null;
  note: string | null;
};

export type AccountingExportIssuance = {
  id: string;
  invoiceNumber: string;
  issuanceSha256: string;
};

export type AccountingExportInput = {
  generatedAt: Date;
  workspaceName: string;
  payments: AccountingExportPayment[];
  allocations: AccountingExportAllocation[];
  issuances: AccountingExportIssuance[];
  suppliers: Array<{ id: string; name: string }>;
  deals: Array<{ id: string; title: string }>;
  trips: Array<{ id: string; name: string }>;
};

export type AccountingExportRow = {
  record_type: string;
  record_id: string;
  parent_payment_id: string;
  direction: string;
  status: string;
  currency: string;
  amount: string | number;
  settled_amount: string | number;
  outstanding_amount: string | number;
  title: string;
  description: string;
  supplier_id: string;
  supplier_name: string;
  deal_id: string;
  deal_title: string;
  trip_id: string;
  trip_name: string;
  due_date: string;
  occurred_at: string;
  paid_at: string;
  invoice_issuance_id: string;
  invoice_number: string;
  issuance_sha256: string;
  quote_id: string;
  quote_version_id: string;
  quote_acceptance_id: string;
  settlement_reference: string;
  settlement_note: string;
  evidence_scope: string;
};

const headers: Array<keyof AccountingExportRow> = [
  "record_type",
  "record_id",
  "parent_payment_id",
  "direction",
  "status",
  "currency",
  "amount",
  "settled_amount",
  "outstanding_amount",
  "title",
  "description",
  "supplier_id",
  "supplier_name",
  "deal_id",
  "deal_title",
  "trip_id",
  "trip_name",
  "due_date",
  "occurred_at",
  "paid_at",
  "invoice_issuance_id",
  "invoice_number",
  "issuance_sha256",
  "quote_id",
  "quote_version_id",
  "quote_acceptance_id",
  "settlement_reference",
  "settlement_note",
  "evidence_scope",
];

function emptyRow(overrides: Partial<AccountingExportRow>): AccountingExportRow {
  return {
    record_type: "",
    record_id: "",
    parent_payment_id: "",
    direction: "",
    status: "",
    currency: "",
    amount: "",
    settled_amount: "",
    outstanding_amount: "",
    title: "",
    description: "",
    supplier_id: "",
    supplier_name: "",
    deal_id: "",
    deal_title: "",
    trip_id: "",
    trip_name: "",
    due_date: "",
    occurred_at: "",
    paid_at: "",
    invoice_issuance_id: "",
    invoice_number: "",
    issuance_sha256: "",
    quote_id: "",
    quote_version_id: "",
    quote_acceptance_id: "",
    settlement_reference: "",
    settlement_note: "",
    evidence_scope: "",
    ...overrides,
  };
}

function assertAmount(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative amount.`);
  }
}

function rounded(value: number) {
  return Number(value.toFixed(2));
}

export function buildAccountingExportRows({
  generatedAt,
  workspaceName,
  payments,
  allocations,
  issuances,
  suppliers,
  deals,
  trips,
}: AccountingExportInput): AccountingExportRow[] {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("The accounting export requires a valid generation time.");
  }

  const supplierNames = new Map(suppliers.map((item) => [item.id, item.name]));
  const dealNames = new Map(deals.map((item) => [item.id, item.title]));
  const tripNames = new Map(trips.map((item) => [item.id, item.name]));
  const issuanceById = new Map(issuances.map((item) => [item.id, item]));
  const paymentById = new Map(payments.map((item) => [item.id, item]));
  const rows: AccountingExportRow[] = [
    emptyRow({
      record_type: "export_metadata",
      record_id: "generated_at",
      title: "Generated at",
      occurred_at: generatedAt.toISOString(),
      evidence_scope: "browser_snapshot",
    }),
    emptyRow({
      record_type: "export_metadata",
      record_id: "workspace",
      title: "Workspace",
      description: workspaceName,
      evidence_scope: "current_tenant_rls",
    }),
    emptyRow({
      record_type: "export_metadata",
      record_id: "authority_boundary",
      title: "Read-only export boundary",
      description:
        "No accounting upload, payment, refund, message, invoice delivery, or provider action was performed.",
      evidence_scope: "human_download_only",
    }),
  ];

  for (const payment of [...payments].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )) {
    assertAmount(payment.amount, `Payment ${payment.id} amount`);
    assertAmount(payment.paidAmount, `Payment ${payment.id} settled amount`);
    if (payment.paidAmount > payment.amount) {
      throw new Error(`Payment ${payment.id} is settled beyond its obligation amount.`);
    }
    const issuance = payment.invoiceIssuanceId
      ? issuanceById.get(payment.invoiceIssuanceId)
      : null;
    if (payment.invoiceIssuanceId && !issuance) {
      throw new Error(`Payment ${payment.id} has unavailable invoice issuance evidence.`);
    }

    rows.push(
      emptyRow({
        record_type: "payment_obligation",
        record_id: payment.id,
        direction: payment.direction,
        status: payment.status,
        currency: payment.currency,
        amount: rounded(payment.amount),
        settled_amount: rounded(payment.paidAmount),
        outstanding_amount: rounded(payment.amount - payment.paidAmount),
        title: payment.title,
        description: payment.description ?? "",
        supplier_id: payment.supplierId ?? "",
        supplier_name: payment.supplierId
          ? (supplierNames.get(payment.supplierId) ?? "")
          : "",
        deal_id: payment.dealId ?? "",
        deal_title: payment.dealId ? (dealNames.get(payment.dealId) ?? "") : "",
        trip_id: payment.tripId ?? "",
        trip_name: payment.tripId ? (tripNames.get(payment.tripId) ?? "") : "",
        due_date: payment.dueAt ?? "",
        occurred_at: payment.createdAt,
        paid_at: payment.paidAt ?? "",
        invoice_issuance_id: payment.invoiceIssuanceId ?? "",
        invoice_number: issuance?.invoiceNumber ?? payment.invoiceNumber ?? "",
        issuance_sha256: issuance?.issuanceSha256 ?? "",
        quote_id: payment.quoteId ?? "",
        quote_version_id: payment.quoteVersionId ?? "",
        quote_acceptance_id: payment.quoteAcceptanceId ?? "",
        evidence_scope: payment.quoteAcceptanceId
          ? "exact_accepted_quote"
          : "manual_internal_obligation",
      }),
    );
  }

  for (const allocation of [...allocations].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
  )) {
    assertAmount(allocation.amount, `Allocation ${allocation.id} amount`);
    if (allocation.amount === 0) {
      throw new Error(`Allocation ${allocation.id} must be positive.`);
    }
    const payment = paymentById.get(allocation.paymentId);
    if (!payment) {
      throw new Error(`Allocation ${allocation.id} has no visible parent payment.`);
    }
    if (allocation.currency !== payment.currency) {
      throw new Error(`Allocation ${allocation.id} currency does not match its payment.`);
    }

    rows.push(
      emptyRow({
        record_type: "settlement_allocation",
        record_id: allocation.id,
        parent_payment_id: payment.id,
        direction: payment.direction,
        status: "recorded",
        currency: allocation.currency,
        amount: rounded(allocation.amount),
        title: `Settlement for ${payment.title}`,
        supplier_id: payment.supplierId ?? "",
        supplier_name: payment.supplierId
          ? (supplierNames.get(payment.supplierId) ?? "")
          : "",
        deal_id: payment.dealId ?? "",
        deal_title: payment.dealId ? (dealNames.get(payment.dealId) ?? "") : "",
        trip_id: payment.tripId ?? "",
        trip_name: payment.tripId ? (tripNames.get(payment.tripId) ?? "") : "",
        occurred_at: allocation.occurredAt,
        invoice_issuance_id: payment.invoiceIssuanceId ?? "",
        invoice_number:
          (payment.invoiceIssuanceId
            ? issuanceById.get(payment.invoiceIssuanceId)?.invoiceNumber
            : null) ?? payment.invoiceNumber ?? "",
        quote_id: payment.quoteId ?? "",
        quote_version_id: payment.quoteVersionId ?? "",
        quote_acceptance_id: payment.quoteAcceptanceId ?? "",
        settlement_reference: allocation.reference ?? "",
        settlement_note: allocation.note ?? "",
        evidence_scope: "immutable_settlement_evidence",
      }),
    );
  }

  return rows;
}

function csvCell(value: string | number) {
  let normalized = String(value).replace(/\0/g, "");
  if (/^[\t\r ]*[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function serializeAccountingExportCsv(rows: AccountingExportRow[]) {
  const header = headers.map((value) => csvCell(value)).join(",");
  const body = rows.map((item) =>
    headers.map((key) => csvCell(item[key])).join(","),
  );
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

export function createAccountingExportCsv(input: AccountingExportInput) {
  return serializeAccountingExportCsv(buildAccountingExportRows(input));
}

export function accountingExportFilename(generatedAt: Date) {
  return `aios-accounting-ledger-${generatedAt.toISOString().slice(0, 10)}.csv`;
}
