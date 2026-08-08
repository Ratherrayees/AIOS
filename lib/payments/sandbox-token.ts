import { createHash } from "node:crypto";

import { z } from "zod";

export const sandboxPaymentCheckoutTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);

export function sandboxPaymentCheckoutTokenHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
