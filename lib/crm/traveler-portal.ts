import { z } from "zod";

export const travelerPortalTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);

const databaseDateTime = z.iso.datetime({ offset: true });
const nullableDateTime = databaseDateTime.nullable();

export const travelerPortalSnapshotSchema = z.object({
  schema_version: z.literal(1),
  generated_at: databaseDateTime,
  portal_expires_at: databaseDateTime,
  trip: z.object({
    name: z.string(),
    destination: z.string().nullable(),
    start_date: z.iso.date().nullable(),
    end_date: z.iso.date().nullable(),
    status: z.enum([
      "draft",
      "confirmed",
      "in_travel",
      "completed",
      "cancelled",
    ]),
  }),
  travelers: z.array(
    z.object({
      first_name: z.string(),
      last_name: z.string().nullable(),
      role: z.enum(["lead_traveler", "traveler", "child"]),
    }),
  ),
  itinerary: z.array(
    z.object({
      day_number: z.number().int().positive(),
      position: z.number().int().nonnegative(),
      item_type: z.enum([
        "flight",
        "stay",
        "transfer",
        "activity",
        "meal",
        "free_time",
        "note",
      ]),
      title: z.string(),
      starts_at: nullableDateTime,
      ends_at: nullableDateTime,
    }),
  ),
  confirmed_services: z.array(
    z.object({
      booking_type: z.enum([
        "flight",
        "hotel",
        "transfer",
        "activity",
        "insurance",
        "other",
      ]),
      title: z.string(),
      confirmation_reference: z.string().nullable(),
      service_start_at: nullableDateTime,
      service_end_at: nullableDateTime,
    }),
  ),
  payment_status_included: z.boolean(),
  receivables: z.array(
    z.object({
      title: z.string(),
      amount: z.number().nonnegative(),
      paid_amount: z.number().nonnegative(),
      outstanding_amount: z.number().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      due_at: z.iso.date().nullable(),
      status: z.enum(["pending", "partially_paid", "paid", "overdue"]),
    }),
  ),
  documents: z.array(
    z.object({
      id: z.uuid(),
      file_name: z.string(),
      mime_type: z.string(),
      document_kind: z.enum([
        "voucher",
        "ticket",
        "insurance",
        "visa",
        "other",
      ]),
      expires_at: z.iso.date().nullable(),
    }),
  ),
});

export type TravelerPortalSnapshot = z.infer<
  typeof travelerPortalSnapshotSchema
>;
