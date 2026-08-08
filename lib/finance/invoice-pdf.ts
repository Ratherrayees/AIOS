import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { z } from "zod";

export const INVOICE_PDF_RENDERER_VERSION = "invoice-record-v1";
export const INVOICE_PDF_COMPLIANCE_STATUS =
  "jurisdiction_review_required" as const;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 44;
const BODY_BOTTOM = 64;

const lineItemSchema = z.object({
  position: z.number().int().min(0).max(49),
  category: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(180),
  quantity: z.number().positive(),
  unit_price_amount: z.number().nonnegative(),
  discount_amount: z.number().nonnegative(),
  tax_percent: z.number().min(0).max(100),
  net_amount: z.number().nonnegative(),
  tax_amount: z.number().nonnegative(),
  total_amount: z.number().nonnegative(),
});

const paymentTermSchema = z.object({
  kind: z.enum(["deposit", "installment", "balance"]),
  label: z.string().trim().min(1).max(120),
  amount: z.number().positive(),
  due_date: z.iso.date(),
});

const invoicePdfInputSchema = z.object({
  invoiceNumber: z.string().trim().min(4).max(40),
  issuedAt: z.iso.datetime({ offset: true }),
  issuanceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  issuerLegalName: z.string().trim().min(2).max(180),
  issuerRegisteredAddress: z.string().trim().min(10).max(500),
  issuerJurisdictionCountryCode: z.string().regex(/^[A-Z]{2}$/),
  issuerTaxRegistrationId: z.string().trim().min(2).max(80).nullable(),
  billToName: z.string().trim().min(2).max(180),
  currency: z.string().regex(/^[A-Z]{3}$/),
  netAmount: z.number().nonnegative(),
  taxAmount: z.number().nonnegative(),
  totalAmount: z.number().positive(),
  lineItems: z.array(lineItemSchema).min(1).max(50),
  paymentTerms: z.array(paymentTermSchema).min(1).max(12),
});

export type InvoicePdfInput = Omit<
  z.input<typeof invoicePdfInputSchema>,
  "lineItems" | "paymentTerms"
> & {
  lineItems: unknown;
  paymentTerms: unknown;
};

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
};

const palette = {
  ink: rgb(0.07, 0.09, 0.16),
  muted: rgb(0.34, 0.38, 0.48),
  line: rgb(0.86, 0.88, 0.93),
  panel: rgb(0.965, 0.97, 0.985),
  navy: rgb(0.055, 0.07, 0.15),
  violet: rgb(0.45, 0.31, 0.95),
  cyan: rgb(0.14, 0.75, 0.88),
  amber: rgb(0.96, 0.67, 0.15),
  amberPanel: rgb(1, 0.975, 0.89),
  white: rgb(1, 1, 1),
};

const characterFallbacks: Record<string, string> = {
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2022": "-",
  "\u2026": "...",
  "\u20b9": "INR ",
};

export function invoiceDocumentFilename(invoiceNumber: string) {
  const normalized = invoiceNumber
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 118);
  return `${normalized || "invoice"}.pdf`;
}

