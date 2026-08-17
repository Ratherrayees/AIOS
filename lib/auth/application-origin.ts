import { headers } from "next/headers";

type ApplicationOriginInput = {
  configuredOrigin?: string;
  requestOrigin?: string | null;
  production?: boolean;
};

function validOrigin(value: string, allowLoopbackHttp: boolean) {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(allowLoopbackHttp && loopback))
      return null;
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolves email callback origins without reflecting an arbitrary request
 * Origin header. Production requires an explicit, HTTPS APP_BASE_URL.
 */
export function resolveApplicationOrigin({
  configuredOrigin,
  requestOrigin,
  production = false,
}: ApplicationOriginInput) {
  if (configuredOrigin)
    // A loopback origin must still be configured explicitly in a production
    // preview. The deployment-readiness gate independently rejects loopback,
    // so a public release can never pass with this local-only callback.
    return validOrigin(configuredOrigin, true);
  if (production) return null;
  if (requestOrigin) {
    const localOrigin = validOrigin(requestOrigin, true);
    if (localOrigin) {
      const hostname = new URL(localOrigin).hostname;
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "[::1]"
      )
        return localOrigin;
    }
  }
  return "http://localhost:3000";
}

export async function getApplicationOrigin() {
  const requestHeaders = await headers();
  return resolveApplicationOrigin({
    configuredOrigin: process.env.APP_BASE_URL,
    requestOrigin: requestHeaders.get("origin"),
    production: process.env.NODE_ENV === "production",
  });
}
