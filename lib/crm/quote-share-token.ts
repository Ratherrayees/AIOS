import "server-only";

import { createHash } from "node:crypto";

import { quoteShareTokenSchema } from "./quote-share";

export function quoteShareTokenHash(value: string) {
  const token = quoteShareTokenSchema.parse(value);
  return createHash("sha256").update(token).digest("hex");
}
