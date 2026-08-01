"use client";

export function PrintQuoteButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      Print or save PDF
    </button>
  );
}
