"use client";

import { useMemo, useState, useTransition } from "react";

import { reviseQuoteProposalContent } from "../actions/crm";
import {
  MAX_QUOTE_PROPOSAL_ITEM_LENGTH,
  MAX_QUOTE_PROPOSAL_ITEMS,
  splitQuoteProposalLines,
  type QuoteProposalContent,
} from "../../lib/crm/quote-proposal";

type ProposalResult = Awaited<ReturnType<typeof reviseQuoteProposalContent>>;

export function QuoteProposalEditor({
  organizationId,
  quoteId,
  currentContent,
  onSaved,
  onNotice,
}: {
  organizationId: string;
  quoteId: string;
  currentContent: QuoteProposalContent;
  onSaved: (result: ProposalResult) => void;
  onNotice: (message: string) => void;
}) {
  const [inclusions, setInclusions] = useState(
    currentContent.inclusions.join("\n"),
  );
  const [exclusions, setExclusions] = useState(
    currentContent.exclusions.join("\n"),
  );
  const [terms, setTerms] = useState(currentContent.terms.join("\n"));
  const [pending, startTransition] = useTransition();
  const parsed = useMemo(
    () => ({
      inclusions: splitQuoteProposalLines(inclusions),
      exclusions: splitQuoteProposalLines(exclusions),
      terms: splitQuoteProposalLines(terms),
    }),
    [exclusions, inclusions, terms],
  );
  const allItems = [
    ...parsed.inclusions,
    ...parsed.exclusions,
    ...parsed.terms,
  ];
  const valid =
    parsed.inclusions.length > 0 &&
    parsed.terms.length > 0 &&
    [parsed.inclusions, parsed.exclusions, parsed.terms].every(
      (items) => items.length <= MAX_QUOTE_PROPOSAL_ITEMS,
    ) &&
    allItems.every((item) => item.length <= MAX_QUOTE_PROPOSAL_ITEM_LENGTH);

  function submit() {
    if (pending || !valid) return;
    startTransition(async () => {
      try {
        const result = await reviseQuoteProposalContent({
          organizationId,
          quoteId,
          ...parsed,
        });
        onSaved(result);
        onNotice(
          `Created customer-content version ${result.version.version}. Pricing and protected costs were copied exactly; nothing was shared.`,
        );
      } catch (error) {
        onNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save the proposal content.",
        );
      }
    });
  }

  return (
    <details className="quote-proposal-editor">
      <summary>Define proposal inclusions &amp; terms</summary>
      <p>
        One item per line. Saving creates a new immutable version and copies the
        exact current pricing snapshot. It never shares the quote.
      </p>
      <div className="quote-proposal-fields">
        <label>
          Inclusions · required
          <textarea
            aria-label="Proposal inclusions"
            value={inclusions}
            onChange={(event) => setInclusions(event.target.value)}
            placeholder={"Airport transfers\nDaily breakfast\nPrivate city guide"}
            rows={5}
          />
          <small>{parsed.inclusions.length}/{MAX_QUOTE_PROPOSAL_ITEMS} items</small>
        </label>
        <label>
          Exclusions · optional
          <textarea
            aria-label="Proposal exclusions"
            value={exclusions}
            onChange={(event) => setExclusions(event.target.value)}
            placeholder={"International flights\nPersonal expenses"}
            rows={5}
          />
          <small>{parsed.exclusions.length}/{MAX_QUOTE_PROPOSAL_ITEMS} items</small>
        </label>
        <label>
          Terms · required
          <textarea
            aria-label="Proposal terms"
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
            placeholder={"Subject to availability\nPrices remain valid until the quote expiry date"}
            rows={5}
          />
          <small>{parsed.terms.length}/{MAX_QUOTE_PROPOSAL_ITEMS} items</small>
        </label>
      </div>
      <button type="button" disabled={pending || !valid} onClick={submit}>
        {pending ? "Saving…" : "Save as new proposal version"}
      </button>
    </details>
  );
}
