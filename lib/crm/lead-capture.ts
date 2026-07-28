import { createHash, createHmac } from "node:crypto";

import { z } from "zod";

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => value || null)
    .nullable()
    .optional()
    .transform((value) => value || null);

export const publicLeadCaptureSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    email: optionalText(320).pipe(z.email().nullable()),
    phone: optionalText(40).refine(
      (value) => value === null || value.length >= 5,
      "Enter a valid phone number.",
    ),
    destination: optionalText(180),
    budgetAmount: z.number().nonnegative().finite().nullable(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    notes: optionalText(2000),
    communicationConsent: z.boolean(),
    utmSource: optionalText(120),
    utmMedium: optionalText(120),
    utmCampaign: optionalText(120),
    landingPath: optionalText(500),
    referrerHost: optionalText(255),
    website: z.string().max(200).default(""),
    startedAt: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    if (!value.email && !value.phone)
      context.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter an email address or phone number.",
      });
  });

export type PublicLeadCaptureInput = z.infer<typeof publicLeadCaptureSchema>;

function normalizedIdentity(input: PublicLeadCaptureInput) {
  return [
    input.email?.toLowerCase() || "",
    input.phone?.replace(/[^\d+]/g, "") || "",
    input.destination?.toLowerCase() || "",
  ].join("|");
}

/** Stable for a single form/day without persisting raw traveller identifiers. */
export function leadDedupeKey(
  formToken: string,
  input: PublicLeadCaptureInput,
) {
  return createHash("sha256")
    .update(`lead-dedupe:v1:${formToken}:${normalizedIdentity(input)}`)
    .digest("hex");
}

/** HMAC keeps an IP useful for throttling without storing the address itself. */
export function leadRequestFingerprint(secret: string, address: string) {
  return createHmac("sha256", secret)
    .update(`lead-capture-rate:v1:${address || "unknown"}`)
    .digest("hex");
}

export function isPlausibleLeadCaptureTiming(
  startedAt: number,
  now = Date.now(),
) {
  const age = now - startedAt;
  return age >= 1_000 && age <= 2 * 60 * 60 * 1_000;
}
