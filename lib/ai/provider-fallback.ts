import type { ModelProvider } from "../env";

export const TRANSIENT_PROVIDER_STATUSES = new Set([
  408,
  409,
  425,
  429,
  500,
  502,
  503,
  504,
]);

export function isTransientProviderStatus(status: number | null | undefined) {
  return status !== null && status !== undefined
    ? TRANSIENT_PROVIDER_STATUSES.has(status)
    : false;
}

export function isTransientProviderFailure(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return isTransientProviderStatus(status);
  }
  if (!(error instanceof Error)) return false;
  return [
    "AbortError",
    "AiosProviderNetworkError",
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "TimeoutError",
  ].includes(error.name);
}

export function validFallbackProvider(input: {
  primary: ModelProvider;
  fallback: ModelProvider | null;
  allowedProviders: readonly ModelProvider[];
}) {
  return (
    input.fallback === null ||
    (input.fallback !== input.primary &&
      input.allowedProviders.includes(input.fallback))
  );
}

export async function executeProviderRoute<T>(input: {
  primary: ModelProvider;
  fallback?: ModelProvider | null;
  fallbacks?: readonly ModelProvider[];
  execute: (provider: ModelProvider) => Promise<T>;
  isTransientFailure: (error: unknown) => boolean;
}) {
  const fallbacks = input.fallbacks ?? (input.fallback ? [input.fallback] : []);
  if (fallbacks.includes(input.primary))
    throw new Error("Fallback providers must differ from the primary.");
  if (new Set(fallbacks).size !== fallbacks.length)
    throw new Error("Fallback providers must be unique.");

  const attemptedProviders: ModelProvider[] = [input.primary];
  const route = [input.primary, ...fallbacks];
  for (let index = 0; index < route.length; index += 1) {
    const provider = route[index];
    try {
      return {
        value: await input.execute(provider),
        attemptedProviders,
        fallbackUsed: index > 0,
      };
    } catch (error) {
      if (index === route.length - 1 || !input.isTransientFailure(error))
        throw error;
      attemptedProviders.push(route[index + 1]);
    }
  }
  throw new Error("AIOS provider routing exhausted without a result.");
}
