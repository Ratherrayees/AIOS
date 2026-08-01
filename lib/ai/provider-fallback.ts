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
  fallback: ModelProvider | null;
  execute: (provider: ModelProvider) => Promise<T>;
  isTransientFailure: (error: unknown) => boolean;
}) {
  if (input.fallback === input.primary) {
    throw new Error("The fallback provider must differ from the primary.");
  }

  const attemptedProviders: ModelProvider[] = [input.primary];
  try {
    return {
      value: await input.execute(input.primary),
      attemptedProviders,
      fallbackUsed: false,
    };
  } catch (error) {
    if (!input.fallback || !input.isTransientFailure(error)) throw error;
    attemptedProviders.push(input.fallback);
    return {
      value: await input.execute(input.fallback),
      attemptedProviders,
      fallbackUsed: true,
    };
  }
}
