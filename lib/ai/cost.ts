export function calculateModelCostEstimate(input: {
  inputTokens: number;
  outputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}) {
  const values = [
    input.inputTokens,
    input.outputTokens,
    input.inputPricePerMillion,
    input.outputPricePerMillion,
  ];
  if (
    values.some((value) => !Number.isFinite(value) || value < 0) ||
    !Number.isInteger(input.inputTokens) ||
    !Number.isInteger(input.outputTokens)
  ) {
    return null;
  }
  const amount =
    (input.inputTokens * input.inputPricePerMillion +
      input.outputTokens * input.outputPricePerMillion) /
    1_000_000;
  return Number(amount.toFixed(6));
}