function pdfText(value: string) {
  const substituted = [...value]
    .map((character) => characterFallbacks[character] ?? character)
    .join("");
  return substituted
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function money(amount: number, currency: string) {
  return `${currency} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
  }).format(value);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = pdfText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      const next = `${fragment}${character}`;
      if (font.widthOfTextAtSize(next, size) > maxWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawRightText(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color = palette.ink,
) {
  const safeText = pdfText(text);
  page.drawText(safeText, {
    x: right - font.widthOfTextAtSize(safeText, size),
    y,
    font,
    size,
    color,
  });
}

function fittedTextSize(
  text: string,
  font: PDFFont,
  preferredSize: number,
  minimumSize: number,
  maxWidth: number,
) {
  const safeText = pdfText(text);
  let size = preferredSize;
  while (
    size > minimumSize &&
    font.widthOfTextAtSize(safeText, size) > maxWidth
  ) {
    size -= 0.5;
  }
  return size;
}

function drawWrapped(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
  color = palette.ink,
) {
  const lines = wrapText(text, font, size, maxWidth);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      font,
      size,
      color,
    });
  });
  return { lines, nextY: y - lines.length * lineHeight };
}

/**
 * Produces a stable, private invoice record from immutable issuance evidence.
 * It deliberately includes a jurisdiction-review notice and performs no
 * delivery or other external effect.
 */
export async function renderInvoicePdf(input: InvoicePdfInput) {
  const invoice = invoicePdfInputSchema.parse(input);
  const document = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
  };
  const evidenceDate = new Date(invoice.issuedAt);
  document.setTitle(`Invoice ${pdfText(invoice.invoiceNumber)}`);
  document.setAuthor(pdfText(invoice.issuerLegalName));
  document.setSubject("Internal invoice record - jurisdiction review required");
  document.setCreator("AIOS Travel CRM invoice renderer");
  document.setProducer(`AIOS Travel CRM ${INVOICE_PDF_RENDERER_VERSION}`);
  document.setKeywords([
    "invoice",
    "travel",
    "internal record",
    "jurisdiction review required",
  ]);
  document.setCreationDate(evidenceDate);
  document.setModificationDate(evidenceDate);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  function addPage(continued = false) {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: palette.white,
    });
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 8,
      width: PAGE_WIDTH,
      height: 8,
      color: palette.violet,
    });
    page.drawRectangle({
      x: PAGE_WIDTH * 0.72,
      y: PAGE_HEIGHT - 8,
      width: PAGE_WIDTH * 0.28,
      height: 8,
      color: palette.cyan,
    });
    if (continued) {
      page.drawText("AIOS TRAVEL CRM", {
        x: PAGE_MARGIN,
        y: PAGE_HEIGHT - 42,
        font: fonts.bold,
        size: 8,
        color: palette.violet,
      });
      drawRightText(
        page,
        `${invoice.invoiceNumber} - continued`,
        PAGE_WIDTH - PAGE_MARGIN,
        PAGE_HEIGHT - 42,
        fonts.bold,
        9,
      );
      page.drawLine({
        start: { x: PAGE_MARGIN, y: PAGE_HEIGHT - 54 },
        end: { x: PAGE_WIDTH - PAGE_MARGIN, y: PAGE_HEIGHT - 54 },
        thickness: 0.8,
        color: palette.line,
      });
      y = PAGE_HEIGHT - 78;
    } else {
      y = PAGE_HEIGHT - 44;
    }
    return page;
  }

  function ensureSpace(height: number) {
    if (y - height < BODY_BOTTOM) addPage(true);
  }

  addPage();

  page.drawText("AIOS TRAVEL CRM", {
    x: PAGE_MARGIN,
    y,
    font: fonts.bold,
    size: 9,
    color: palette.violet,
  });
  page.drawText("INTERNAL FINANCE ARTIFACT", {
    x: PAGE_MARGIN,
    y: y - 16,
    font: fonts.regular,
    size: 7.5,
    color: palette.muted,
  });
  drawRightText(
    page,
    "ISSUED RECORD",
    PAGE_WIDTH - PAGE_MARGIN,
    y,
    fonts.bold,
    8,
    palette.cyan,
  );
  y -= 58;
  page.drawText("INVOICE", {
    x: PAGE_MARGIN,
    y,
    font: fonts.bold,
    size: 29,
    color: palette.navy,
  });
  drawRightText(
    page,
    invoice.invoiceNumber,
    PAGE_WIDTH - PAGE_MARGIN,
    y + 4,
    fonts.bold,
    fittedTextSize(
      invoice.invoiceNumber,
      fonts.bold,
      15,
      8,
      PAGE_WIDTH - PAGE_MARGIN * 2 - 150,
    ),
    palette.violet,
  );
  drawRightText(
    page,
    `Issued ${invoice.issuedAt.slice(0, 10)}`,
    PAGE_WIDTH - PAGE_MARGIN,
    y - 14,
    fonts.regular,
    8,
    palette.muted,
  );
  y -= 40;
  page.drawLine({
    start: { x: PAGE_MARGIN, y },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y },
    thickness: 1,
    color: palette.line,
  });
  y -= 26;

  const columnWidth = (PAGE_WIDTH - PAGE_MARGIN * 2 - 28) / 2;
  page.drawText("FROM", {
    x: PAGE_MARGIN,
    y,
    font: fonts.bold,
    size: 7.5,
    color: palette.muted,
  });
  page.drawText("BILL TO", {
    x: PAGE_MARGIN + columnWidth + 28,
    y,
    font: fonts.bold,
    size: 7.5,
    color: palette.muted,
  });
  y -= 18;
  const issuerName = drawWrapped(
    page,
    invoice.issuerLegalName,
    PAGE_MARGIN,
    y,
    columnWidth,
    fonts.bold,
    10,
    12,
  );
  const billToName = drawWrapped(
    page,
    invoice.billToName,
    PAGE_MARGIN + columnWidth + 28,
    y,
    columnWidth,
    fonts.bold,
    10,
    12,
  );
  const namesNextY = Math.min(issuerName.nextY, billToName.nextY);
  const address = drawWrapped(
    page,
    invoice.issuerRegisteredAddress,
    PAGE_MARGIN,
    namesNextY - 4,
    columnWidth,
    fonts.regular,
    8.5,
    12,
    palette.muted,
  );
  const issuerFacts = [
    `Jurisdiction: ${invoice.issuerJurisdictionCountryCode}`,
    invoice.issuerTaxRegistrationId
      ? `Tax registration: ${invoice.issuerTaxRegistrationId}`
      : "Tax registration: not recorded",
  ];
  let issuerFactsY = address.nextY - 2;
  issuerFacts.forEach((fact) => {
    issuerFactsY = drawWrapped(
      page,
      fact,
      PAGE_MARGIN,
      issuerFactsY,
      columnWidth,
      fonts.regular,
      8,
      11,
      palette.muted,
    ).nextY;
  });
  y = Math.min(issuerFactsY - 14, billToName.nextY - 48);

  ensureSpace(74);
  page.drawText("LINE ITEMS", {
    x: PAGE_MARGIN,
    y,
    font: fonts.bold,
    size: 8,
    color: palette.violet,
  });
  y -= 18;
  const tableLeft = PAGE_MARGIN;
  const tableRight = PAGE_WIDTH - PAGE_MARGIN;
  const descriptionX = tableLeft + 8;
  const quantityRight = 350;
  const unitRight = 428;
  const taxRight = 474;
  const totalRight = tableRight - 8;

  function drawLineHeader() {
    page.drawRectangle({
      x: tableLeft,
      y: y - 20,
      width: tableRight - tableLeft,
      height: 24,
      color: palette.navy,
    });
    page.drawText("DESCRIPTION", {
      x: descriptionX,
      y: y - 12,
      font: fonts.bold,
      size: 7,
      color: palette.white,
    });
    drawRightText(page, "QTY", quantityRight, y - 12, fonts.bold, 7, palette.white);
    drawRightText(page, "UNIT", unitRight, y - 12, fonts.bold, 7, palette.white);
    drawRightText(page, "TAX", taxRight, y - 12, fonts.bold, 7, palette.white);
    drawRightText(page, "TOTAL", totalRight, y - 12, fonts.bold, 7, palette.white);
    y -= 26;
  }

  drawLineHeader();
  invoice.lineItems
    .slice()
    .sort((left, right) => left.position - right.position)
    .forEach((item) => {
      const descriptionLines = wrapText(
        item.description,
        fonts.regular,
        8.5,
        248,
      );
      const rowHeight = Math.max(32, descriptionLines.length * 11 + 18);
      if (y - rowHeight < BODY_BOTTOM) {
        addPage(true);
        page.drawText("LINE ITEMS", {
          x: PAGE_MARGIN,
          y,
          font: fonts.bold,
          size: 8,
          color: palette.violet,
        });
        y -= 18;
        drawLineHeader();
      }
      const rowTop = y;
      page.drawRectangle({
        x: tableLeft,
        y: rowTop - rowHeight + 4,
        width: tableRight - tableLeft,
        height: rowHeight,
        color:
          item.position % 2 === 0 ? palette.white : palette.panel,
      });
      descriptionLines.forEach((line, index) => {
        page.drawText(line, {
          x: descriptionX,
          y: rowTop - 10 - index * 11,
          font: index === 0 ? fonts.bold : fonts.regular,
          size: 8.5,
          color: palette.ink,
        });
      });
      page.drawText(pdfText(item.category.toUpperCase()), {
        x: descriptionX,
        y: rowTop - rowHeight + 10,
        font: fonts.regular,
        size: 6.5,
        color: palette.muted,
      });
      drawRightText(
        page,
        formatQuantity(item.quantity),
        quantityRight,
        rowTop - 10,
        fonts.regular,
        8,
      );
      drawRightText(
        page,
        money(item.unit_price_amount, invoice.currency),
        unitRight,
        rowTop - 10,
        fonts.regular,
        7.5,
      );
      drawRightText(
        page,
        `${formatQuantity(item.tax_percent)}%`,
        taxRight,
        rowTop - 10,
        fonts.regular,
        8,
      );
      drawRightText(
        page,
        money(item.total_amount, invoice.currency),
        totalRight,
        rowTop - 10,
        fonts.bold,
        7.5,
      );
      if (item.discount_amount > 0) {
        drawRightText(
          page,
          `Discount ${money(item.discount_amount, invoice.currency)}`,
          totalRight,
          rowTop - 23,
          fonts.regular,
          6.5,
          palette.muted,
        );
      }
      page.drawLine({
        start: { x: tableLeft, y: rowTop - rowHeight + 4 },
        end: { x: tableRight, y: rowTop - rowHeight + 4 },
        thickness: 0.5,
        color: palette.line,
      });
      y -= rowHeight;
    });

  ensureSpace(100);
  y -= 8;
  const totalsX = PAGE_WIDTH - PAGE_MARGIN - 216;
  const totalsRight = PAGE_WIDTH - PAGE_MARGIN;
  page.drawRectangle({
    x: totalsX,
    y: y - 82,
    width: totalsRight - totalsX,
    height: 88,
    color: palette.panel,
  });
  [
    ["Net", invoice.netAmount],
    ["Tax", invoice.taxAmount],
  ].forEach(([label, amount], index) => {
    page.drawText(String(label), {
      x: totalsX + 14,
      y: y - 18 - index * 22,
      font: fonts.regular,
      size: 8.5,
      color: palette.muted,
    });
    drawRightText(
      page,
      money(Number(amount), invoice.currency),
      totalsRight - 14,
      y - 18 - index * 22,
      fonts.regular,
      8.5,
    );
  });
  page.drawLine({
    start: { x: totalsX + 14, y: y - 55 },
    end: { x: totalsRight - 14, y: y - 55 },
    thickness: 0.8,
    color: palette.line,
  });
  page.drawText("TOTAL", {
    x: totalsX + 14,
    y: y - 72,
    font: fonts.bold,
    size: 10,
    color: palette.ink,
  });
  drawRightText(
    page,
    money(invoice.totalAmount, invoice.currency),
    totalsRight - 14,
    y - 72,
    fonts.bold,
    10,
    palette.violet,
  );
  y -= 106;

  ensureSpace(72);
  page.drawText("PAYMENT SCHEDULE", {
    x: PAGE_MARGIN,
    y,
    font: fonts.bold,
    size: 8,
    color: palette.violet,
  });
  y -= 18;
  invoice.paymentTerms.forEach((term, index) => {
    const labelLines = wrapText(term.label, fonts.bold, 8.5, 300);
    const rowHeight = Math.max(34, labelLines.length * 11 + 20);
    ensureSpace(rowHeight);
    page.drawCircle({
      x: PAGE_MARGIN + 5,
      y: y - 5,
      size: 3,
      color: index === invoice.paymentTerms.length - 1 ? palette.cyan : palette.violet,
    });
    labelLines.forEach((line, labelIndex) => {
      page.drawText(line, {
        x: PAGE_MARGIN + 18,
        y: y - 9 - labelIndex * 11,
        font: fonts.bold,
        size: 8.5,
        color: palette.ink,
      });
    });
    page.drawText(`${term.kind.toUpperCase()} - due ${term.due_date}`, {
      x: PAGE_MARGIN + 18,
      y: y - 10 - labelLines.length * 11,
      font: fonts.regular,
      size: 7,
      color: palette.muted,
    });
    drawRightText(
      page,
      money(term.amount, invoice.currency),
      PAGE_WIDTH - PAGE_MARGIN,
      y - 9,
      fonts.bold,
      8.5,
    );
    y -= rowHeight;
  });

  ensureSpace(124);
  y -= 6;
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: y - 72,
    width: PAGE_WIDTH - PAGE_MARGIN * 2,
    height: 78,
    color: palette.amberPanel,
    borderColor: palette.amber,
    borderWidth: 0.8,
  });
  page.drawText("JURISDICTION REVIEW REQUIRED", {
    x: PAGE_MARGIN + 14,
    y: y - 18,
    font: fonts.bold,
    size: 8,
    color: palette.ink,
  });
  drawWrapped(
    page,
    "This is an internal rendering of approved issuance evidence. Tax treatment, statutory wording, and external-delivery readiness must be reviewed for the issuer's jurisdiction before this document is sent to a customer.",
    PAGE_MARGIN + 14,
    y - 35,
    PAGE_WIDTH - PAGE_MARGIN * 2 - 28,
    fonts.regular,
    8,
    11,
    palette.muted,
  );
  y -= 92;
  page.drawText("SOURCE EVIDENCE", {
    x: PAGE_MARGIN,
    y,
    font: fonts.bold,
    size: 7,
    color: palette.muted,
  });
  drawWrapped(
    page,
    `Issuance SHA-256: ${invoice.issuanceSha256}`,
    PAGE_MARGIN,
    y - 14,
    PAGE_WIDTH - PAGE_MARGIN * 2,
    fonts.regular,
    7,
    10,
    palette.muted,
  );

  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: PAGE_MARGIN, y: 48 },
      end: { x: PAGE_WIDTH - PAGE_MARGIN, y: 48 },
      thickness: 0.5,
      color: palette.line,
    });
    currentPage.drawText(
      `Private finance artifact - no delivery or payment action performed`,
      {
        x: PAGE_MARGIN,
        y: 31,
        font: fonts.regular,
        size: 6.5,
        color: palette.muted,
      },
    );
    drawRightText(
      currentPage,
      `Page ${index + 1} of ${pages.length}`,
      PAGE_WIDTH - PAGE_MARGIN,
      31,
      fonts.regular,
      6.5,
      palette.muted,
    );
  });

  return document.save({ useObjectStreams: false });
}
