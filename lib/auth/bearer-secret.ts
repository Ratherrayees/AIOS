import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison for server-to-server bearer credentials. */
export function matchesBearerSecret(
  authorizationHeader: string | null,
  expectedSecret: string,
) {
  if (
    !authorizationHeader?.startsWith("Bearer ") ||
    expectedSecret.length < 32 ||
    expectedSecret.length > 512
  ) {
    return false;
  }
  const provided = authorizationHeader.slice("Bearer ".length);
  if (provided.length < 32 || provided.length > 512) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expectedSecret);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}
