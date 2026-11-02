import { z } from "zod";

import { locationTypeCodeSchema } from "./location-types";

// `F4.157` (D1, §4.8 "re-export rather than restate"): the shared bounded
// schema, kept under this file's existing name so no import at either write
// path changes.
export const locationTypeSchema = locationTypeCodeSchema;

// F4.304 (ADR 0108 Amendment 5 items 3, 6): the typed area and its unit; the
// column stores square metres. One declaration, read by the HTTP body, the
// onboarding draft and the catalog's Place step.
export const floorAreaUnitSchema = z.enum(["m2", "ft2"]);
export type FloorAreaUnit = z.infer<typeof floorAreaUnitSchema>;
/** Square metres in one square foot (exact: 0.3048 squared). */
export const FT2_TO_M2 = 0.09290304;
export const FLOOR_AREA_VALUE_MIN = 1;
export const FLOOR_AREA_VALUE_MAX = 100_000_000;
export const floorAreaInputSchema = z
  .object({
    value: z.number().finite().min(FLOOR_AREA_VALUE_MIN).max(FLOOR_AREA_VALUE_MAX),
    unit: floorAreaUnitSchema.default("m2"),
  })
  .strict();
export type FloorAreaInput = z.infer<typeof floorAreaInputSchema>;

/** The typed area in square metres, unrounded. */
export function floorAreaM2Of(input: { readonly value: number; readonly unit: FloorAreaUnit }): number {
  return input.unit === "ft2" ? input.value * FT2_TO_M2 : input.value;
}

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
    // F4.304: `null` clears, absent leaves it.
    floorArea: floorAreaInputSchema.nullable().optional(),
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
