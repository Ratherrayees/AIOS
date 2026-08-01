export const QUOTE_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const MAX_QUOTE_PROPOSAL_ITEMS = 30;
export const MAX_QUOTE_PROPOSAL_ITEM_LENGTH = 300;

export type QuoteProposalContent = {
  schema_version: typeof QUOTE_PROPOSAL_SCHEMA_VERSION;
  inclusions: string[];
  exclusions: string[];
  terms: string[];
};

export const EMPTY_QUOTE_PROPOSAL: QuoteProposalContent = {
  schema_version: QUOTE_PROPOSAL_SCHEMA_VERSION,
  inclusions: [],
  exclusions: [],
  terms: [],
};

function boundedItems(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_QUOTE_PROPOSAL_ITEMS)
    return null;
  const items: string[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const item = candidate.trim();
    const identity = item.toLocaleLowerCase("en");
    if (
      !item ||
      candidate !== item ||
      item.length > MAX_QUOTE_PROPOSAL_ITEM_LENGTH ||
      identities.has(identity)
    )
      return null;
    identities.add(identity);
    items.push(item);
  }
  return items;
}

export function parseQuoteProposalContent(
  value: unknown,
): QuoteProposalContent {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return EMPTY_QUOTE_PROPOSAL;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    candidate.schema_version !== QUOTE_PROPOSAL_SCHEMA_VERSION ||
    keys.some(
      (key) =>
        !["schema_version", "inclusions", "exclusions", "terms"].includes(
          key,
        ),
    )
  )
    return EMPTY_QUOTE_PROPOSAL;
  const inclusions = boundedItems(candidate.inclusions);
  const exclusions = boundedItems(candidate.exclusions);
  const terms = boundedItems(candidate.terms);
  if (!inclusions || !exclusions || !terms) return EMPTY_QUOTE_PROPOSAL;
  return {
    schema_version: QUOTE_PROPOSAL_SCHEMA_VERSION,
    inclusions,
    exclusions,
    terms,
  };
}

export function isQuoteProposalContentReady(value: unknown) {
  const content = parseQuoteProposalContent(value);
  return content.inclusions.length > 0 && content.terms.length > 0;
}

export function splitQuoteProposalLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
