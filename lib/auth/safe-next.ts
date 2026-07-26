const INTERNAL_ORIGIN = "https://aios.local";

export function safeInternalPath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "/";

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
