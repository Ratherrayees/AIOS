"use client";

export function PrintProposalButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      Print or save PDF
    </button>
  );
}
