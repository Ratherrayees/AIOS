import "server-only";

import { createHash } from "node:crypto";

import { travelerPortalTokenSchema } from "./traveler-portal";

export function travelerPortalTokenHash(value: string) {
  const token = travelerPortalTokenSchema.parse(value);
  return createHash("sha256").update(token).digest("hex");
}
