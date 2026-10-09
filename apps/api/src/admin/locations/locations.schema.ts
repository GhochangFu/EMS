import { locationTypeCodeSchema } from "@bms/shared";
import { z } from "zod";

// `F4.157` (D1, §4.8 "re-export rather than restate"): the shared bounded
// schema, kept under this file's existing name so no import at either write
// path changes.
export const locationTypeSchema = locationTypeCodeSchema;

export const createLocationBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: z.string().min(2).max(64),
    slug: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(2).max(255),
    type: locationTypeSchema,
    // F2.10 (ADR 0098): the parent location. null = a root; absent on create = a root.
    // On update, `parentId` IS the move (organization-level administrators only).
    parentId: z.string().uuid().nullable().optional(),
    // E4.1b review C1: the form sends null for an empty field; null clears, absent leaves it.
    province: z.string().max(64).nullable().optional(),
    capital: z.string().max(128).nullable().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    // E4.1b (ADR 0070 decision 6): an IANA zone name, validated against
    // pg_timezone_names by the service; `null` clears, absent leaves it.
    timezone: z.string().max(64).nullable().optional(),
    // `F4.170` owner ruling 20 (compliance review B1): the document says what
    // the service does with the key, since the shape cannot.
    meta: z
      .record(z.unknown())
      .optional()
      .describe(
        "Free-form location metadata. The `seedKey` key is seed-owned and ignored on write: a " +
          "`seedKey` sent here is never stored, and an update that replaces `meta` keeps the stored one.",
      ),
  })
  .strict();

export const updateLocationBodySchema = createLocationBodySchema
  .omit({ organizationId: true })
  .partial();

export type CreateLocationBody = z.infer<typeof createLocationBodySchema>;
export type UpdateLocationBody = z.infer<typeof updateLocationBodySchema>;
